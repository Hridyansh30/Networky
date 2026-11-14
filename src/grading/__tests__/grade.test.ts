import { describe, expect, it } from 'vitest';
import type { EnginePlugin } from '../../engine/plugin';
import { addDevice, connect } from '../../model/ops';
import { exampleById, EXAMPLES } from '../../model/examples';
import { exerciseToTest } from '../../problems/fromExercise';
import type { ProblemSpec } from '../../problems/spec';
import { DEFAULT_CHECKS, registry } from '../checks';
import { DEFAULT_PLUGINS } from '../../engine/plugins';
import { PROBLEMS } from '../../problems/catalog';
import { instantiate } from '../../problems/params';
import { ENGINE_VERSION, grade, LIMIT_MESSAGE, solved, WORK_BUDGET } from '../grade';
import { addressPc1, lanNoGateway, lanRouterDown, lanSolved, lanStart } from './fixtures';

describe('grade', () => {
  it('scores the start, the reference and a wrong solution', () => {
    expect(grade(lanStart(), addressPc1).score).toBe(0);
    const ref = grade(lanSolved(), addressPc1);
    expect(ref).toMatchObject({ slug: 'address-pc1', specVersion: 1, engineVersion: ENGINE_VERSION, scope: 'submit', score: 5, max: 5 });
    expect(solved(ref)).toBe(true);
    const wrong = grade(lanRouterDown(), addressPc1);
    expect(solved(wrong)).toBe(false);
    expect(wrong.tests.find((t) => t.id === 'pc1-to-gw')!.pass).toBe(false);
  });

  it('gives partial credit per requirement', () => {
    const r = grade(lanNoGateway(), { ...addressPc1, tests: [...addressPc1.tests, { id: 'pc1-out', requirement: 'reach', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '10.9.9.9' } } }] });
    expect(r.requirements).toEqual([
      { id: 'address', earned: 1, max: 1 },
      { id: 'reach', earned: 4, max: 7 },
    ]);
  });

  it('Run grades only the shown tests; Submit grades all of them', () => {
    const hard: ProblemSpec = { ...addressPc1, difficulty: 'hard', tests: addressPc1.tests.map((t, i) => (i === 1 ? { ...t, visibility: 'shown' } : t)) };
    expect(grade(lanSolved(), hard, { scope: 'run' }).tests.map((t) => t.id)).toEqual(['pc1-to-pc0']);
    const all = grade(lanSolved(), hard, { scope: 'submit' }).tests;
    expect(all.map((t) => [t.id, t.shown])).toEqual([
      ['pc1-address', false],
      ['pc1-to-pc0', true],
      ['pc1-to-gw', false],
    ]);
  });

  it('is deterministic: the same network always gets the same report', () => {
    const first = JSON.stringify(grade(lanNoGateway(), addressPc1));
    for (let i = 0; i < 50; i++) expect(JSON.stringify(grade(lanNoGateway(), addressPc1))).toBe(first);
  });

  it('never changes the network it grades', () => {
    const t = lanSolved();
    const before = JSON.stringify(t);
    grade(t, addressPc1);
    expect(JSON.stringify(t)).toBe(before);
  });

  it('fails traffic tests with one clear reason when the network never settles', () => {
    // A protocol that sends another frame every time the wire goes quiet,
    // forever: the network never settles within the boot budget.
    const chatty: EnginePlugin = {
      name: 'chatty',
      description: 'test only',
      boot: (sim) => chatty.onIdle!(sim),
      onIdle(sim) {
        const pc = Object.values(sim.topology.devices).find((d) => d.hostname === 'PC0')!;
        const nic = sim.interfacesOf(pc)[0];
        sim.transmit(nic, sim.makeFrame(nic.mac, 'ff:ff:ff:ff:ff:ff', { kind: 'raw' } as never));
      },
    };
    const r = grade(lanSolved(), addressPc1, { plugins: [chatty], workBudget: Infinity });
    expect(r.networkError).toMatch(/never went quiet/);
    expect(r.tests.find((x) => x.id === 'pc1-address')!.pass).toBe(true); // configuration checks still run
    expect(r.tests.filter((x) => x.id !== 'pc1-address').every((x) => !x.pass && x.detail === r.networkError)).toBe(true);
  });

  it('stops at the work budget with the same verdict every time', () => {
    const chatty: EnginePlugin = {
      name: 'chatty',
      description: 'test only',
      boot: (sim) => chatty.onIdle!(sim),
      onIdle(sim) {
        const pc = Object.values(sim.topology.devices).find((d) => d.hostname === 'PC0')!;
        const nic = sim.interfacesOf(pc)[0];
        sim.transmit(nic, sim.makeFrame(nic.mac, 'ff:ff:ff:ff:ff:ff', { kind: 'raw' } as never));
      },
    };
    const a = grade(lanSolved(), addressPc1, { plugins: [chatty] });
    const b = grade(lanSolved(), addressPc1, { plugins: [chatty] });
    expect(a.limitExceeded).toBe(true);
    expect(a.networkError).toBe(LIMIT_MESSAGE);
    expect(a.tests.find((x) => x.id === 'pc1-address')!.pass).toBe(true); // config checks still run
    expect(a.tests.filter((x) => x.id !== 'pc1-address').every((x) => !x.pass && x.detail === LIMIT_MESSAGE)).toBe(true);
    expect(b).toEqual(a);
  });

  it('a budget hit during a check fails that check', () => {
    // Booting the solved LAN takes 4 units; its pings need more than 10.
    const r = grade(lanSolved(), addressPc1, { plugins: DEFAULT_PLUGINS, workBudget: 10 });
    expect(r.networkError).toBeUndefined();
    expect(r.limitExceeded).toBe(true);
    expect(r.tests.some((x) => x.detail === LIMIT_MESSAGE)).toBe(true);
    expect(r.score).toBeLessThan(r.max);
  });

  it('every problem network in the catalog fits well inside the budget', () => {
    for (const spec of PROBLEMS) {
      for (const seed of spec.params ? [1, 2, 3] : [undefined]) {
        const p = instantiate(spec, seed);
        const nets = [p.start(p.values), ...(p.reference ? [p.reference(p.values)] : []), ...(p.wrong ?? []).map((w) => w(p.values))];
        for (const n of nets) {
          const r = grade(n, p, { seed, workBudget: WORK_BUDGET / 10 });
          expect(r.limitExceeded, `${spec.slug} needs more than a tenth of the budget`).toBeUndefined();
        }
      }
    }
  });

  it('stays bounded on a switching loop without STP', () => {
    const t = lanSolved();
    let looped = addDevice(t, 'switch', { id: 'Switch1', hostname: 'Switch1' }).topology;
    const free = (dev: string) => looped.devices[dev].interfaceIds.map((id) => looped.interfaces[id]).filter((i) => !i.linkId && i.name.startsWith('Fast'));
    for (let k = 0; k < 2; k++) looped = connect(looped, free('Switch0')[0].id, free('Switch1')[0].id, 'copper-cross').topology;
    const r = grade(looped, addressPc1, { plugins: [] });
    expect(r.tests).toHaveLength(3); // it finishes and reports every test
  });

  it('reports a broken test instead of crashing', () => {
    const bad: ProblemSpec = { ...addressPc1, tests: [{ id: 'x', requirement: 'reach', points: 1, check: { kind: 'nope', params: {} } }, { id: 'y', requirement: 'reach', points: 1, check: { kind: 'reach', params: { from: 'PC1' } } }] };
    const r = grade(lanSolved(), bad);
    expect(r.tests.map((t) => t.detail)).toEqual(["This test uses an unknown check 'nope' (a bug in the problem).", 'This test has invalid parameters (a bug in the problem).']);
  });
});

