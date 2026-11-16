// Drills: short, endlessly varied questions that build speed and accuracy
// (subnetting, longest-prefix match, MAC learning...). Problems teach a
// concept once; drills repeat it until it is automatic.
//
// Every drill kind is a plugin (see registry.ts). A kind is pure: the same
// seed and level always give the same question, so a question can be
// rebuilt anywhere (browser, server, a test) from three numbers.

import type { Rng } from '../problems/random';

export type Level = 1 | 2 | 3;
export const LEVELS: readonly Level[] = [1, 2, 3];

/** How one answer box is read. Each format has a strict parser in answers.ts. */
export type FieldFormat = 'ipv4' | 'prefix' | 'mask' | 'ipv6' | 'ipv6-full' | 'integer';

export interface InputField {
  id: string;
  label: string;
  format: FieldFormat;
  /** Shown greyed out in the empty box. */
  placeholder?: string;
}

export type DrillQuestion =
  | {
      type: 'fields';
      prompt: string;
      fields: InputField[];
      /** The right answer for each field, in its canonical text. */
      expected: Record<string, string>;
      /** The worked solution, one step per line. */
      explanation: string[];
    }
  | {
      type: 'choice';
      prompt: string;
      /** Distinct options, exactly one of which is right. */
      choices: string[];
      expected: { choice: string };
      explanation: string[];
    };

export interface DrillKind {
  /** Stable id used in URLs and saved progress. Never rename one. */
  id: string;
  title: string;
  /** One of the catalog's TOPICS, so drills sit next to the problems they support. */
  topic: string;
  /** One line on what the drill trains. */
  summary: string;
  /** What each level adds, shown on the drill picker. */
  levels: Record<Level, string>;
  /**
   * True when generating a question runs the simulator. Such kinds are graded
   * in the browser only and earn no practice XP: replaying 10 simulations in
   * one request would not fit the free server's 10 ms of CPU.
   */
  runsEngine?: boolean;
  generate(r: Rng, level: Level): DrillQuestion;
}

/** The verdict for one answer box. */
export interface FieldResult {
  correct: boolean;
  expected: string;
  /** Why the answer was not accepted, when it could not even be read (e.g. "leading zeros"). */
  problem?: string;
}

export interface CheckResult {
  correct: boolean;
  fields: Record<string, FieldResult>;
}
