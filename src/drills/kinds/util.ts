// Small helpers the drill kinds share.

import { formatIPv4 } from '../../model/ip';
import type { Rng } from '../../problems/random';

/** A random address in one of the private ranges (10/8, 172.16/12, 192.168/16). */
export function privateAddress(r: Rng): number {
  switch (r.int(0, 2)) {
    case 0:
      return ((10 << 24) >>> 0) + r.int(0, 0xffffff);
    case 1:
      return ((172 << 24) >>> 0) + (16 << 16) + r.int(0, 0xfffff);
    default:
      return ((192 << 24) >>> 0) + (168 << 16) + r.int(0, 0xffff);
  }
}

export const ip = formatIPv4;

/** "3rd" for 3. */
export const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** A list in random order (Fisher-Yates on the seeded generator). */
export function shuffle<T>(r: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    [out[i], out[j]] = [out.at(j)!, out.at(i)!];
  }
  return out;
}