describe('the sample labs on the new grader', () => {
  for (const lab of EXAMPLES) {
    it(`${lab.id}: every exercise passes as a test`, () => {
      const spec: ProblemSpec = {
        slug: lab.id,
        version: 1,
        title: lab.name,
        topic: lab.topics[0],
        difficulty: 'easy',
        type: 'predict',
        statement: lab.description,
        requirements: [{ id: 'exercises', text: 'Every exercise ends as described', hints: ['a', 'b', 'c'] }],
        tests: lab.exercises.map((x, i) => exerciseToTest(x, i)),
        start: () => lab.build().topology,
        reference: () => lab.build().topology,
        wrong: [],
      };
      const r = grade(lab.build().topology, spec);
      expect(r.tests.filter((t) => !t.pass).map((t) => `${t.id}: ${t.detail}`)).toEqual([]);
    });
  }
});

describe('check registry (modularity)', () => {
  it('a problem still grades with one check kind removed; tests of that kind report it', () => {
    const without = registry(DEFAULT_CHECKS.filter((c) => c.kind !== 'interfaceIp'));
    const r = grade(lanSolved(), addressPc1, { checks: without });
    expect(r.tests.find((t) => t.id === 'pc1-address')!.detail).toMatch(/unknown check/);
    expect(r.tests.filter((t) => t.id !== 'pc1-address').every((t) => t.pass)).toBe(true);
  });
  it('refuses two checks with the same kind', () => {
    expect(() => registry([...DEFAULT_CHECKS, DEFAULT_CHECKS[0]])).toThrow(/Two checks/);
  });
  it('every check kind is unique and described', () => {
    expect(new Set(DEFAULT_CHECKS.map((c) => c.kind)).size).toBe(DEFAULT_CHECKS.length);
  });
  it('uses the lab exercises unchanged', () => {
    expect(exerciseToTest(exampleById('office-edge-nat-acl')!.exercises[2], 2).check).toEqual({ kind: 'tcp', params: { from: 'PC1', to: '203.0.113.80', port: 22, expect: 'prohibited' } });
  });
});
