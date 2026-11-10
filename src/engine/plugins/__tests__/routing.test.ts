// Dynamic routing: RIP (distance vector) and OSPF (link state).
import { describe, expect, it } from 'vitest';
import { addStaticRoute, setDefaultGateway, setOspf, setRip } from '../../../model/ops';
import { Builder } from '../../../model/testing';
import { boot, pingAndRun } from '../../testing';
import type { Route } from '../../routing';
import { isIpv4, isUdp } from '../../packets';
import { Simulation } from '../../simulation';
import { DEFAULT_PLUGINS } from '..';
import { ospfOf } from '../ospf';

/**
 *  PC1 10.1.0.10 ─ R1 ═ 10.0.12.0/30 ═ R2 ═ 10.0.23.0/30 ═ R3 ─ PC3 10.3.0.10
 *  (serial links between routers, PCs directly on Gi0/0)
 */
function chain() {
  const b = new Builder();
  for (const [k, n] of [['pc', 'PC1'], ['router', 'R1'], ['router', 'R2'], ['router', 'R3'], ['pc', 'PC3']] as const) b.add(k, n);
  b.link(['PC1', 'FastEthernet0'], ['R1', 'GigabitEthernet0/0'], 'copper-cross');
  b.link(['R1', 'Serial0/0/0'], ['R2', 'Serial0/0/0'], 'serial');
  b.link(['R2', 'Serial0/0/1'], ['R3', 'Serial0/0/0'], 'serial');
  b.link(['R3', 'GigabitEthernet0/0'], ['PC3', 'FastEthernet0'], 'copper-cross');
  b.ip('PC1', 'FastEthernet0', '10.1.0.10/24');
  b.ip('R1', 'GigabitEthernet0/0', '10.1.0.1/24');
  b.ip('R1', 'Serial0/0/0', '10.0.12.1/30');
  b.ip('R2', 'Serial0/0/0', '10.0.12.2/30');
  b.ip('R2', 'Serial0/0/1', '10.0.23.1/30');
  b.ip('R3', 'Serial0/0/0', '10.0.23.2/30');
  b.ip('R3', 'GigabitEthernet0/0', '10.3.0.1/24');
  b.ip('PC3', 'FastEthernet0', '10.3.0.10/24');
  b.t = setDefaultGateway(b.t, 'PC1', '10.1.0.1');
  b.t = setDefaultGateway(b.t, 'PC3', '10.3.0.1');
  return b;
}

const everything = [{ prefix: '10.0.0.0', prefixLength: 8 }];
const find = (routes: Route[], net: string) => routes.find((r) => `${r.network}/${r.prefixLength}` === net);

describe('RIP', () => {
  it('without a routing protocol the far LAN is unreachable', () => {
    expect(pingAndRun(boot(chain().t), 'PC1', '10.3.0.10').status).toBe('unreachable');
  });

  it('converges: every router learns every network with hop-count metrics', () => {
    const b = chain();
    for (const r of ['R1', 'R2', 'R3']) b.t = setRip(b.t, r, everything);
    const sim = boot(b.t);
    const r1 = sim.routes('R1');
    expect(find(r1, '10.3.0.0/24')).toMatchObject({ code: 'R', ad: 120, metric: 2, nextHop: '10.0.12.2' });
    expect(find(r1, '10.0.23.0/30')).toMatchObject({ code: 'R', metric: 1 });
    expect(find(sim.routes('R3'), '10.1.0.0/24')).toMatchObject({ code: 'R', metric: 2, nextHop: '10.0.23.1' });
    expect(pingAndRun(sim, 'PC1', '10.3.0.10').status).toBe('success');
  });

  it('split horizon: a router never advertises a route back where it learned it', () => {
    const b = chain();
    for (const r of ['R1', 'R2', 'R3']) b.t = setRip(b.t, r, everything);
    const s2 = new Simulation(b.t, DEFAULT_PLUGINS).boot(); // step by step to watch R2's updates
    const towardsR1 = b.port('R2', 'Serial0/0/0');
    const advertised: string[] = [];
    while (!s2.isIdle()) {
      for (const tx of s2.step()) {
        const p = tx.frame.payload;
        if (tx.fromIf === towardsR1 && isIpv4(p) && isUdp(p.l4) && p.l4.dstPort === 520) {
          for (const e of (p.l4.data as unknown as { entries: { network: string; prefixLength: number }[] }).entries) advertised.push(`${e.network}/${e.prefixLength}`);
        }
      }
    }
    expect(advertised).toContain('10.3.0.0/24');
    expect(advertised).not.toContain('10.1.0.0/24'); // learned from R1, so never sent back
  });

  it('a static route (AD 1) beats RIP (AD 120) for the same prefix', () => {
    const b = chain();
    for (const r of ['R1', 'R2', 'R3']) b.t = setRip(b.t, r, everything);
    b.t = addStaticRoute(b.t, 'R1', { prefix: '10.3.0.0', prefixLength: 24, nextHop: '10.0.12.2' });
    expect(find(boot(b.t).routes('R1'), '10.3.0.0/24')).toMatchObject({ code: 'S', ad: 1 });
  });

  it('only interfaces covered by a network statement take part', () => {
    const b = chain();
    b.t = setRip(b.t, 'R1', everything);
    b.t = setRip(b.t, 'R2', [{ prefix: '10.0.12.0', prefixLength: 30 }]); // R2 doesn't run RIP towards R3
    b.t = setRip(b.t, 'R3', everything);
    const sim = boot(b.t);
    expect(find(sim.routes('R1'), '10.3.0.0/24')).toBeUndefined();
    // R2 only advertises networks it runs RIP on
    expect(find(sim.routes('R1'), '10.0.23.0/30')).toBeUndefined();
  });
});

