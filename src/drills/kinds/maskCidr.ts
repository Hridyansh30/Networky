// Converting between prefix length and dotted mask, and counting hosts.

import { prefixToMask } from '../../model/ip';
import type { DrillKind, DrillQuestion, Level } from '../types';

const PREFIXES: Record<Level, number[]> = {
  1: [8, 16, 24, 25, 26, 27, 28, 29, 30],
  2: [17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30],
  3: Array.from({ length: 31 }, (_, i) => i + 1).filter((p) => p !== 8 && p !== 16 && p !== 24),
};

/** Usable hosts in a subnet of this length (RFC 3021: a /31 has 2, a /32 has 1). */
export function usableHosts(prefix: number): number {
  if (prefix === 32) return 1;
  if (prefix === 31) return 2;
  return 2 ** (32 - prefix) - 2;
}

export const maskCidr: DrillKind = {
  id: 'mask-cidr',
  title: 'Masks and prefixes',
  topic: 'IP Addressing',
  summary: 'Prefix to mask, mask to prefix, and how many hosts fit.',
  levels: { 1: 'Common prefixes (/8, /16, /24 to /30)', 2: 'Prefixes /17 to /30', 3: 'Any prefix from /1 to /31' },
  generate(r, level): DrillQuestion {
    const prefix = r.pick(PREFIXES[level]);
    const mask = prefixToMask(prefix);
    const hostBits = 32 - prefix;
    const way = r.int(0, level === 1 ? 1 : 2);
    if (way === 0)
      return {
        type: 'fields',
        prompt: `Write /${prefix} as a dotted subnet mask.`,
        fields: [{ id: 'mask', label: 'Subnet mask', format: 'mask', placeholder: '255.255.255.0' }],
        expected: { mask },
        explanation: [`/${prefix} means ${prefix} one-bits followed by ${hostBits} zero-bits.`, `Write them in groups of 8 and convert each group: ${mask}.`],
      };
    if (way === 1)
      return {
        type: 'fields',
        prompt: `What prefix length is the mask ${mask}?`,
        fields: [{ id: 'prefix', label: 'Prefix length', format: 'prefix', placeholder: '/24' }],
        expected: { prefix: `/${prefix}` },
        explanation: [`Count the one-bits: each 255 is 8, and the last non-zero octet adds its leading ones.`, `${mask} has ${prefix} one-bits, so it is /${prefix}.`],
      };
    return {
      type: 'fields',
      prompt: `How many usable host addresses does a /${prefix} subnet have?`,
      fields: [{ id: 'hosts', label: 'Usable hosts', format: 'integer' }],
      expected: { hosts: String(usableHosts(prefix)) },
      explanation:
        prefix >= 31
          ? [`/${prefix} is a special case: ${prefix === 31 ? 'a point-to-point link uses both addresses (RFC 3021)' : 'a single host route'}, so ${usableHosts(prefix)}.`]
          : [`/${prefix} leaves ${hostBits} host bits: 2^${hostBits} = ${2 ** hostBits} addresses.`, `Take away the network and broadcast addresses: ${2 ** hostBits} − 2 = ${usableHosts(prefix)}.`],
    };
  },
};
