// Routing problems: connected and static routes, RIP and OSPF.
import type { Draft } from '../../model/draft';
import type { ProblemSpec } from '../spec';
import { stable, threeInARow, twoLans } from './nets';

// ---------------------------------------------------------------- easy

export const portShutDown: ProblemSpec = {
  slug: 'port-shut-down',
  version: 1,
  title: 'Administratively down',
  topic: 'Routing',
  difficulty: 'easy',
  type: 'troubleshoot',
  statement:
    'After last night\'s maintenance nobody on the staff LAN can reach Server1 (10.0.2.10). Every address and gateway is correct and every cable is plugged in.\n\nFind what the maintenance left behind on R1 and fix it.',
  requirements: [
    { id: 'server', text: 'PC1 and Server1 reach each other', hints: ['A router only routes to networks on ports that are up.', 'Look at the port dots on R1, or run show ip interface brief: one port is red.', 'On R1: interface gi0/1, no shutdown.'] },
  ],
  tests: [
    { id: 'pc1-to-server', requirement: 'server', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '10.0.2.10' } } },
    { id: 'server-to-pc1', requirement: 'server', points: 1, check: { kind: 'reach', params: { from: 'Server1', to: '10.0.1.10' } } },
    { id: 'r1-connected', requirement: 'server', points: 1, check: { kind: 'route', params: { device: 'R1', prefix: '10.0.2.0/24', source: 'connected' } } },
  ],
  solution:
    'R1 GigabitEthernet0/1, the port toward the server LAN, is administratively down (shutdown). A port that is down has no connected route, so 10.0.2.0/24 disappears from R1\'s routing table and R1 answers "destination unreachable". "no shutdown" on that port brings the route back. Nothing else was wrong.',
  layout: twoLans().done().layout,
  start: () => twoLans().admin('R1', 'GigabitEthernet0/1', false).done().topology,
  reference: () => twoLans().done().topology,
  wrong: [],
};

/** PC1 ─ R1 ─ ISP router ─ two public servers on different networks. The ISP knows the way back. */
function stub(add: (d: Draft) => Draft = (d) => d) {
  return add(
    stable()
      .dev('pc', 'PC1', 0, 160)
      .dev('router', 'R1', 200, 40)
      .dev('router', 'ISP', 440, 40)
      .dev('server', 'Web', 680, 0)
      .dev('server', 'Mail', 680, 180)
      .link('PC1', 'FastEthernet0', 'R1', 'GigabitEthernet0/0', 'copper-cross')
      .link('R1', 'Serial0/0/0', 'ISP', 'Serial0/0/0', 'serial')
      .link('ISP', 'GigabitEthernet0/0', 'Web', 'GigabitEthernet0', 'copper-cross')
      .link('ISP', 'GigabitEthernet0/1', 'Mail', 'GigabitEthernet0', 'copper-cross')
      .ip('PC1', 'FastEthernet0', '192.168.1.10', 24)
      .gw('PC1', '192.168.1.1')
      .ip('R1', 'GigabitEthernet0/0', '192.168.1.1', 24)
      .ip('R1', 'Serial0/0/0', '100.64.0.2', 30)
      .ip('ISP', 'Serial0/0/0', '100.64.0.1', 30)
      .ip('ISP', 'GigabitEthernet0/0', '198.51.100.1', 24)
      .ip('ISP', 'GigabitEthernet0/1', '203.0.113.1', 24)
      .ip('Web', 'GigabitEthernet0', '198.51.100.80', 24)
      .gw('Web', '198.51.100.1')
      .ip('Mail', 'GigabitEthernet0', '203.0.113.25', 24)
      .gw('Mail', '203.0.113.1')
      .route('ISP', '192.168.1.0', 24, '100.64.0.2'),
  ).done();
}

