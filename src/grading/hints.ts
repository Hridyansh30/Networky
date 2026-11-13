// The hint ladder: three hints per requirement, from the concept to the exact
// command. Each one unlocked costs a quarter of that requirement's points, so
// hints stay useful (you can still pass) without being free (clicking through
// all three leaves a quarter of the credit).

import type { GradeReport } from './types';

export const HINT_LEVELS = 3;
export const HINT_COST = 0.25;

/** Hints unlocked per requirement id, 0 to 3. */
export type HintsUsed = Readonly<Record<string, number>>;

export interface HintedScore {
  score: number;
  max: number;
  requirements: { id: string; earned: number; max: number; hints: number }[];
}

const clampHints = (n: number | undefined) => Math.max(0, Math.min(HINT_LEVELS, Math.floor(n ?? 0)));

/**
 * The score after hint costs. A requirement's earned points shrink by 25% per
 * hint, rounded down, never below zero. `max` is unchanged: hints lower what
 * you got, not what was possible.
 */
export function scoreWithHints(report: GradeReport, used: HintsUsed): HintedScore {
  const requirements = report.requirements.map((r) => {
    const hints = clampHints(used[r.id]);
    return { ...r, hints, earned: Math.max(0, Math.floor(r.earned * (1 - HINT_COST * hints))) };
  });
  return { score: requirements.reduce((s, r) => s + r.earned, 0), max: report.max, requirements };
}

/** Unlocking is one step at a time: the next hint for a requirement, or null when all are open. */
export function nextHint(used: HintsUsed, requirement: string): number | null {
  const n = clampHints(used[requirement]);
  return n < HINT_LEVELS ? n + 1 : null;
}
