// A .networky file comes from anywhere, so loading must survive hostile input.
import { describe, expect, it } from 'vitest';
import { parseRule } from './acl';
import { addIpv6StaticRoute, addSubinterface, setAcl, setDhcpPools, setInterfaceOptions, setNat, setOspf, setRip, setStpPriority, setSwitchport } from './ops';
import { deserialize, LIMITS, serialize } from './serialize';
import { Builder, smallLan } from './testing';

/** Every phase 3 field set at least once. */
function everything() {
  const b = smallLan();
  b.add('laptop', 'L0');
  const sub = addSubinterface(b.t, b.port('Router0', 'GigabitEthernet0/1'), 10);
  b.t = sub.topology;
  b.t = setSwitchport(b.t, b.port('Switch0', 'FastEthernet0/2'), { mode: 'trunk', accessVlan: 1, nativeVlan: 99, allowedVlans: [10, 20] });
  b.t = setStpPriority(b.t, 'Switch0', 4096);
  b.t = setAcl(b.t, 'Router0', '101', { type: 'extended', rules: [parseRule('permit tcp any host 10.0.0.1 eq 80', 'extended')] });
  b.t = setInterfaceOptions(b.t, b.port('Router0', 'GigabitEthernet0/0'), { aclIn: '101', nat: 'inside', helperAddress: '10.9.9.9', ospfCost: 10, ipv6: { address: '2001:db8::1', prefixLength: 64 } });
  b.t = setInterfaceOptions(b.t, b.port('L0', 'FastEthernet0'), { dhcp: true, ipv6Auto: true });
  b.t = setDhcpPools(b.t, 'Router0', [{ name: 'LAN', network: '192.168.1.0', prefixLength: 24, defaultRouter: '192.168.1.1', excluded: ['192.168.1.2'] }]);
  b.t = setNat(b.t, 'Router0', { statics: [{ local: '192.168.1.10', global: '203.0.113.10' }], overload: { acl: '101', outsideInterfaceId: b.port('Router0', 'GigabitEthernet0/2') } });
  b.t = setRip(b.t, 'Router0', [{ prefix: '192.168.1.0', prefixLength: 24 }]);
  b.t = setOspf(b.t, 'Router0', { routerId: '1.1.1.1', networks: [{ prefix: '192.168.1.0', prefixLength: 24, area: 0 }] });
  b.t = addIpv6StaticRoute(b.t, 'Router0', { prefix: '2001:db8:9::', prefixLength: 64, nextHop: '2001:db8::2' });
  return b;
}

const file = (b: Builder) => JSON.parse(serialize({ topology: b.t, layout: { PC0: { x: 1, y: 2 } } }));
const load = (obj: unknown) => () => deserialize(JSON.stringify(obj));

describe('round trip', () => {
  it('keeps every phase 3 setting', () => {
    const b = everything();
    const back = deserialize(serialize({ topology: b.t, layout: {} }));
    expect(back.topology).toEqual(b.t);
  });
});

describe('hostile files', () => {
  it('refuses oversized files before parsing', () => {
    expect(() => deserialize(' '.repeat(LIMITS.fileBytes + 1))).toThrow(/too large/);
  });

  it('refuses __proto__ / constructor keys (prototype pollution)', () => {
    const raw = serialize({ topology: smallLan().t, layout: {} }).replace('"devices": {', '"devices": { "__proto__": { "polluted": true },');
    expect(() => deserialize(raw)).toThrow(/reserved/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const f = file(smallLan());
    f.topology.devices.constructor = { ...f.topology.devices.PC0, id: 'constructor' };
    expect(load(f)).toThrow(/reserved/);
  });

  it('refuses a key that disagrees with the id inside', () => {
    const f = file(smallLan());
    f.topology.devices.PCX = f.topology.devices.PC0;
    delete f.topology.devices.PC0;
    expect(load(f)).toThrow(/key must equal its id/);
  });

  it('rejects unknown fields instead of silently dropping them', () => {
    const f = file(smallLan());
    f.topology.devices.PC0.onclick = 'alert(1)';
    expect(load(f)).toThrow(/Unrecognized key|onclick/);
  });

  it.each([
    ['bad IPv4', (f: any) => (f.topology.interfaces[Object.keys(f.topology.interfaces)[0]].ipv4 = { address: '999.1.1.1', prefixLength: 24 })],
    ['bad MAC', (f: any) => (f.topology.interfaces[Object.keys(f.topology.interfaces)[0]].mac = 'zz')],
    ['VLAN 5000', (f: any) => (f.topology.interfaces[Object.keys(f.topology.interfaces)[0]].switchport = { mode: 'access', accessVlan: 5000, nativeVlan: 1 })],
    ['control chars in hostname', (f: any) => (f.topology.devices.PC0.hostname = 'PC\u0000')],
    ['very long hostname', (f: any) => (f.topology.devices.PC0.hostname = 'x'.repeat(500))],
    ['infinite coordinate', (f: any) => (f.layout.PC0 = { x: 1e308 * 10, y: 0 })],
    ['id with a path', (f: any) => (f.topology.links['../x'] = { id: '../x', a: 'a', b: 'b', cable: 'serial' })],
    ['STP priority 1000', (f: any) => (f.topology.devices.Switch0.stpPriority = 1000)],
    ['wrong version', (f: any) => (f.topology.version = 2)],
  ])('rejects %s', (_, mutate) => {
    const f = file(smallLan());
    mutate(f);
    expect(load(f)).toThrow();
  });

  it('caps the number of devices', () => {
    const f = file(smallLan());
    for (let i = 0; i <= LIMITS.devices; i++) f.topology.devices[`D${i}`] = { id: `D${i}`, kind: 'hub', hostname: `D${i}`, interfaceIds: [] };
    expect(load(f)).toThrow(/at most/);
  });

  it('drops layout entries for devices that do not exist', () => {
    const f = file(smallLan());
    f.layout.ghost = { x: 0, y: 0 };
    expect(Object.keys(deserialize(JSON.stringify(f)).layout)).toEqual(['PC0']);
  });

  it('normalises IPv6 to one spelling on load', () => {
    const f = file(everything());
    const gi = Object.values<any>(f.topology.interfaces).find((i) => i.ipv6);
    gi.ipv6.address = '2001:0DB8:0000::0001';
    const back = deserialize(JSON.stringify(f));
    expect(back.topology.interfaces[gi.id].ipv6?.address).toBe('2001:db8::1');
  });
});
