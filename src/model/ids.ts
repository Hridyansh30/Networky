// Where new ids and MAC addresses come from.
//
// Model operations never make up an id on their own: they ask an IdSource.
// Two kinds exist:
//
//   randomIds       the canvas, the CLI, imports. Unique without coordination,
//                   so two devices dragged in at once never clash.
//   seededIds(seed) problems and anything that must be rebuilt identically.
//                   The same calls in the same order give byte-identical
//                   networks, on every machine and every runtime.
//
// Why it matters (phase 6): the server judge and the browser must agree on
// what a problem's start network is. With random interface ids and MACs, two
// builds of the "same" network differ, so a predict question could depend on
// which build you got, and a test comparing browser and server output could
// never pass. Injecting the source keeps the model pure: randomness is an
// input, not something the model reaches out and grabs.

import { rng } from '../problems/random';

export type IdKind = 'device' | 'interface' | 'link';

export interface IdSource {
  /** A new id for a record of this kind. Must be unique within one topology. */
  id(kind: IdKind): string;
  /** A new locally administered unicast MAC, as aa:bb:cc:dd:ee:ff. */
  mac(): string;
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-';

/** Formats 6 bytes as a MAC with the locally administered bit set and the multicast bit clear. */
export function formatMac(bytes: ArrayLike<number>): string {
  const b = Array.from({ length: 6 }, (_, i) => bytes[i] & 0xff);
  // Locally administered, never multicast: a generated MAC can never collide
  // with a real vendor's and is never treated as a group address.
  b[0] = (b[0] | 0x02) & 0xfe;
  return b.map((x) => x.toString(16).padStart(2, '0')).join(':');
}

/**
 * Random ids from the platform's secure random source (Web Crypto, present in
 * browsers, Node, Deno and Cloudflare Workers). 10 characters of a 64-letter
 * alphabet is 60 bits: a clash in one network is not a practical concern.
 */
export const randomIds: IdSource = {
  id() {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    return Array.from(bytes, (b) => ALPHABET[b & 63]).join('');
  },
  mac() {
    return formatMac(crypto.getRandomValues(new Uint8Array(6)));
  },
};

/** FNV-1a: turns a seed string into a 32-bit number. Not cryptographic, just stable. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic ids: `d1, d2 ...`, `i1, i2 ...`, `l1, l2 ...` and MACs drawn
 * from a seeded generator. Use one source per network build.
 */
export function seededIds(seed: string): IdSource {
  const counters: Record<IdKind, number> = { device: 0, interface: 0, link: 0 };
  const prefix: Record<IdKind, string> = { device: 'd', interface: 'i', link: 'l' };
  const r = rng(hash32(seed));
  return {
    id(kind) {
      counters[kind] += 1;
      return `${prefix[kind]}${counters[kind]}`;
    },
    mac() {
      return formatMac(Array.from({ length: 6 }, () => r.int(0, 255)));
    },
  };
}
