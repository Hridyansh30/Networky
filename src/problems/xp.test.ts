import { describe, expect, it } from 'vitest';
import { levelOf, levelStart, problemXp, totalXp } from './xp';

describe('problemXp', () => {
  it('pays by difficulty, scaled by the best hinted score', () => {
    expect(problemXp({ difficulty: 'easy', best: 1, solutionFirst: false })).toBe(10);
    expect(problemXp({ difficulty: 'medium', best: 1, solutionFirst: false })).toBe(20);
    expect(problemXp({ difficulty: 'hard', best: 0.875, solutionFirst: false })).toBe(35);
  });
  it('pays nothing when the solution was opened first', () => {
    expect(problemXp({ difficulty: 'hard', best: 1, solutionFirst: true })).toBe(0);
  });
  it('never trusts a stored value outside 0..1', () => {
    expect(problemXp({ difficulty: 'easy', best: 7, solutionFirst: false })).toBe(10);
    expect(problemXp({ difficulty: 'easy', best: -1, solutionFirst: false })).toBe(0);
    expect(problemXp({ difficulty: 'easy', best: NaN, solutionFirst: false })).toBe(0);
  });
  it('counts each problem once: the total is a sum over problems, not over attempts', () => {
    expect(totalXp([{ difficulty: 'easy', best: 1, solutionFirst: false }, { difficulty: 'hard', best: 0.5, solutionFirst: false }])).toBe(30);
  });
});

describe('levels', () => {
  it('start at 0, 50, 150, 300, 500', () => {
    expect([1, 2, 3, 4, 5].map(levelStart)).toEqual([0, 50, 150, 300, 500]);
  });
  it('places XP inside its level', () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, span: 50 });
    expect(levelOf(49)).toEqual({ level: 1, into: 49, span: 50 });
    expect(levelOf(50)).toEqual({ level: 2, into: 0, span: 100 });
    expect(levelOf(320)).toEqual({ level: 4, into: 20, span: 200 });
  });
});
