// The grading contract.
//
// A problem is a start network plus test cases. A test case names a CHECK
// (a kind of assertion, like "this ping succeeds" or "this switch is the STP
// root") and gives it parameters. Each check kind is a plugin: one file in
// checks/, listed in checks/index.ts, exactly like engine protocols are
// EnginePlugins. Adding a kind of test = one file + one list entry.
//
// Rules for check authors:
//  1. A check only READS the network (topology, routes, leases, probes it
//     sends). It never edits configuration.
//  2. It must be deterministic: same network, same params, same result.
//  3. It explains a failure in words a learner can act on, and says where
//     traffic was dropped when it knows (dropAt).

import type { ZodType } from 'zod';
import type { Probe, ProbeRequest } from '../engine/plugin';
import type { Simulation } from '../engine/simulation';
import type { Device, Interface, Topology } from '../model/types';

/** Where a failed exchange died, for "Show me" replays and hints. */
export interface DropPoint {
  /** Hostname of the device that dropped or refused the traffic, when known. */
  device?: string;
  reason: string;
}

export interface CheckResult {
  pass: boolean;
  /** One sentence: what happened. Shown under the test. */
  detail: string;
  dropAt?: DropPoint;
}

/** What a check may use. Built fresh for every grade. */
export interface GradeContext {
  readonly sim: Simulation;
  readonly topology: Topology;
  /** The device with this hostname, or undefined. Tests name devices by hostname. */
  device(hostname: string): Device | undefined;
  /** A device's port by name (e.g. 'GigabitEthernet0/1'). */
  port(device: Device, name: string): Interface | undefined;
  /** Send a ping or TCP probe and run the network until it finishes (within the step budget). */
  probe(request: ProbeRequest): Probe;
  /** Run the network until it is quiet (within the step budget). */
  settle(): void;
  /** The last drop the engine logged since `tick`, if any. */
  dropSince(tick: number): DropPoint | undefined;
}

export interface CheckPlugin<P = unknown> {
  readonly kind: string;
  /** Validates the test's params. Strict: unknown keys are a bug in the problem. */
  readonly schema: ZodType<P>;
  /** The sentence shown in the Tests tab, e.g. "PC1 can ping 10.0.2.5". */
  describe(params: P): string;
  /** Behaviour checks send traffic; config checks only read settings. Used to fade tests by difficulty. */
  readonly behaviour: boolean;
  run(ctx: GradeContext, params: P): CheckResult;
  /**
   * Behaviour checks that send traffic say how to send it again, so the
   * problem page can replay a failed test in Simulation mode ("Show me").
   */
  replay?(params: P): ReplayAction;
}

/** Traffic to re-send on the learner's own network, naming hosts by hostname. */
export type ReplayAction =
  | { kind: 'ping'; from: string; to: string }
  | { kind: 'tcp'; from: string; to: string; port: number }
  | { kind: 'http'; from: string; url: string };

/** A check plus its params, as written in a problem. */
export interface CheckCall {
  kind: string;
  params: unknown;
}

export type Visibility = 'shown' | 'hidden';

export interface TestCase {
  /** Stable within the problem: progress and reports refer to it. */
  id: string;
  /** The requirement this test proves. */
  requirement: string;
  points: number;
  /** Absent = decided by the problem's difficulty (see problems/spec.ts). */
  visibility?: Visibility;
  check: CheckCall;
}

export interface TestResult {
  id: string;
  requirement: string;
  pass: boolean;
  shown: boolean;
  points: number;
  earned: number;
  /** The test's sentence. Hidden tests are named only after they fail, never their setup. */
  title: string;
  detail: string;
  dropAt?: DropPoint;
}

export interface GradeReport {
  slug: string;
  specVersion: number;
  engineVersion: string;
  /** 'run' = shown tests only (the Run button); 'submit' = every test. */
  scope: 'run' | 'submit';
  seed?: number;
  score: number;
  max: number;
  requirements: { id: string; earned: number; max: number }[];
  tests: TestResult[];
  /** Set when the network never went quiet (e.g. a broadcast storm): every behaviour test failed for this reason. */
  networkError?: string;
  /** True when grading stopped because the network used up the work budget (see WORK_BUDGET). */
  limitExceeded?: boolean;
}