const ospfAll = (area = 0) => ({ networks: [{ prefix: '10.0.0.0', prefixLength: 8, area }] });

describe('OSPF', () => {
  it('forms full adjacencies and builds routes with costs', () => {
    const b = chain();
    for (const r of ['R1', 'R2', 'R3']) b.t = setOspf(b.t, r, ospfAll());
    const sim = boot(b.t);
    const r2 = ospfOf(sim, sim.topology.devices.R2);
    const states = Object.values(r2.neighbors).flatMap((n) => Object.values(n).map((x) => x.state));
    expect(states).toEqual(['full', 'full']);
    // 10.3.0.0/24 from R1: serial 64 + serial 64 + gig 1 = 129
    expect(find(sim.routes('R1'), '10.3.0.0/24')).toMatchObject({ code: 'O', ad: 110, metric: 129, nextHop: '10.0.12.2' });
    expect(pingAndRun(sim, 'PC1', '10.3.0.10').status).toBe('success');
  });

  it('every router ends with the same link-state database', () => {
    const b = chain();
    for (const r of ['R1', 'R2', 'R3']) b.t = setOspf(b.t, r, ospfAll());
    const sim = boot(b.t);
    const dbs = ['R1', 'R2', 'R3'].map((r) => Object.keys(ospfOf(sim, sim.topology.devices[r]).lsdb).sort());
    expect(dbs[0]).toHaveLength(3);
    expect(dbs[1]).toEqual(dbs[0]);
    expect(dbs[2]).toEqual(dbs[0]);
  });

  it('routers in different areas on the same link never become neighbours', () => {
    const b = chain();
    b.t = setOspf(b.t, 'R1', ospfAll(0));
    b.t = setOspf(b.t, 'R2', ospfAll(1));
    const sim = boot(b.t);
    expect(Object.values(ospfOf(sim, sim.topology.devices.R1).neighbors).flatMap(Object.values)).toHaveLength(0);
    expect(sim.log.some((e) => /area/i.test(e.text) && /mismatch/i.test(e.text))).toBe(true);
  });

  it('OSPF (AD 110) beats RIP (AD 120) when both run', () => {
    const b = chain();
    for (const r of ['R1', 'R2', 'R3']) {
      b.t = setOspf(b.t, r, ospfAll());
      b.t = setRip(b.t, r, everything);
    }
    expect(find(boot(b.t).routes('R1'), '10.3.0.0/24')?.code).toBe('O');
  });

  it('chooses the cheapest path, not the fewest hops', () => {
    // add a direct but slow serial link R1─R3 and make it expensive vs two fast hops
    const b = chain();
    b.link(['R1', 'Serial0/0/1'], ['R3', 'Serial0/0/1'], 'serial');
    b.ip('R1', 'Serial0/0/1', '10.0.13.1/30');
    b.ip('R3', 'Serial0/0/1', '10.0.13.2/30');
    for (const r of ['R1', 'R2', 'R3']) b.t = setOspf(b.t, r, ospfAll());
    const sim = boot(b.t);
    // direct: 64 + 1 = 65, via R2: 64 + 64 + 1 = 129 -> direct wins
    expect(find(sim.routes('R1'), '10.3.0.0/24')).toMatchObject({ metric: 65, nextHop: '10.0.13.2' });
  });
});
