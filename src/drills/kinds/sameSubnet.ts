// Can two hosts talk directly, or is a router needed? The question every
// PC answers before it sends a packet (local delivery vs default gateway).

import { formatIPv4, prefixToMask, prefixToMaskNum } from '../../model/ip';
import type { DrillKind, DrillQuestion, Level } from '../types';
import { privateAddress } from './util';

const PREFIXES: Record<Level, [number, number]> = { 1: [24, 24], 2: [25, 30], 3: [17, 23] };
export const SAME = 'Yes: same subnet, delivered directly';
export const DIFFERENT = 'No: different subnets, a router is needed';

export const sameSubnet: DrillKind = {
  id: 'same-subnet',
  title: 'Same subnet?',
  topic: 'IP Addressing',
  summary: 'Decide whether a host can reach another without a router.',
  levels: { 1: 'Prefix /24', 2: 'Prefixes /25 to /30', 3: 'Prefixes /17 to /23' },
  generate(r, level): DrillQuestion {
    const [lo, hi] = PREFIXES[level];
    const prefix = r.int(lo, hi);
    const size = 2 ** (32 - prefix);
    const mask = prefixToMaskNum(prefix);
    const netA = (privateAddress(r) & mask) >>> 0;
    const same = r.int(0, 1) === 0;
    // B's subnet: A's, or a neighbour (the one after, or before when A's is the last of its /8).
    const netB = same ? netA : (netA & 0xffffff) + size > 0xffffff ? netA - size : netA + size;
    const host = (net: number, avoid?: number) => {
      let a: number;
      do a = net + r.int(1, size - 2);
      while (a === avoid);
      return a >>> 0;
    };
    const a = host(netA);
    const b = host(netB, a);
    return {
      type: 'choice',
      prompt: `PC-A is ${formatIPv4(a)}/${prefix}. It wants to reach ${formatIPv4(b)}. Can it deliver the packet directly?`,
      choices: [SAME, DIFFERENT],
      expected: { choice: same ? SAME : DIFFERENT },
      explanation: [
        `PC-A applies its own mask (${prefixToMask(prefix)}) to both addresses.`,
        `PC-A's network: ${formatIPv4(netA)}. The destination's network under the same mask: ${formatIPv4(netB)}.`,
        same ? 'They match, so PC-A ARPs for the destination itself.' : 'They differ, so PC-A sends the packet to its default gateway.',
      ],
    };
  },
};
