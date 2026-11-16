// Writing IPv6 addresses the standard way (RFC 5952): lowercase, no leading
// zeros in a group, and the longest run of two or more all-zero groups as
// "::" (the first one when two runs tie). And back again.

import { formatIPv6 } from '../../model/ip6';
import type { DrillKind, DrillQuestion } from '../types';

const full = (groups: number[]) => groups.map((g) => g.toString(16).padStart(4, '0')).join(':');
const toBig = (groups: number[]) => groups.reduce((n, g) => (n << 16n) | BigInt(g), 0n);

export const ipv6Shorten: DrillKind = {
  id: 'ipv6-shorten',
  title: 'IPv6 notation',
  topic: 'IPv6',
  summary: 'Shorten an IPv6 address correctly, or write it out in full.',
  levels: { 1: 'One run of zeros', 2: 'Two runs of zeros: pick the right one', 3: 'Expand a short address to all 8 groups' },
  generate(r, level): DrillQuestion {
    const groups: number[] = [0x2001, 0x0db8];
    for (let i = 2; i < 8; i++) groups.push(r.pick([0, r.int(1, 0xf), r.int(0x10, 0xff), r.int(0x100, 0xfff), r.int(0x1000, 0xffff)]));
    // Lay down the zero runs this level is about.
    const zeroRun = (start: number, len: number) => {
      for (let i = start; i < start + len && i < 8; i++) groups[i] = 0;
    };
    const nonZero = (i: number) => {
      if (i < 8 && groups[i] === 0) groups[i] = r.int(1, 0xfff);
    };
    if (level === 2) {
      const a = r.int(2, 3);
      const lenA = r.int(2, 5 - a); // leaves room for a second run of at least 2
      const b = a + lenA + 1;
      const lenB = r.int(2, 8 - b);
      for (let i = 2; i < 8; i++) nonZero(i);
      zeroRun(a, lenA);
      zeroRun(b, lenB);
    } else {
      const start = r.int(2, 5);
      const len = r.int(2, 8 - start);
      for (let i = 2; i < 8; i++) nonZero(i);
      zeroRun(start, len);
      if (r.int(0, 1)) {
        // A lone zero group elsewhere: written as 0, never as ::.
        const lone = [...Array(8).keys()].filter((i) => i >= 2 && groups[i] !== 0 && groups[i - 1] !== 0 && (i === 7 || groups[i + 1] !== 0));
        if (lone.length) groups[r.pick(lone)] = 0;
      }
    }
    const short = formatIPv6(toBig(groups));
    if (level === 3)
      return {
        type: 'fields',
        prompt: `Write ${short} out in full: all 8 groups, 4 hex digits each.`,
        fields: [{ id: 'full', label: 'Full address', format: 'ipv6-full' }],
        expected: { full: full(groups) },
        explanation: [`"::" stands for as many all-zero groups as it takes to make 8: here ${8 - short.split('::').join(':').split(':').filter(Boolean).length}.`, `Pad every group to 4 digits: ${full(groups)}.`],
      };
    return {
      type: 'fields',
      prompt: `Write ${full(groups)} in its shortest standard form.`,
      fields: [{ id: 'short', label: 'Short form', format: 'ipv6' }],
      expected: { short },
      explanation: [
        'Drop the leading zeros in every group (0db8 becomes db8, 0000 becomes 0).',
        'Replace the longest run of two or more 0 groups with "::"; if two runs tie, the first one. Only once: two "::" would be ambiguous.',
        `Result: ${short}.`,
      ],
    };
  },
};