export const defaultRoute: ProblemSpec = {
  slug: 'default-route',
  version: 1,
  title: 'One route for everything else',
  topic: 'Routing',
  difficulty: 'easy',
  type: 'configure',
  statement:
    'R1 is a small office router with a single serial link to its ISP (next hop 100.64.0.1). The ISP already knows how to reach the office LAN.\n\nPC1 must reach every outside network, today 198.51.100.0/24 and 203.0.113.0/24, tomorrow whatever the ISP adds. Give R1 one route that covers them all.',
  requirements: [
    { id: 'default', text: 'R1 has a default route to the ISP', hints: ['A router with one way out does not need a route per destination.', 'The default route is the prefix that matches every address: 0.0.0.0/0.', 'On R1: ip route 0.0.0.0 0.0.0.0 100.64.0.1'] },
    { id: 'reach', text: 'PC1 reaches both outside servers', hints: ['Try a ping to 198.51.100.80 and to 203.0.113.25.', 'If only one works, you wrote a route for one network, not a default route.', 'Remove the specific routes and keep 0.0.0.0/0 via 100.64.0.1.'] },
  ],
  tests: [
    { id: 'r1-default', requirement: 'default', points: 2, check: { kind: 'route', params: { device: 'R1', prefix: '0.0.0.0/0', source: 'static', via: '100.64.0.1' } } },
    { id: 'pc1-to-web', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '198.51.100.80' } } },
    { id: 'pc1-to-mail', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '203.0.113.25' } } },
  ],
  solution:
    '"ip route 0.0.0.0 0.0.0.0 100.64.0.1" on R1. The prefix 0.0.0.0/0 has a zero-length mask, so it matches every destination, and because the longest match wins it is only used when nothing more specific exists. Two static routes for the two server networks would pass today\'s pings but break the day the ISP adds a third network.',
  layout: stub().layout,
  start: () => stub().topology,
  reference: () => stub((d) => d.route('R1', '0.0.0.0', 0, '100.64.0.1')).topology,
  wrong: [
    () => stub((d) => d.route('R1', '198.51.100.0', 24, '100.64.0.1')).topology, // one network only
    () => stub((d) => d.route('R1', '198.51.100.0', 24, '100.64.0.1').route('R1', '203.0.113.0', 24, '100.64.0.1')).topology, // works today, not a default route
  ],
};

// ---------------------------------------------------------------- medium: RIP, OSPF

const TEN = [{ prefix: '10.0.0.0', prefixLength: 8 }];
const rip = (...names: string[]) => (d: Draft) => names.reduce((x, n) => x.rip(n, TEN), d);
const ospf = (...names: string[]) => (d: Draft) => names.reduce((x, n) => x.ospf(n, `${n.slice(1)}.${n.slice(1)}.${n.slice(1)}.${n.slice(1)}`, TEN), d);
const statics = (d: Draft) =>
  d
    .route('R1', '10.3.0.0', 24, '10.0.12.2')
    .route('R1', '10.0.23.0', 30, '10.0.12.2')
    .route('R2', '10.1.0.0', 24, '10.0.12.1')
    .route('R2', '10.3.0.0', 24, '10.0.23.2')
    .route('R3', '10.1.0.0', 24, '10.0.23.1')
    .route('R3', '10.0.12.0', 30, '10.0.23.1');

export const ripSilentRouter: ProblemSpec = {
  slug: 'rip-silent-router',
  version: 1,
  title: 'The router that says nothing',
  topic: 'Routing',
  difficulty: 'medium',
  type: 'troubleshoot',
  statement:
    'Three routers in a row run RIP version 2 so nobody has to maintain static routes. R2 was swapped for a new unit yesterday, and since then PC1 (10.1.0.10) and PC3 (10.3.0.10) cannot reach each other.\n\nRestore connectivity. The company rule is: no static routes, RIP only.',
  requirements: [
    { id: 'reach', text: 'PC1 and PC3 reach each other', hints: ['RIP routers learn routes from what their neighbours advertise.', 'Compare show ip protocols on the three routers: which one is not running RIP?', 'On R2: router rip, version 2, network 10.0.0.0.'] },
    { id: 'rip', text: 'The far LANs are learned through RIP, not typed in', hints: ['A static route would work but breaks the rule.', 'In the routing table, RIP routes are marked R.', 'Remove any ip route lines you added and enable RIP on R2.'] },
  ],
  tests: [
    { id: 'pc1-to-pc3', requirement: 'reach', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '10.3.0.10' } } },
    { id: 'pc3-to-pc1', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC3', to: '10.1.0.10' } } },
    { id: 'r1-learns', requirement: 'rip', points: 2, check: { kind: 'route', params: { device: 'R1', prefix: '10.3.0.0/24', source: 'rip' } } },
    { id: 'r3-learns', requirement: 'rip', points: 2, check: { kind: 'route', params: { device: 'R3', prefix: '10.1.0.0/24', source: 'rip' } } },
  ],
  solution:
    'The replacement R2 has its addresses but no RIP process, so it neither listens to R1 and R3 nor passes their networks on. "router rip", "version 2", "network 10.0.0.0" on R2 fixes it: R2 learns 10.1.0.0/24 from R1 and 10.3.0.0/24 from R3 and re-advertises each to the other side with the hop count increased by one.',
  layout: threeInARow().done().layout,
  start: () => rip('R1', 'R3')(threeInARow()).done().topology,
  reference: () => rip('R1', 'R2', 'R3')(threeInARow()).done().topology,
  wrong: [() => statics(rip('R1', 'R3')(threeInARow())).done().topology], // static routes: works, breaks the rule
};

