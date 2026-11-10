import { describe, expect, it } from 'vitest';
import { DEFAULT_PLUGINS } from '../engine/plugins';
import { Simulation } from '../engine/simulation';
import { EXAMPLES } from './examples';
import { checkIntegrity } from './ops';
import { deserialize, serialize } from './serialize';
import { validate } from './validate';

const byHostname = (sim: Simulation, name: string) => Object.values(sim.topology.devices).find((d) => d.hostname === name)!.id;

describe('example labs', () => {
  it('names are unique', () => {
    expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length);
  });

  describe.each(EXAMPLES.map((e) => [e.name, e] as const))('%s', (_n, e) => {
    it('is consistent, error-free and survives save/load', () => {
      const file = e.build();
      expect(checkIntegrity(file.topology)).toEqual([]);
      expect(validate(file.topology).filter((i) => i.severity === 'error')).toEqual([]);
      expect(deserialize(serialize(file)).topology).toEqual(file.topology);
      expect(Object.keys(file.layout).sort()).toEqual(Object.keys(file.topology.devices).sort());
    });

    it.each(e.exercises.map((x) => [`${x.kind} ${x.from} → ${x.to}${x.port ? `:${x.port}` : ''} = ${x.expect}`, x] as const))('%s', (_d, x) => {
      const sim = new Simulation(e.build().topology, DEFAULT_PLUGINS).boot().run(5000);
      expect(sim.booting).toBe(false);
      const p = sim.probe({ kind: x.kind, sourceDeviceId: byHostname(sim, x.from), destination: x.to, port: x.port });
      sim.run(5000);
      expect(p.status, p.detail).toBe(x.expect);
    });
  });

  it('OSPF lab: R1 prefers the fast 3-hop path over the slow direct link', () => {
    const e = EXAMPLES.find((x) => x.name.startsWith('OSPF'))!;
    const sim = new Simulation(e.build().topology, DEFAULT_PLUGINS).boot().run(5000);
    const r = sim.routes(byHostname(sim, 'R1')).find((x) => x.network === '10.3.0.0')!;
    expect(r).toMatchObject({ code: 'O', metric: 3, nextHop: '10.0.12.2' });
  });
});
