// Predict problems: look at a network, say what a ping or connection will do,
// then watch the replay to see why. The answer is never stored in the problem:
// it is whatever the simulation actually does, so a predict question can't
// drift out of date when the engine gets more accurate.

import type { Expectation } from '../grading/checks/common';
import { DEFAULT_PLUGINS } from '../engine/plugins';
import { Simulation } from '../engine/simulation';
import type { Topology } from '../model/types';
import { BOOT_STEP_BUDGET } from '../grading/grade';
import { createContext } from '../grading/context';
import type { ReplayAction } from '../grading/types';

export interface PredictQuestion {
  id: string;
  prompt: string;
  /** What to send. Only ping and TCP: their outcome is one of the choices. */
  traffic: Extract<ReplayAction, { kind: 'ping' | 'tcp' }>;
  /** The outcomes offered, e.g. success / unreachable / prohibited. Must include the real one (tests check). */
  choices: Expectation[];
  /** Shown after answering, right or wrong: the reason. */
  explanation: string;
}

/** What the network really does for this question. */
export function actualOutcome(topology: Topology, q: PredictQuestion): Expectation | 'pending' {
  const sim = new Simulation(structuredClone(topology), DEFAULT_PLUGINS).boot().run(BOOT_STEP_BUDGET);
  const ctx = createContext(sim);
  const src = ctx.device(q.traffic.from);
  if (!src) throw new Error(`${q.id}: no device ${q.traffic.from}`);
  const p = ctx.probe(q.traffic.kind === 'tcp' ? { kind: 'tcp', sourceDeviceId: src.id, destination: q.traffic.to, port: q.traffic.port } : { kind: 'ping', sourceDeviceId: src.id, destination: q.traffic.to });
  return p.status;
}

export function gradePrediction(topology: Topology, q: PredictQuestion, choice: Expectation): { correct: boolean; actual: Expectation | 'pending' } {
  const actual = actualOutcome(topology, q);
  return { correct: actual === choice, actual };
}
