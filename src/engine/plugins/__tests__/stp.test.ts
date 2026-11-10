import { describe, expect, it } from 'vitest';
import { setStpPriority } from '../../../model/ops';
import { Builder } from '../../../model/testing';
import { boot, pingAndRun } from '../../testing';
import { Simulation } from '../../simulation';
import { stpOf, stpPlugin } from '../stp';

/**
 * A switching loop:   S1 ---- S2
 *                       \    /
 *                        S3
 * PC0 on S1, PC1 on S2. Without STP every broadcast circles forever.
 */
function triangle() {
  const b = new Builder();
  for (const s of ['S1', 'S2', 'S3']) b.add('switch', s);
  b.add('pc', 'PC0');
  b.add('pc', 'PC1');
  b.link(['S1', 'FastEthernet0/1'], ['S2', 'FastEthernet0/1'], 'copper-cross');
  b.link(['S2', 'FastEthernet0/2'], ['S3', 'FastEthernet0/2'], 'copper-cross');
  b.link(['S3', 'FastEthernet0/1'], ['S1', 'FastEthernet0/2'], 'copper-cross');
  b.link(['PC0', 'FastEthernet0'], ['S1', 'FastEthernet0/5']);
  b.link(['PC1', 'FastEthernet0'], ['S2', 'FastEthernet0/5']);
  b.ip('PC0', 'FastEthernet0', '10.0.0.1/24');
  b.ip('PC1', 'FastEthernet0', '10.0.0.2/24');
  return b;
}

const roles = (sim: Simulation, sw: string) => Object.values(stpOf(sim, sim.topology.devices[sw]).roles);

describe('STP', () => {
  it('without STP the loop becomes a broadcast storm', () => {
    const sim = new Simulation(triangle().t, []).boot();
    sim.ping('PC0', '10.0.0.2');
    sim.run(500);
    expect(sim.log.some((e) => /broadcast storm|copies/i.test(e.text))).toBe(true);
  });

  it('blocks exactly one port and the ping then works', () => {
    const sim = boot(triangle().t);
    const all = ['S1', 'S2', 'S3'].flatMap((s) => roles(sim, s));
    expect(all.filter((r) => r === 'alternate')).toHaveLength(1);
    expect(pingAndRun(sim, 'PC0', '10.0.0.2').status).toBe('success');
    expect(sim.log.some((e) => /storm/i.test(e.text))).toBe(false);
  });

  it('elects the lowest bridge ID as root, and every switch agrees', () => {
    const b = triangle();
    b.t = setStpPriority(b.t, 'S3', 4096);
    const sim = boot(b.t);
    const s3 = stpOf(sim, sim.topology.devices.S3);
    for (const s of ['S1', 'S2', 'S3']) expect(stpOf(sim, sim.topology.devices[s]).root).toEqual(s3.bridge);
    // the root's ports are all designated; it never blocks
    expect(roles(sim, 'S3').every((r) => r === 'designated' || r === 'disabled')).toBe(true);
    // non-roots have exactly one root port
    for (const s of ['S1', 'S2']) expect(roles(sim, s).filter((r) => r === 'root')).toHaveLength(1);
  });

  it('blocks the port furthest from the root (between S1 and S2 when S3 is root)', () => {
    const b = triangle();
    b.t = setStpPriority(b.t, 'S3', 4096);
    const sim = boot(b.t);
    const s1s2 = [b.port('S1', 'FastEthernet0/1'), b.port('S2', 'FastEthernet0/1')];
    const blocked = s1s2.filter((id) => sim.portStatus(sim.topology.interfaces[id]) === 'blocking');
    expect(blocked).toHaveLength(1);
  });

  it('is a removable plugin: the core runs without it', () => {
    const sim = new Simulation(triangle().t, [stpPlugin]).boot().run();
    expect(sim.booting).toBe(false);
  });
});
