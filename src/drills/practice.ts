// Practice XP: what a finished drill set is worth.
//
// Kavya's call (phase 7 review): practice matters, so drills earn XP. But a
// generator that never runs out would make XP measure hours, not skill, and
// the generators are public, so a script can answer any drill. So:
//
//  - Each right answer is worth its level (1, 2 or 3): harder questions pay more.
//  - At most PRACTICE_XP_PER_DAY a day (UTC). A script then earns exactly what
//    a diligent learner earns, so writing one gains nothing; and the cap is
//    an honest model of diminishing returns (the 200th drill of the day
//    teaches less than the 20th).
//  - Practice XP counts on the weekly board, which rewards coming back.
//    The all-time board and your level stay problem XP: what you can solve.
//
// The server replays the whole set from its seed with replaySet(): the
// client never says which level a question was or whether it was right.

import { checkAnswer } from './check';
import { nextLevel } from './level';
import { questionAt, SET_SIZE } from './set';
import type { CheckResult, DrillKind, Level } from './types';

export const PRACTICE_XP_PER_DAY = 30;

export interface ReplayedQuestion {
  index: number;
  level: Level;
  correct: boolean;
  check: CheckResult;
}

/**
 * Grades a whole set: question i is rebuilt at the level the rule gives
 * after questions 0..i-1, so the levels follow from the answers alone.
 * Missing answers count as wrong.
 */
export function replaySet(kind: DrillKind, seed: number, startLevel: Level, answers: readonly Readonly<Record<string, string>>[]): ReplayedQuestion[] {
  const out: ReplayedQuestion[] = [];
  let level = startLevel;
  let atLevel: boolean[] = [];
  for (let i = 0; i < SET_SIZE; i++) {
    const q = questionAt(kind, seed, i, level);
    const check = checkAnswer(q, answers[i] ?? {});
    out.push({ index: i, level, correct: check.correct, check });
    atLevel.push(check.correct);
    const next = nextLevel(level, atLevel);
    if (next !== level) atLevel = [];
    level = next;
  }
  return out;
}

/** XP a set earns before the daily cap. */
export const setXp = (results: readonly ReplayedQuestion[]) => results.reduce((n, r) => n + (r.correct ? r.level : 0), 0);

/** Start of the UTC day containing `now`, in ms. The daily cap resets here. */
export const utcDayStart = (now: number) => now - (now % 86_400_000);
