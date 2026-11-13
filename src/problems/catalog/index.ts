// The built-in problems and the tracks that order them.
//
// Adding a problem: write one module in this folder (see firstPing.ts), add
// it to PROBLEMS, and put its slug in a track. catalog.test.ts then checks
// it like every other problem: valid spec, start not solved, reference 100%,
// every wrong solution caught (randomized problems on many seeds).
//
// Never rename a slug or reuse one: saved progress and links use it. Change
// a problem's tests -> bump its version.

import type { ProblemSpec } from '../spec';
import { firstPing } from './firstPing';
import { joinTheLan } from './joinTheLan';
import { missingGateway } from './missingGateway';
import { staticRoutes } from './staticRoutes';
import { wrongVlan } from './wrongVlan';

/** The topic names a problem may use; the chips on the Problems page, in this order. */
export const TOPICS = ['IP Addressing', 'Switching', 'VLANs', 'Routing', 'DHCP & DNS', 'NAT & ACL', 'IPv6', 'Applications'] as const;

/** In list order: the # column on the Problems page. */
export const PROBLEMS: readonly ProblemSpec[] = [firstPing, missingGateway, wrongVlan, staticRoutes, joinTheLan];

export interface Track {
  id: string;
  title: string;
  description: string;
  slugs: readonly string[];
}

/**
 * Stage-wise paths. Soft order: every problem stays open, the track only
 * suggests what to do next (locking content teaches nothing).
 */
export const TRACKS: readonly Track[] = [
  { id: 'fundamentals', title: 'Network fundamentals', description: 'Addresses, masks and gateways: what every host needs to talk.', slugs: ['first-ping', 'missing-gateway', 'join-the-lan'] },
  { id: 'switching', title: 'Switching & VLANs', description: 'How switches split one wire into separate networks.', slugs: ['wrong-vlan'] },
  { id: 'routing', title: 'Routing', description: 'Getting packets between networks, one hop at a time.', slugs: ['static-routes'] },
];

const BY_SLUG = new Map(PROBLEMS.map((p) => [p.slug, p]));

export const problemBySlug = (slug: string): ProblemSpec | undefined => BY_SLUG.get(slug);

/** 1-based position in the list, for the # column. */
export const problemNumber = (slug: string): number => PROBLEMS.findIndex((p) => p.slug === slug) + 1;

/**
 * Today's challenge: the same problem for everyone on a given local date.
 * A pure function of the date, so it needs no server.
 */
export function dailyProblem(date: Date = new Date()): ProblemSpec {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return PROBLEMS[((day * 2654435761) >>> 0) % PROBLEMS.length];
}
