import { describe, expect, it } from 'vitest';
import {
  addDevice,
  addStaticRoute,
  checkIntegrity,
  connect,
  createTopology,
  disconnect,
  peerInterfaceId,
  removeDevice,
  setDefaultGateway,
  setHostname,
  setInterfaceIp,
} from './ops';
import { Builder, smallLan } from './testing';

describe('addDevice', () => {
  it('creates a device with ports from the catalog and unique hostnames', () => {
    let t = createTopology();
    const r1 = addDevice(t, 'router');
    t = r1.topology;
    const r2 = addDevice(t, 'router');
    t = r2.topology;
    expect(t.devices[r1.deviceId].hostname).toBe('Router0');
    expect(t.devices[r2.deviceId].hostname).toBe('Router1');
    expect(t.devices[r1.deviceId].interfaceIds).toHaveLength(5);
    const macs = Object.values(t.interfaces).map((i) => i.mac);
    expect(new Set(macs).size).toBe(macs.length);
    expect(macs[0]).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
    expect(checkIntegrity(t)).toEqual([]);
  });

  it('does not change the input topology (pure function)', () => {
    const t = createTopology();
    addDevice(t, 'pc');
    expect(Object.keys(t.devices)).toHaveLength(0);
  });
});

describe('connect', () => {
  it('builds PC -> switch -> router in code and keeps the link consistent', () => {
    const b = smallLan();
    expect(Object.keys(b.t.links)).toHaveLength(2);
    expect(checkIntegrity(b.t)).toEqual([]);
    const pcPort = b.port('PC0', 'FastEthernet0');
    expect(peerInterfaceId(b.t, pcPort)).toBe(b.port('Switch0', 'FastEthernet0/1'));
  });

  it('refuses a port that is already used', () => {
    const b = smallLan();
    b.add('pc', 'PC1');
    expect(() => b.link(['PC1', 'FastEthernet0'], ['Switch0', 'FastEthernet0/1'])).toThrow(/already connected/);
  });

  it('refuses a cable that does not fit the port', () => {
    const b = new Builder();
    b.add('pc', 'PC0');
    b.add('router', 'R0');
    expect(() => b.link(['PC0', 'FastEthernet0'], ['R0', 'Serial0/0/0'], 'serial')).toThrow(/does not fit/);
    expect(() => b.link(['PC0', 'FastEthernet0'], ['R0', 'GigabitEthernet0/2'], 'copper-straight')).toThrow(/does not fit/);
  });

  it('refuses connecting a device to itself', () => {
    const b = new Builder();
    b.add('switch', 'S0');
    expect(() => b.link(['S0', 'FastEthernet0/1'], ['S0', 'FastEthernet0/2'])).toThrow(/itself/);
  });
});

describe('disconnect and removeDevice', () => {
  it('disconnect frees both ports', () => {
    const b = smallLan();
    const linkId = b.t.interfaces[b.port('PC0', 'FastEthernet0')].linkId!;
    const t = disconnect(b.t, linkId);
    expect(t.interfaces[b.port('PC0', 'FastEthernet0')].linkId).toBeUndefined();
    expect(t.interfaces[b.port('Switch0', 'FastEthernet0/1')].linkId).toBeUndefined();
    expect(checkIntegrity(t)).toEqual([]);
  });

  it('removing a device removes its links and frees the far ports', () => {
    const b = smallLan();
    const t = removeDevice(b.t, 'Switch0');
    expect(Object.keys(t.links)).toHaveLength(0);
    expect(t.interfaces[b.port('PC0', 'FastEthernet0')].linkId).toBeUndefined();
    expect(checkIntegrity(t)).toEqual([]);
  });
});

describe('configuration', () => {
  it('refuses IPs on L1/L2 devices and bad input', () => {
    const b = smallLan();
    expect(() => b.ip('Switch0', 'FastEthernet0/2', '10.0.0.1/24')).toThrow(/layer 2/);
    expect(() => b.ip('PC0', 'FastEthernet0', '300.1.1.1/24')).toThrow(/not a valid/);
    expect(() => b.ip('PC0', 'FastEthernet0', '10.0.0.1/40')).toThrow(/prefix/);
  });

  it('clears an IP with undefined', () => {
    const b = smallLan();
    const t = setInterfaceIp(b.t, b.port('PC0', 'FastEthernet0'), undefined);
    expect(t.interfaces[b.port('PC0', 'FastEthernet0')].ipv4).toBeUndefined();
  });

  it('only hosts get a gateway, only routers get routes', () => {
    const b = smallLan();
    expect(() => setDefaultGateway(b.t, 'Router0', '1.1.1.1')).toThrow();
    expect(() => addStaticRoute(b.t, 'PC0', { prefix: '10.0.0.0', prefixLength: 8, nextHop: '1.1.1.1' })).toThrow();
  });

  it('stores routes as canonical network addresses and refuses duplicates', () => {
    const b = smallLan();
    const t = addStaticRoute(b.t, 'Router0', { prefix: '10.0.2.7', prefixLength: 24, nextHop: '192.168.1.2' });
    expect(t.devices.Router0.staticRoutes).toEqual([{ prefix: '10.0.2.0', prefixLength: 24, nextHop: '192.168.1.2' }]);
    expect(() => addStaticRoute(t, 'Router0', { prefix: '10.0.2.0', prefixLength: 24, nextHop: '192.168.1.3' })).toThrow(/already/);
  });

  it('validates hostnames', () => {
    const b = smallLan();
    expect(setHostname(b.t, 'PC0', ' Alice-PC ').devices.PC0.hostname).toBe('Alice-PC');
    expect(() => setHostname(b.t, 'PC0', '1bad')).toThrow();
    expect(() => setHostname(b.t, 'PC0', 'has space')).toThrow();
  });
});

describe('checkIntegrity', () => {
  it('detects a link that only one side knows about', () => {
    const b = smallLan();
    const pc = b.port('PC0', 'FastEthernet0');
    const broken = { ...b.t, interfaces: { ...b.t.interfaces, [pc]: { ...b.t.interfaces[pc], linkId: undefined } } };
    expect(checkIntegrity(broken).length).toBeGreaterThan(0);
  });

  it('stays consistent through a random sequence of operations', () => {
    let t = createTopology();
    const ids: string[] = [];
    for (const kind of ['pc', 'pc', 'switch', 'router', 'hub', 'server'] as const) {
      const r = addDevice(t, kind);
      t = r.topology;
      ids.push(r.deviceId);
    }
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let step = 0; step < 300; step++) {
      const ifIds = Object.keys(t.interfaces);
      const action = rand(3);
      try {
        if (action === 0) t = connect(t, ifIds[rand(ifIds.length)], ifIds[rand(ifIds.length)], 'copper-straight').topology;
        else if (action === 1) {
          const links = Object.keys(t.links);
          if (links.length) t = disconnect(t, links[rand(links.length)]);
        } else if (rand(10) === 0) {
          const devs = Object.keys(t.devices);
          if (devs.length > 2) t = removeDevice(t, devs[rand(devs.length)]);
        }
      } catch {
        // refused operations are fine; they must not corrupt anything
      }
      expect(checkIntegrity(t)).toEqual([]);
    }
  });
});
