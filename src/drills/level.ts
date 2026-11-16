// How the level moves inside a set. A rule the learner can read:
// three right in a row -> one level up; two wrong in a row -> one level down.
//
// Why not an Elo-style rating? It needs many answers per learner before it
// settles, and nobody can tell why it moved. A rule you can predict is a
// rule you can trust, and a set is only 10 questions long.

import type { Level } from './types';

export const UP_AFTER = 3;
export const DOWN_AFTER = 2;

/** The level for the next question, given the level so far and the results at that level, oldest first. */
export function nextLevel(level: Level, resultsAtLevel: readonly boolean[]): Level {
  const tail = (want: boolean) => {
    let n = 0;
    for (let i = resultsAtLevel.length - 1; i >= 0 && resultsAtLevel[i] === want; i--) n++;
    return n;
  };
  if (tail(true) >= UP_AFTER && level < 3) return (level + 1) as Level;
  if (tail(false) >= DOWN_AFTER && level > 1) return (level - 1) as Level;
  return level;
}
