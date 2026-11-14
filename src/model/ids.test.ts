import { describe, expect, it } from 'vitest';
import { addDevice, connect, createTopology, TopologyError } from './ops';
import { formatMac, randomIds, seededIds } from './ids';

describe('id sources', () => {
  it('seeded: same seed, same ids and MACs; different seed, different MACs', () => {
    const build = (seed: string) => {
      const ids = seededIds(seed);
      let t = addDevice(createTopology(), 'pc', { hostname: 'A', ids }).topology;
      t = addDevice(t, 'pc', { hostname: 'B', ids }).topology;
      const [a, b] = Object.values(t.devices).map((d) => d.interfaceIds[0]);
      return connect(t, a, b, 'copper-cross', { ids }).topology;
    };
    expect(JSON.stringify(build('x'))).toBe(JSON.stringify(build('x')));
    expect(Object.keys(build('x').devices)).toEqual(['d1', 'd2']);
    const macs = (seed: string) => Object.values(build(seed).interfaces).map((i) => i.mac);
    expect(macs('x')).not.toEqual(macs('y'));
  });

  it('every MAC is unicast and locally administered', () => {
    const s = seededIds('m');
    for (let i = 0; i < 200; i++) {
      for (const mac of [s.mac(), randomIds.mac()]) {
        expect(mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
        const first = parseInt(mac.slice(0, 2), 16);
        expect(first & 1).toBe(0); // not multicast
        expect(first & 2).toBe(2); // locally administered
      }
    }
    expect(formatMac([0xff, 0, 0, 0, 0, 0])).toBe('fe:00:00:00:00:00');
  });

  it('random ids use only the id alphabet and do not repeat', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => randomIds.id('interface')));
    expect(seen.size).toBe(1000);
    for (const id of seen) expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it('refuses an id source that hands out a used id', () => {
    const stuck = { id: () => 'same', mac: () => '02:00:00:00:00:01' };
    expect(() => addDevice(createTopology(), 'switch', { ids: stuck })).toThrow(TopologyError);
  });
});
