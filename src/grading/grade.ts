// grade(network, problem) -> report. Pure and deterministic: it never touches
// the learner's own simulation, only a fresh copy it boots itself, so the
// same network always gets the same report (a test proves it).
//
// Tests run in the order the problem lists them, on ONE booted network. That
// is cheaper than booting per test and closer to a real network, but it means
// a test can leave state behind (ARP caches, MAC tables, NAT entries) for the
// next one. Problems are written so that order never changes a verdict; the
// reference/wrong-solution tests would catch it if it did.

import { DEFAULT_PLUGINS } from '../engine/plugins';
import type { EnginePlugin } from '../engine/plugin';
import { Simulation } from '../engine/simulation';
import type { Topology } from '../model/types';
import { visibilityOf, type ProblemSpec } from '../problems/spec';
import { registry, type CheckRegistry } from './checks';
import { createContext } from './context';
import type { GradeReport, TestResult } from './types';

/**
 * Bump when an engine or check change can change a verdict. Stored with
 * every report so an old score is never silently reinterpreted.
 */
export const ENGINE_VERSION = '2';
// History:
//   1  phase 5.
//   2  phase 6: a work budget can end a grade (limitExceeded), and problem
//      networks are built with seeded ids and MACs.

/** Steps the control plane (STP, routing, DHCP) gets to converge. */
export const BOOT_STEP_BUDGET = 5000;

/**
 * Total work one grade may do, in Simulation work units (a step plus each
 * frame delivered). The busiest start, reference or wrong network in the
 * catalog uses 146 units (secure-the-edge), so 3,000 is about 20 times the
 * most any real solution needs.
 *
 * Why units and not seconds: a time limit gives a different verdict on a slow
 * laptop and a fast server. A unit budget is a property of the network alone,
 * so the browser and the judge always agree. It also caps the CPU a hostile
 * network can burn on the server (measured: 3 to 26 microseconds per unit,
 * the high end on large OSPF networks).
 */
export const WORK_BUDGET = 3000;

export const LIMIT_MESSAGE = 'Grading stopped: this network needed more simulation work than any solution to this problem should (a loop, a storm, or far more devices than the problem uses).';

export interface GradeOptions {
  scope?: 'run' | 'submit';
  checks?: CheckRegistry;
  plugins?: readonly EnginePlugin[];
  seed?: number;
  /** Override WORK_BUDGET (tests). */
  workBudget?: number;
}

export function grade(topology: Topology, spec: ProblemSpec, opts: GradeOptions = {}): GradeReport {
  const scope = opts.scope ?? 'submit';
  const checks = opts.checks ?? registry();
  // structuredClone: the engine treats the topology as read-only, but the
  // grader must not depend on that promise to keep the learner's data safe.
  const sim = new Simulation(structuredClone(topology), opts.plugins ?? DEFAULT_PLUGINS);
  sim.workBudget = opts.workBudget ?? WORK_BUDGET;
  sim.boot().run(BOOT_STEP_BUDGET);
  const networkError = sim.overBudget
    ? LIMIT_MESSAGE
    : sim.isIdle()
      ? undefined
      : 'The network never went quiet after start-up (a switching loop or a broadcast storm?), so traffic tests could not run.';
  const ctx = createContext(sim);

  const tests: TestResult[] = [];
  for (const t of spec.tests) {
    const shown = visibilityOf(t, spec.difficulty, checks) === 'shown';
    if (scope === 'run' && !shown) continue;
    const check = checks.get(t.check.kind);
    const base = { id: t.id, requirement: t.requirement, shown, points: t.points };
    if (!check) {
      tests.push({ ...base, pass: false, earned: 0, title: t.id, detail: `This test uses an unknown check '${t.check.kind}' (a bug in the problem).` });
      continue;
    }
    const params = check.schema.safeParse(t.check.params);
    if (!params.success) {
      tests.push({ ...base, pass: false, earned: 0, title: t.id, detail: 'This test has invalid parameters (a bug in the problem).' });
      continue;
    }
    const title = check.describe(params.data);
    if ((networkError || sim.overBudget) && check.behaviour) {
      tests.push({ ...base, pass: false, earned: 0, title, detail: networkError ?? LIMIT_MESSAGE });
      continue;
    }
    let result;
    try {
      result = check.run(ctx, params.data);
    } catch (e) {
      result = { pass: false, detail: `The check crashed: ${(e as Error).message}` };
    }
    // The budget ran out during this check: whatever it saw is incomplete.
    if (sim.overBudget && check.behaviour) result = { pass: false, detail: LIMIT_MESSAGE };
    tests.push({ ...base, title, pass: result.pass, earned: result.pass ? t.points : 0, detail: result.detail, dropAt: result.dropAt });
  }

  const requirements = spec.requirements
    .map((r) => {
      const mine = tests.filter((t) => t.requirement === r.id);
      return { id: r.id, earned: mine.reduce((s, t) => s + t.earned, 0), max: mine.reduce((s, t) => s + t.points, 0) };
    })
    .filter((r) => r.max > 0);

  return {
    slug: spec.slug,
    specVersion: spec.version,
    engineVersion: ENGINE_VERSION,
    scope,
    seed: opts.seed,
    score: tests.reduce((s, t) => s + t.earned, 0),
    max: tests.reduce((s, t) => s + t.points, 0),
    requirements,
    tests,
    networkError,
    ...(sim.overBudget ? { limitExceeded: true } : {}),
  };
}

/** True when every test in the report passed. */
export const solved = (r: GradeReport) => r.max > 0 && r.score === r.max;
