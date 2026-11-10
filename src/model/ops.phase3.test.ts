// Phase 3 model operations: every setter validates input like the IOS CLI would.
import { describe, expect, it } from 'vitest';
import {
  addIpv6StaticRoute,
  addSubinterface,
  checkIntegrity,
  connect,
  removeSubinterface,
  setAcl,
  setDefaultGatewayV6,
  setDhcpPools,
  setInterfaceOptions,
  setNat,
  setOspf,
  setRip,
  setStpPriority,
  setSwitchport,
} from './ops';
import { Builder } from './testing';

function net() {
  const b = new Builder();
  b.add('router', 'R0');
  b.add('switch', 'S0');
  b.add('pc', 'PC0');
  b.add('laptop', 'L0');
  return b;
}

describe('laptop', () => {
  it('is an end device with one FastEthernet port and can be a DHCP/SLAAC client', () => {
    const b = net();
    expect(b.t.devices.L0.interfaceIds.map((i) => b.t.interfaces[i].name)).toEqual(['FastEthernet0']);
    expect(() => setInterfaceOptions(b.t, b.port('L0', 'FastEthernet0'), { dhcp: true })).not.toThrow();
    expect(() => setDefaultGatewayV6(b.t, 'L0', '2001:db8::1')).not.toThrow();
  });
});

describe('switchports and subinterfaces', () => {
  it('validates VLAN ids and only applies to switches', () => {
    const b = net();
    const p = b.port('S0', 'FastEthernet0/1');
    expect(() => setSwitchport(b.t, p, { mode: 'access', accessVlan: 0, nativeVlan: 1 })).toThrow(/1 to 4094/);
    expect(() => setSwitchport(b.t, p, { mode: 'access', accessVlan: 4095, nativeVlan: 1 })).toThrow(/1 to 4094/);
    expect(() => setSwitchport(b.t, b.port('R0', 'GigabitEthernet0/0'), { mode: 'access', accessVlan: 10, nativeVlan: 1 })).toThrow(/switch/);
    const t = setSwitchport(b.t, p, { mode: 'trunk', accessVlan: 1, nativeVlan: 99, allowedVlans: [30, 10, 10] });
    expect(t.interfaces[p].switchport).toEqual({ mode: 'trunk', accessVlan: 1, nativeVlan: 99, allowedVlans: [10, 30] });
  });

  it('creates Gi0/0.10 sharing the parent MAC, refuses duplicates and nesting', () => {
    const b = net();
    const parent = b.port('R0', 'GigabitEthernet0/0');
    const r = addSubinterface(b.t, parent, 10);
    const sub = r.topology.interfaces[r.interfaceId];
    expect(sub).toMatchObject({ name: 'GigabitEthernet0/0.10', vlanTag: 10, parentId: parent, mac: b.t.interfaces[parent].mac });
    expect(checkIntegrity(r.topology)).toEqual([]);
    expect(() => addSubinterface(r.topology, parent, 10)).toThrow(/already has a subinterface for VLAN 10/);
    expect(() => addSubinterface(r.topology, parent, 20, 10)).toThrow(/already exists/); // name taken
    expect(addSubinterface(r.topology, parent, 20, 200).topology.interfaces).toBeTruthy(); // .200 carrying VLAN 20 is legal
    expect(() => addSubinterface(r.topology, r.interfaceId, 20)).toThrow(/cannot have subinterfaces/);
    expect(() => addSubinterface(b.t, b.port('R0', 'Serial0/0/0'), 10)).toThrow(/Ethernet/);
    expect(() => addSubinterface(b.t, b.port('S0', 'FastEthernet0/1'), 10)).toThrow(/routers/);
    // a subinterface is logical: it can't take a cable, and it can be removed
    expect(() => connect(r.topology, r.interfaceId, b.port('PC0', 'FastEthernet0'), 'copper-straight')).toThrow();
    expect(removeSubinterface(r.topology, r.interfaceId).interfaces[r.interfaceId]).toBeUndefined();
    expect(() => removeSubinterface(b.t, parent)).toThrow(/Only subinterfaces/);
  });
});

