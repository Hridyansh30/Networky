// Every drill kind, in the order the drill picker shows them.
//
// Adding a kind: write it in kinds/ (see subnetRange.ts), add it here, and
// drills.test.ts checks it like the others: every level, thousands of
// seeds, one right answer, the answer accepted by its own checker.
// Never rename an id: saved progress and links use it.

import type { DrillKind } from './types';
import { ipv6Shorten } from './kinds/ipv6Shorten';
import { longestMatch } from './kinds/longestMatch';
import { macTable } from './kinds/macTable';
import { maskCidr } from './kinds/maskCidr';
import { sameSubnet } from './kinds/sameSubnet';
import { subnetRange } from './kinds/subnetRange';
import { willItReach } from './kinds/willItReach';

export const DRILL_KINDS: readonly DrillKind[] = [subnetRange, maskCidr, sameSubnet, longestMatch, macTable, ipv6Shorten, willItReach];

export function drillKind(id: string): DrillKind | undefined {
  return DRILL_KINDS.find((k) => k.id === id);
}
