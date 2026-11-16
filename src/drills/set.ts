// A drill set: SET_SIZE questions of one kind. A set is named by its kind
// and a seed; question i is rebuilt from (seed, i, level), so the browser,
// the server and a bug report all see the same question.

import { rng } from '../problems/random';
import type { DrillKind, DrillQuestion, Level } from './types';

export const SET_SIZE = 10;

/** The seed of question `index` in a set. A fixed odd multiplier spreads neighbouring indexes far apart. */
export function questionSeed(setSeed: number, index: number): number {
  return (setSeed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

export function questionAt(kind: DrillKind, setSeed: number, index: number, level: Level): DrillQuestion {
  if (!Number.isInteger(index) || index < 0 || index >= SET_SIZE) throw new Error(`question ${index} is outside a set of ${SET_SIZE}`);
  return kind.generate(rng(questionSeed(setSeed, index)), level);
}
