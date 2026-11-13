// XP and levels.
//
// Rules (agreed with the team, phase 5):
//  - A problem is worth XP by difficulty: easy 10, medium 20, hard 40.
//  - You earn that XP times your BEST hinted score on it, so hints cost XP
//    exactly as they cost points (see grading/hints.ts).
//  - Each problem counts once. Solving it again, or solving another variant
//    of a randomized problem, can raise your best but never adds on top.
//  - Opening the solution before solving zeroes that problem's XP: otherwise
//    "fail three times, load the answer, submit" would pay full XP.
//
// Until the phase 6 server exists this is computed from progress saved in
// the browser, which the learner can edit. Good for motivation; never use it
// for ranking. Ranked XP will come from server-side re-grading.

import type { Difficulty } from './spec';

export const XP_BY_DIFFICULTY: Readonly<Record<Difficulty, number>> = { easy: 10, medium: 20, hard: 40 };

/** What XP needs from one problem's saved progress. */
export interface XpInput {
  difficulty: Difficulty;
  /** Best hinted score over max, 0..1. */
  best: number;
  /** The solution was opened before the first solve. */
  solutionFirst: boolean;
}

export function problemXp(p: XpInput): number {
  if (p.solutionFirst) return 0;
  const best = Math.max(0, Math.min(1, Number.isFinite(p.best) ? p.best : 0));
  return Math.floor(XP_BY_DIFFICULTY[p.difficulty] * best);
}

export function totalXp(problems: readonly XpInput[]): number {
  return problems.reduce((s, p) => s + problemXp(p), 0);
}

/**
 * Level n starts at 50 * n(n-1)/2 XP: 0, 50, 150, 300, 500, ...
 * Each level needs 50 more XP than the one before, so early levels come
 * quickly and later ones take real work.
 */
export const levelStart = (level: number): number => (50 * level * (level - 1)) / 2;

export interface Level {
  level: number;
  /** XP into this level, and the size of this level. */
  into: number;
  span: number;
}

export function levelOf(xp: number): Level {
  const x = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  let level = 1;
  while (levelStart(level + 1) <= x) level++;
  return { level, into: x - levelStart(level), span: levelStart(level + 1) - levelStart(level) };
}