export const ospfThreeRouters: ProblemSpec = {
  slug: 'ospf-three-routers',
  version: 1,
  title: 'Bring up OSPF',
  topic: 'Routing',
  difficulty: 'medium',
  type: 'configure',
  statement:
    'Three routers in a row have their addresses but no routing protocol, so each only knows its own connected networks: 10.1.0.0/24 behind R1, 10.3.0.0/24 behind R3, and the two /30 links between the routers.\n\nConfigure single-area OSPF (area 0) on all three so PC1 and PC3 reach each other. Do not use static routes or RIP.',
  requirements: [
    { id: 'reach', text: 'PC1 and PC3 reach each other', hints: ['OSPF routers must become neighbours on a shared link before they exchange routes.', 'Each router needs an OSPF process and network statements that cover its interfaces.', 'On every router: router ospf 1, network 10.0.0.0 0.255.255.255 area 0.'] },
    { id: 'ospf', text: 'The far LANs are learned through OSPF', hints: ['In the routing table, OSPF routes are marked O.', 'All three routers need OSPF: the middle one too.', 'Use a different router-id on each, e.g. 1.1.1.1, 2.2.2.2, 3.3.3.3.'] },
  ],
  tests: [
    { id: 'pc1-to-pc3', requirement: 'reach', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '10.3.0.10' } } },
    { id: 'pc3-to-pc1', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC3', to: '10.1.0.10' } } },
    { id: 'r1-learns', requirement: 'ospf', points: 2, check: { kind: 'route', params: { device: 'R1', prefix: '10.3.0.0/24', source: 'ospf' } } },
    { id: 'r3-learns', requirement: 'ospf', points: 2, check: { kind: 'route', params: { device: 'R3', prefix: '10.1.0.0/24', source: 'ospf' } } },
  ],
  solution:
    'On each router: "router ospf 1", a unique "router-id", and "network 10.0.0.0 0.255.255.255 area 0", which enables OSPF on every interface whose address starts with 10. The routers form neighbours over the /30 links, flood their link-state advertisements, and each computes the shortest path: R1 ends up with an O route to 10.3.0.0/24 via 10.0.12.2.',
  layout: threeInARow().done().layout,
  start: () => threeInARow().done().topology,
  reference: () => ospf('R1', 'R2', 'R3')(threeInARow()).done().topology,
  wrong: [
    () => ospf('R1', 'R3')(threeInARow()).done().topology, // the middle router was forgotten
    () => rip('R1', 'R2', 'R3')(threeInARow()).done().topology, // works, wrong protocol
    () => statics(threeInARow()).done().topology,
  ],
};

// ---------------------------------------------------------------- hard

interface Faults {
  r2Route?: boolean;
  r3NextHop?: boolean;
  pc3Gateway?: boolean;
}

/** threeInARow with static routes and up to three faults left in. */
function broken(f: Faults) {
  const d = threeInARow().route('R1', '10.3.0.0', 24, '10.0.12.2').route('R1', '10.0.23.0', 30, '10.0.12.2').route('R2', '10.1.0.0', 24, '10.0.12.1').route('R3', '10.0.12.0', 30, '10.0.23.1');
  if (!f.r2Route) d.route('R2', '10.3.0.0', 24, '10.0.23.2');
  d.route('R3', '10.1.0.0', 24, f.r3NextHop ? '10.0.23.3' : '10.0.23.1');
  d.gw('PC3', f.pc3Gateway ? '10.3.0.254' : '10.3.0.1');
  return d.done();
}

