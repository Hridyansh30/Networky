// Seeded randomness for problem variants.
//
// Hard problems change their numbers on every attempt (subnets, VLAN ids,
// host addresses), so a copied answer fails while anyone who understands the
// problem solves every variant. The same seed must always give the same
// variant: the grader, the hints and the learner's saved attempt all rebuild
// it from the seed. Math.random() can't do that, so this is a tiny seeded
// generator (mulberry32: 32-bit state, fast, good enough for picking
// numbers; NOT for anything secret).

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** One element of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** `count` different integers in [min, max], in random order. */
  distinct(count: number, min: number, max: number): number[];
}

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new Error(`bad range ${min}..${max}`);
    return min + Math.floor(next() * (max - min + 1));
  };
  return {
    next,
    int,
    pick: (items) => {
      if (!items.length) throw new Error('pick from an empty list');
      return items.at(int(0, items.length - 1))!;
    },
    distinct(count, min, max) {
      if (count > max - min + 1) throw new Error(`cannot pick ${count} distinct values from ${min}..${max}`);
      const seen = new Set<number>();
      while (seen.size < count) seen.add(int(min, max));
      return [...seen];
    },
  };
}

/** A fresh seed for a new attempt. Uses the platform's random source, not the seeded one. */
export function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** Private /24 networks a problem can draw LANs from, as their first three octets. */
export function privateLan24(r: Rng): string {
  switch (r.int(0, 2)) {
    case 0:
      return `10.${r.int(0, 255)}.${r.int(0, 255)}`;
    case 1:
      return `172.${r.int(16, 31)}.${r.int(0, 255)}`;
    default:
      return `192.168.${r.int(0, 255)}`;
  }
}
