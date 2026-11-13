import { beforeEach, describe, expect, it } from 'vitest';
import { setDefaultGateway, setInterfaceIp } from '../model/ops';
import { deserialize } from '../model/serialize';
import { firstPing } from '../problems/catalog/firstPing';
import { MemoryProgress } from '../storage/progressRepository';
import { resetProblemStore, SOLUTION_AFTER_FAILS, solutionUnlocked, useProblemStore } from './problemStore';
import { useProjectStore } from './projectStore';
import { useTopologyStore } from './topologyStore';

let repo: MemoryProgress;
const s = () => useProblemStore.getState();
const progress = (slug = 'first-ping') => s().progress[slug];

/** Edits PC1 the way a learner would, through the topology store. */
function configurePc1(address: string, gateway?: string) {
  useTopologyStore.getState().apply(({ topology, layout }) => {
    const port = topology.devices.PC1.interfaceIds[0];
    let t = setInterfaceIp(topology, port, { address, prefixLength: 24 });
    if (gateway) t = setDefaultGateway(t, 'PC1', gateway);
    return { topology: t, layout };
  });
}

beforeEach(() => {
  repo = new MemoryProgress();
  resetProblemStore(repo);
  useProjectStore.getState().newProject();
});

describe('problem store', () => {
  it('opens a problem: its start network and layout, marked as a problem (not unsaved playground work)', async () => {
    expect(await s().open('first-ping')).toBe(true);
    const t = useTopologyStore.getState();
    expect(Object.keys(t.topology.devices).sort()).toEqual(['PC0', 'PC1', 'R1', 'S1']);
    expect(t.layout.PC1).toEqual(firstPing.layout!.PC1);
    expect(useProjectStore.getState().problem).toBe('first-ping');
    expect(useProjectStore.getState().isDirty()).toBe(false);
    expect(await repo.get('first-ping')).not.toBeNull();
  });

  it('refuses an unknown slug', async () => {
    expect(await s().open('no-such-problem')).toBe(false);
  });

  it('saves the attempt and restores it on the next visit', async () => {
    await s().open('first-ping');
    configurePc1('192.168.1.11', '192.168.1.1');
    await s().flush();
    s().close();
    resetProblemStore(repo); // a reload: nothing in memory, same storage
    useProjectStore.getState().newProject();
    await s().open('first-ping');
    const pc1 = useTopologyStore.getState().topology.devices.PC1;
    expect(useTopologyStore.getState().topology.interfaces[pc1.interfaceIds[0]].ipv4?.address).toBe('192.168.1.11');
  });

  it('a solving submit marks it solved and records the best hinted score', async () => {
    await s().open('first-ping');
    await s().unlockHint('reach');
    configurePc1('192.168.1.11', '192.168.1.1');
    await s().submit();
    expect(s().report?.score).toBe(s().report?.max);
    expect(progress().solved).toBe(true);
    // reach is worth 4 of 6 points; one hint costs a quarter of it: 2 + 3 = 5 of 6
    expect(progress().best).toBeCloseTo(5 / 6);
    expect(progress().last).toEqual({ score: 5, max: 6 });
  });

  it('a failing submit is feedback, not credit', async () => {
    await s().open('first-ping');
    configurePc1('192.168.2.11', '192.168.1.1'); // wrong subnet: fails everything
    await s().submit();
    expect(progress().solved).toBe(false);
    expect(progress().best).toBe(0);
    expect(progress().failedSubmits).toBe(1);
  });

  it('never lowers the best score on a later, more hinted solve (no farming either way)', async () => {
    await s().open('first-ping');
    configurePc1('192.168.1.11', '192.168.1.1');
    await s().submit();
    expect(progress().best).toBe(1);
    await s().unlockHint('address');
    await s().submit();
    expect(progress().best).toBe(1);
    expect(progress().submits).toBe(2);
  });

  it('Run grades only the shown tests and changes no progress', async () => {
    await s().open('static-routes');
    await s().run();
    expect(s().report?.scope).toBe('run');
    expect(s().report?.tests.every((t) => t.shown)).toBe(true);
    expect(progress('static-routes').submits).toBe(0);
  });

  it('unlocks hints one at a time, at most three', async () => {
    await s().open('first-ping');
    for (let i = 0; i < 5; i++) await s().unlockHint('reach');
    expect(progress().hints).toEqual({ reach: 3 });
    await s().unlockHint('not-a-requirement');
    expect(progress().hints).toEqual({ reach: 3 });
  });

  it(`locks the solution until solved or ${SOLUTION_AFTER_FAILS} failed submits, and opening it first costs the XP`, async () => {
    await s().open('first-ping');
    await s().openSolution();
    expect(progress().solutionOpened).toBe(false);
    for (let i = 0; i < SOLUTION_AFTER_FAILS; i++) await s().submit();
    expect(solutionUnlocked(progress())).toBe(true);
    await s().openSolution();
    expect(progress().solutionFirst).toBe(true);
    s().loadReference();
    await s().submit();
    expect(progress().solved).toBe(true);
    expect(progress().solutionFirst).toBe(true); // stays: XP for this problem is 0
  });

  it('opening the solution after solving costs nothing', async () => {
    await s().open('first-ping');
    configurePc1('192.168.1.11', '192.168.1.1');
    await s().submit();
    await s().openSolution();
    expect(progress().solutionOpened).toBe(true);
    expect(progress().solutionFirst).toBe(false);
  });

  it('gives a randomized problem a seed, keeps it across visits, and restart draws a new variant', async () => {
    await s().open('join-the-lan');
    const seed = progress('join-the-lan').seed;
    expect(seed).toBeTypeOf('number');
    s().close();
    await s().open('join-the-lan');
    expect(progress('join-the-lan').seed).toBe(seed);
    const before = s().variant!.values;
    await s().restart();
    expect(progress('join-the-lan').seed).not.toBe(seed);
    expect(s().variant!.values).not.toEqual(before);
  });

  it('starts fresh when the problem version changed, but keeps what was earned', async () => {
    await repo.put({ slug: 'first-ping', specVersion: 0 + 99, hints: { reach: 2 }, best: 0.5, solved: true, solutionFirst: false, solutionOpened: false, submits: 4, failedSubmits: 3, attempt: '{"broken": true}', updatedAt: 1 });
    await s().open('first-ping');
    expect(progress().specVersion).toBe(firstPing.version);
    expect(progress().solved).toBe(true);
    expect(progress().best).toBe(0.5);
    expect(progress().hints).toEqual({});
    expect(progress().failedSubmits).toBe(0);
  });

  it('drops a damaged saved network and opens the start network instead', async () => {
    await s().open('first-ping');
    await repo.put({ ...progress(), attempt: 'not json' });
    resetProblemStore(repo);
    await s().open('first-ping');
    expect(Object.keys(useTopologyStore.getState().topology.devices)).toHaveLength(4);
    expect(() => deserialize(progress().attempt!)).not.toThrow();
  });
});