export const threeFaults: ProblemSpec = {
  slug: 'three-faults',
  version: 1,
  title: 'Three faults, one ticket',
  topic: 'Routing',
  difficulty: 'hard',
  type: 'troubleshoot',
  statement:
    'The ticket says only: "PC1 cannot reach PC3 (10.3.0.10)". The network is three routers in a row with static routes, and it worked last week.\n\nThere is more than one fault, on more than one device. Find them all: fixing the first one will not make the ping work. Keep static routing.',
  requirements: [
    { id: 'forward', text: 'Packets from PC1 arrive at PC3', hints: ['Follow the packet hop by hop: at each router, is there a route to the destination?', 'Use Simulation mode or traceroute from PC1 and note where it stops.', 'R2 has no route to 10.3.0.0/24. Add: ip route 10.3.0.0 255.255.255.0 10.0.23.2'] },
    { id: 'return', text: 'Replies from PC3 get back to PC1', hints: ['A reply is a new packet with its own journey. Start again from PC3.', 'Check PC3\'s gateway, then R3\'s route to 10.1.0.0/24: is the next hop a real neighbour?', 'PC3 gateway: 10.3.0.1. R3: replace the route via 10.0.23.3 with ip route 10.1.0.0 255.255.255.0 10.0.23.1'] },
  ],
  tests: [
    { id: 'pc1-to-pc3', requirement: 'forward', points: 3, visibility: 'shown', check: { kind: 'reach', params: { from: 'PC1', to: '10.3.0.10' } } },
    { id: 'r2-route', requirement: 'forward', points: 2, check: { kind: 'route', params: { device: 'R2', prefix: '10.3.0.0/24', source: 'static', via: '10.0.23.2' } } },
    { id: 'pc3-to-pc1', requirement: 'return', points: 2, check: { kind: 'reach', params: { from: 'PC3', to: '10.1.0.10' } } },
    { id: 'pc3-to-far-link', requirement: 'return', points: 2, check: { kind: 'reach', params: { from: 'PC3', to: '10.0.12.1' } } },
    { id: 'r3-route', requirement: 'return', points: 2, check: { kind: 'route', params: { device: 'R3', prefix: '10.1.0.0/24', source: 'static', via: '10.0.23.1' } } },
  ],
  solution:
    'Three independent faults. (1) R2 has no route to 10.3.0.0/24, so PC1\'s packet dies at R2: add "ip route 10.3.0.0 255.255.255.0 10.0.23.2". (2) PC3\'s default gateway is 10.3.0.254, an address nobody has: set 10.3.0.1. (3) R3\'s route to 10.1.0.0/24 points at 10.0.23.3, which does not exist on the link: the next hop must be R2, 10.0.23.1. The lesson: a ping failing tells you one thing is broken somewhere on the round trip, never how many.',
  layout: threeInARow().done().layout,
  start: () => broken({ r2Route: true, r3NextHop: true, pc3Gateway: true }).topology,
  reference: () => broken({}).topology,
  wrong: [() => broken({ r3NextHop: true, pc3Gateway: true }).topology, () => broken({ r2Route: true }).topology, () => broken({ r3NextHop: true }).topology, () => broken({ pc3Gateway: true }).topology],
};

/**
 * A triangle running OSPF: fast Gigabit R1─R2─R3 and a slow serial backup
 * R1═R3. `cost` sets a manual OSPF cost on the Gigabit ports named.
 */
function triangle(costs: { r1?: number; r3?: number } = {}, serialUp = true) {
  const d = stable()
    .dev('pc', 'PC1', 0, 300)
    .dev('router', 'R1', 140, 140)
    .dev('router', 'R2', 420, 0)
    .dev('router', 'R3', 700, 140)
    .dev('pc', 'PC3', 840, 300)
    .link('PC1', 'FastEthernet0', 'R1', 'GigabitEthernet0/0', 'copper-cross')
    .link('R3', 'GigabitEthernet0/0', 'PC3', 'FastEthernet0', 'copper-cross')
    .link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1', 'copper-cross')
    .link('R2', 'GigabitEthernet0/0', 'R3', 'GigabitEthernet0/1', 'copper-cross')
    .link('R1', 'Serial0/0/0', 'R3', 'Serial0/0/0', 'serial')
    .ip('PC1', 'FastEthernet0', '10.1.0.10', 24)
    .ip('R1', 'GigabitEthernet0/0', '10.1.0.1', 24)
    .ip('R1', 'GigabitEthernet0/1', '10.0.12.1', 30)
    .ip('R2', 'GigabitEthernet0/1', '10.0.12.2', 30)
    .ip('R2', 'GigabitEthernet0/0', '10.0.23.1', 30)
    .ip('R3', 'GigabitEthernet0/1', '10.0.23.2', 30)
    .ip('R1', 'Serial0/0/0', '10.0.13.1', 30)
    .ip('R3', 'Serial0/0/0', '10.0.13.2', 30)
    .ip('R3', 'GigabitEthernet0/0', '10.3.0.1', 24)
    .ip('PC3', 'FastEthernet0', '10.3.0.10', 24)
    .gw('PC1', '10.1.0.1')
    .gw('PC3', '10.3.0.1');
  ospf('R1', 'R2', 'R3')(d);
  if (costs.r1) d.opts('R1', 'GigabitEthernet0/1', { ospfCost: costs.r1 });
  if (costs.r3) d.opts('R3', 'GigabitEthernet0/1', { ospfCost: costs.r3 });
  if (!serialUp) d.admin('R1', 'Serial0/0/0', false).admin('R3', 'Serial0/0/0', false);
  return d.done();
}

