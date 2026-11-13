// The built-in problems and the tracks that order them.
//
// Predict problems (a finished network and questions about it) live in
// predicts.ts and sit in the same stages.
//
// Adding a problem: write it in this folder (one file per topic, or its own
// file; see firstPing.ts), and add it to a stage below. catalog.test.ts then checks
// it like every other problem: valid spec, start not solved, reference 100%,
// every wrong solution caught (randomized problems on many seeds).
//
// Never rename a slug or reuse one: saved progress and links use it. Change
// a problem's tests -> bump its version.

import type { ProblemSpec } from '../spec';
import { lastUsableHost, wrongMask, wrongSubnet } from './addressing';
import { firstPing } from './firstPing';
import { ipv6FirstAddress, ipv6StaticRoutes } from './ipv6';
import { joinTheLan } from './joinTheLan';
import { missingGateway } from './missingGateway';
import { predictAclOrder, predictLocalOrRemote, predictLongestMatch, predictPingVsPort, predictVlanWalls, predictWayBack } from './predicts';
import { defaultRoute, ospfSlowPath, ospfThreeRouters, portShutDown, ripSilentRouter, threeFaults } from './routing';
import { aclWebOnly, patOverload, secureTheEdge } from './security';
import { dhcpClient, dhcpPool, dhcpRelay, dnsName, webServerDown } from './services';
import { staticRoutes } from './staticRoutes';
import { stpRoot, unplugged } from './switching';
import { firstVlan, routerOnAStick, trunkLink, vlanOffice } from './vlans';
import { wrongVlan } from './wrongVlan';

/** The topic names a problem may use; the chips on the Problems page, in this order. */
export const TOPICS = ['IP Addressing', 'Switching', 'VLANs', 'Routing', 'DHCP & DNS', 'Applications', 'NAT & ACL', 'IPv6'] as const;

export interface Track {
  id: string;
  title: string;
  description: string;
  slugs: readonly string[];
}
type Stage = Omit<Track, 'slugs'> & { problems: readonly ProblemSpec[] };

/**
 * Stage-wise paths, each ordered from easy to hard. Soft order: every
 * problem stays open, the track only suggests what to do next (locking
 * content teaches nothing).
 */
const STAGES: readonly Stage[] = [
  { id: 'fundamentals', title: 'Network fundamentals', description: 'Addresses, masks and gateways: what every host needs to talk.', problems: [firstPing, wrongSubnet, wrongMask, missingGateway, predictLocalOrRemote, joinTheLan, lastUsableHost] },
  { id: 'switching', title: 'Switching & VLANs', description: 'Cables, spanning tree, and splitting one switch into separate networks.', problems: [unplugged, firstVlan, predictVlanWalls, wrongVlan, trunkLink, stpRoot, routerOnAStick, vlanOffice] },
  { id: 'routing', title: 'Routing', description: 'Getting packets between networks: static routes, RIP and OSPF.', problems: [portShutDown, defaultRoute, staticRoutes, predictWayBack, ripSilentRouter, ospfThreeRouters, threeFaults, predictLongestMatch, ospfSlowPath] },
  { id: 'services', title: 'IP services', description: 'DHCP, DNS and the web server: what users actually notice.', problems: [dhcpClient, dnsName, predictPingVsPort, webServerDown, dhcpPool, dhcpRelay] },
  { id: 'security', title: 'Network security', description: 'Access lists and NAT at the edge of the office.', problems: [aclWebOnly, predictAclOrder, patOverload, secureTheEdge] },
  { id: 'ipv6', title: 'IPv6', description: 'The same ideas with longer addresses and no ARP.', problems: [ipv6FirstAddress, ipv6StaticRoutes] },
];

/** In track order: the # column on the Problems page. */
export const PROBLEMS: readonly ProblemSpec[] = STAGES.flatMap((t) => t.problems);

export const TRACKS: readonly Track[] = STAGES.map(({ problems, ...t }) => ({ ...t, slugs: problems.map((p) => p.slug) }));

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