describe('interface options', () => {
  it('DHCP clears a static address; null clears a field', () => {
    const b = net();
    const p = b.port('PC0', 'FastEthernet0');
    b.ip('PC0', 'FastEthernet0', '10.0.0.5/24');
    const t = setInterfaceOptions(b.t, p, { dhcp: true });
    expect(t.interfaces[p].ipv4).toBeUndefined();
    expect(t.interfaces[p].dhcp).toBe(true);
    const r = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { aclIn: '10' });
    expect(setInterfaceOptions(r, b.port('R0', 'GigabitEthernet0/0'), { aclIn: null }).interfaces[b.port('R0', 'GigabitEthernet0/0')].aclIn).toBeUndefined();
  });

  it('puts settings only where they belong', () => {
    const b = net();
    expect(() => setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { dhcp: true })).toThrow(/end devices/);
    expect(() => setInterfaceOptions(b.t, b.port('PC0', 'FastEthernet0'), { aclIn: '10' })).toThrow(/router/);
    expect(() => setInterfaceOptions(b.t, b.port('S0', 'FastEthernet0/1'), { ipv6: { address: '2001:db8::1', prefixLength: 64 } })).toThrow(/no IPv6/);
  });

  it('normalises and validates IPv6, helper address and OSPF cost', () => {
    const b = net();
    const p = b.port('R0', 'GigabitEthernet0/0');
    expect(setInterfaceOptions(b.t, p, { ipv6: { address: '2001:0DB8::0001', prefixLength: 64 } }).interfaces[p].ipv6).toEqual({ address: '2001:db8::1', prefixLength: 64 });
    expect(() => setInterfaceOptions(b.t, p, { ipv6: { address: '2001:db8::zz', prefixLength: 64 } })).toThrow(/valid IPv6/);
    expect(() => setInterfaceOptions(b.t, p, { ipv6: { address: '2001:db8::1', prefixLength: 129 } })).toThrow(/1 to 128/);
    expect(() => setInterfaceOptions(b.t, p, { helperAddress: '10.0.0.300' })).toThrow(/helper/);
    expect(() => setInterfaceOptions(b.t, p, { ospfCost: 0 })).toThrow(/1 to 65535/);
  });
});

describe('router features', () => {
  it('ACL numbers decide the type, as on IOS', () => {
    const b = net();
    const std = { type: 'standard' as const, rules: [{ action: 'permit' as const, protocol: 'ip' as const, src: '10.0.0.0', srcWildcard: '0.0.0.255' }] };
    expect(() => setAcl(b.t, 'R0', '10', std)).not.toThrow();
    expect(() => setAcl(b.t, 'R0', '110', std)).toThrow(/extended ACL by its number/);
    expect(() => setAcl(b.t, 'R0', '200', std)).toThrow(/1-99/);
    expect(() => setAcl(b.t, 'R0', 'bad name!', std)).toThrow(/names/);
    expect(() => setAcl(b.t, 'R0', 'X', { type: 'standard', rules: [{ ...std.rules[0], srcWildcard: '255.255.255.0' }] })).toThrow(/wildcard/);
    expect(() => setAcl(b.t, 'S0', '10', std)).toThrow(/routers/);
    const t = setAcl(b.t, 'R0', 'BLOCK', std);
    expect(setAcl(t, 'R0', 'BLOCK', null).devices.R0.acls?.BLOCK).toBeUndefined();
  });

  it('DHCP pools: names unique, network normalised, size at least /30', () => {
    const b = net();
    const t = setDhcpPools(b.t, 'R0', [{ name: 'LAN', network: '192.168.1.77', prefixLength: 24 }]);
    expect(t.devices.R0.dhcpPools?.[0].network).toBe('192.168.1.0');
    expect(() => setDhcpPools(b.t, 'R0', [{ name: 'A', network: '10.0.0.0', prefixLength: 24 }, { name: 'A', network: '10.0.1.0', prefixLength: 24 }])).toThrow(/Two pools/);
    expect(() => setDhcpPools(b.t, 'R0', [{ name: 'A', network: '10.0.0.0', prefixLength: 31 }])).toThrow(/30/);
    expect(() => setDhcpPools(b.t, 'PC0', [])).toThrow(/routers and servers/);
  });

  it('NAT, RIP, OSPF validate their input', () => {
    const b = net();
    expect(() => setNat(b.t, 'R0', { statics: [{ local: '10.0.0.5', global: 'nope' }] })).toThrow(/Static NAT/);
    expect(() => setNat(b.t, 'R0', { statics: [], overload: { acl: '1', outsideInterfaceId: b.port('S0', 'FastEthernet0/1') } })).toThrow(/outside interface/);
    expect(setRip(b.t, 'R0', [{ prefix: '10.1.2.3', prefixLength: 8 }]).devices.R0.rip?.networks[0].prefix).toBe('10.0.0.0');
    expect(() => setOspf(b.t, 'R0', { routerId: '1.1.1', networks: [] })).toThrow(/router ID/);
    expect(() => setOspf(b.t, 'R0', { networks: [{ prefix: '10.0.0.0', prefixLength: 8, area: -1 }] })).toThrow(/area/);
  });

  it('STP priority is a multiple of 4096', () => {
    const b = net();
    expect(setStpPriority(b.t, 'S0', 4096).devices.S0.stpPriority).toBe(4096);
    expect(() => setStpPriority(b.t, 'S0', 1000)).toThrow(/4096/);
    expect(() => setStpPriority(b.t, 'R0', 4096)).toThrow(/switches/);
  });

  it('IPv6 static routes and gateway normalise addresses', () => {
    const b = net();
    const t = addIpv6StaticRoute(b.t, 'R0', { prefix: '2001:DB8:3::', prefixLength: 64, nextHop: '2001:db8:2:0::2' });
    expect(t.devices.R0.ipv6StaticRoutes).toEqual([{ prefix: '2001:db8:3::', prefixLength: 64, nextHop: '2001:db8:2::2' }]);
    expect(() => setDefaultGatewayV6(b.t, 'R0', '2001:db8::1')).toThrow(/end devices/);
  });
});
