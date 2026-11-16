// The engine-backed drill: the generator's own prediction (and so its
// explanation) must match what the simulator does, on every variant.

import { describe, expect, it } from 'vitest';
import { LEVELS } from '.';
import { generateReach, OUTCOME_TEXT } from './kinds/willItReach';
import { rng } from '../problems/random';

const SEEDS = 300;

describe('will it reach?', () => {
  it.each(LEVELS)('level %i: the explanation predicts what the simulator does, and every outcome comes up', (level) => {
    const seen = new Set<string>();
    for (let s = 0; s < SEEDS; s++) {
      const { question, predicted } = generateReach(rng(s * 7919 + level), level);
      expect(question.expected.choice, question.prompt).toBe(OUTCOME_TEXT[predicted]);
      seen.add(predicted);
    }
    expect([...seen].sort()).toEqual(level === 3 ? ['lost', 'success', 'unreachable'] : ['success', 'unreachable']);
  });
});