export const ospfSlowPath: ProblemSpec = {
  slug: 'ospf-slow-path',
  version: 1,
  title: 'Why is the backup link busy?',
  topic: 'Routing',
  difficulty: 'hard',
  type: 'troubleshoot',
  statement:
    'R1 and R3 are joined two ways: a fast Gigabit path through R2, and a slow serial line kept as a backup. OSPF runs everywhere and every ping works, yet monitoring shows all traffic between the two LANs crawling over the serial line, in both directions.\n\nMake OSPF prefer the Gigabit path through R2 in both directions. The serial link must stay up as a backup.',
  requirements: [
    { id: 'r1', text: 'R1 sends traffic for 10.3.0.0/24 through R2', hints: ['OSPF adds up the cost of every outgoing interface on a path and takes the lowest total.', 'Look at R1\'s route to 10.3.0.0/24 and at the OSPF cost of each of its interfaces (show ip ospf interface).', 'R1 Gi0/1 has a manual cost of 500. On R1: interface gi0/1, no ip ospf cost.'] },
    { id: 'r3', text: 'R3 sends traffic for 10.1.0.0/24 through R2', hints: ['Cost is per direction: each router uses the cost of its OWN outgoing interfaces.', 'Fixing R1 does not change what R3 chooses. Check R3\'s interfaces too.', 'R3 Gi0/1 has a manual cost of 300. On R3: interface gi0/1, no ip ospf cost.'] },
    { id: 'backup', text: 'The serial link stays up and PCs still reach each other', hints: ['Shutting the serial line would hide the problem and remove the backup.', 'A healthy backup link stays in the table as a connected network.', 'Leave Serial0/0/0 alone on both routers.'] },
  ],
  tests: [
    { id: 'pc1-to-pc3', requirement: 'backup', points: 1, visibility: 'shown', check: { kind: 'reach', params: { from: 'PC1', to: '10.3.0.10' } } },
    { id: 'r1-via-r2', requirement: 'r1', points: 3, check: { kind: 'route', params: { device: 'R1', prefix: '10.3.0.0/24', source: 'ospf', via: '10.0.12.2' } } },
    { id: 'r3-via-r2', requirement: 'r3', points: 3, check: { kind: 'route', params: { device: 'R3', prefix: '10.1.0.0/24', source: 'ospf', via: '10.0.23.1' } } },
    { id: 'serial-up', requirement: 'backup', points: 2, check: { kind: 'route', params: { device: 'R1', prefix: '10.0.13.0/30', source: 'connected' } } },
  ],
  solution:
    'OSPF cost is 100 Mbit/s divided by the interface bandwidth, so Gigabit costs 1 and the serial line 64. Via R2 the path should cost about 3 and the serial path about 65. But R1 Gi0/1 carries "ip ospf cost 500" and R3 Gi0/1 "ip ospf cost 300", left over from an old maintenance, which make the fast path look far worse than the serial one. Remove both manual costs (or set them to 1). Each direction is decided by the sending router\'s own interface costs, which is why fixing only R1 leaves R3\'s traffic on the serial line.',
  layout: triangle().layout,
  start: () => triangle({ r1: 500, r3: 300 }).topology,
  reference: () => triangle().topology,
  wrong: [
    () => triangle({ r3: 300 }).topology, // one direction fixed
    () => triangle({ r1: 500 }).topology,
    () => triangle({ r1: 500, r3: 300 }, false).topology, // serial shut down: traffic moves, backup gone
  ],
};
