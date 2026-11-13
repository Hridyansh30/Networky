import { describe, expect, it } from 'vitest';
import { grade } from '../grade';
import { nextHint, scoreWithHints } from '../hints';
import { addressPc1, lanSolved } from './fixtures';

describe('hint ladder', () => {
  const report = grade(lanSolved(), addressPc1); // address 1/1, reach 4/4
  it('costs 25% of a requirement per hint, rounded down', () => {
    expect(scoreWithHints(report, {}).score).toBe(5);
    const s = scoreWithHints(report, { reach: 1 });
    expect(s.requirements.find((r) => r.id === 'reach')).toEqual({ id: 'reach', earned: 3, max: 4, hints: 1 });
    expect(s.score).toBe(4);
    expect(s.max).toBe(5); // what was possible does not change
  });
  it('three hints leave a quarter, and cannot go below zero', () => {
    expect(scoreWithHints(report, { reach: 3 }).requirements.find((r) => r.id === 'reach')!.earned).toBe(1);
    expect(scoreWithHints(report, { reach: 99, address: -4 }).requirements.map((r) => r.hints)).toEqual([0, 3]);
  });
  it('unlocks one hint at a time', () => {
    expect(nextHint({}, 'reach')).toBe(1);
    expect(nextHint({ reach: 2 }, 'reach')).toBe(3);
    expect(nextHint({ reach: 3 }, 'reach')).toBeNull();
  });
});
