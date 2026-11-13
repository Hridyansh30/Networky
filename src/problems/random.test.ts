import { describe, expect, it } from 'vitest';
import { privateLan24, rng } from './random';

describe('seeded rng', () => {
  it('gives the same sequence for the same seed, and a different one otherwise', () => {
    const a = rng(42), b = rng(42), c = rng(43);
    const seq = (r: ReturnType<typeof rng>) => Array.from({ length: 20 }, () => r.int(0, 1000));
    expect(seq(a)).toEqual(seq(b));
    expect(seq(rng(42))).not.toEqual(seq(c));
  });
  it('stays inside its ranges and spreads over them', () => {
    const r = rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });
  it('picks distinct values and refuses impossible requests', () => {
    expect(new Set(rng(1).distinct(5, 1, 5)).size).toBe(5);
    expect(() => rng(1).distinct(6, 1, 5)).toThrow();
    expect(() => rng(1).int(5, 1)).toThrow();
    expect(() => rng(1).pick([])).toThrow();
  });
  it('draws private /24 networks only', () => {
    const r = rng(99);
    for (let i = 0; i < 500; i++) {
      const [a, b] = privateLan24(r).split('.').map(Number);
      expect(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)).toBe(true);
    }
  });
});
