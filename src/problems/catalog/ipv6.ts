// IPv6 problems.
import type { Draft } from '../../model/draft';
import type { ProblemSpec } from '../spec';
import { stable } from './nets';

/** Two IPv6-only LANs on R1. PC1 is the host to configure. */
function v6Lans(pc1?: { address: string; gateway?: string }) {
  const d = stable()
    .dev('pc', 'PC1', 0, 220)
    .dev('switch', 'S1', 140, 100)
    .dev('router', 'R1', 360, 0)
    .dev('switch', 'S2', 580, 100)
    .dev('server', 'Server1', 720, 220)
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
    .link('R1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1')
    .link('S2', 'FastEthernet0/1', 'Server1', 'GigabitEthernet0')
    .v6('R1', 'GigabitEthernet0/0', '2001:db8:1::1')
    .v6('R1', 'GigabitEthernet0/1', '2001:db8:2::1')
    .v6('Server1', 'GigabitEthernet0', '2001:db8:2::10')
    .gw6('Server1', '2001:db8:2::1');
  if (pc1) d.v6('PC1', 'FastEthernet0', pc1.address);
  if (pc1?.gateway) d.gw6('PC1', pc1.gateway);
  return d.done();
}

export const ipv6FirstAddress: ProblemSpec = {
  slug: 'ipv6-first-address',
  version: 1,
  title: 'Your first IPv6 address',
  topic: 'IPv6',
  difficulty: 'easy',
  type: 'configure',
  statement:
    'This network has no IPv4 at all. R1 is 2001:db8:1::1/64 on PC1\'s LAN and 2001:db8:2::1/64 on the server LAN, where Server1 is 2001:db8:2::10.\n\nGive PC1 the address 2001:db8:1::10/64 and whatever else it needs to reach Server1.',
  requirements: [
    { id: 'lan', text: 'PC1 reaches R1 on its own LAN', hints: ['IPv6 works like IPv4 here: an address, a prefix length, a gateway.', 'Open PC1 > Config and find the IPv6 address field of FastEthernet0.', 'Set 2001:db8:1::10/64.'] },
    { id: 'server', text: 'PC1 reaches Server1 in the other LAN', hints: ['Another prefix means another network: PC1 needs a gateway.', 'The gateway is R1\'s address on PC1\'s LAN.', 'Set PC1\'s IPv6 gateway to 2001:db8:1::1.'] },
  ],
  tests: [
    { id: 'pc1-to-r1', requirement: 'lan', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '2001:db8:1::1' } } },
    { id: 'pc1-to-server', requirement: 'server', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '2001:db8:2::10' } } },
  ],
  solution:
    'PC1 gets 2001:db8:1::10 with prefix length 64 and the IPv6 gateway 2001:db8:1::1. The /64 says the first four groups (2001:db8:1:0) are the network; "::" stands for the run of zero groups in between. There is no ARP in IPv6: PC1 finds R1\'s MAC with a Neighbor Solicitation sent to a multicast address, which you can watch in Simulation mode.',
  layout: v6Lans().layout,
  start: () => v6Lans().topology,
  reference: () => v6Lans({ address: '2001:db8:1::10', gateway: '2001:db8:1::1' }).topology,
  wrong: [
    () => v6Lans({ address: '2001:db8:1::10' }).topology, // no gateway
    () => v6Lans({ address: '2001:db8:3::10', gateway: '2001:db8:1::1' }).topology, // wrong prefix
  ],
};

/** PC1 ─ R1 ─ R2 ─ PC2, IPv6 only. Routes are the problem. */
function v6Sites(add: (d: Draft) => Draft = (d) => d) {
  return add(
    stable()
      .dev('pc', 'PC1', 0, 160)
      .dev('router', 'R1', 220, 40)
      .dev('router', 'R2', 480, 40)
      .dev('pc', 'PC2', 700, 160)
      .link('PC1', 'FastEthernet0', 'R1', 'GigabitEthernet0/0', 'copper-cross')
      .link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1', 'copper-cross')
      .link('R2', 'GigabitEthernet0/0', 'PC2', 'FastEthernet0', 'copper-cross')
      .v6('PC1', 'FastEthernet0', '2001:db8:a::10')
      .v6('R1', 'GigabitEthernet0/0', '2001:db8:a::1')
      .v6('R1', 'GigabitEthernet0/1', '2001:db8:12::1')
      .v6('R2', 'GigabitEthernet0/1', '2001:db8:12::2')
      .v6('R2', 'GigabitEthernet0/0', '2001:db8:b::1')
      .v6('PC2', 'FastEthernet0', '2001:db8:b::10')
      .gw6('PC1', '2001:db8:a::1')
      .gw6('PC2', '2001:db8:b::1'),
  ).done();
}

export const ipv6StaticRoutes: ProblemSpec = {
  slug: 'ipv6-static-routes',
  version: 1,
  title: 'Static routes, IPv6 edition',
  topic: 'IPv6',
  difficulty: 'medium',
  type: 'configure',
  statement:
    'Two IPv6-only sites: R1 serves 2001:db8:a::/64 and R2 serves 2001:db8:b::/64. The link between the routers is 2001:db8:12::/64 (R1 is ::1, R2 is ::2).\n\nEvery address is set, but PC1 and PC2 cannot reach each other. Add the IPv6 static routes that are missing.',
  requirements: [
    { id: 'there', text: 'PC1 reaches PC2', hints: ['Routing works the same in IPv6: a router only knows its connected prefixes.', 'R1 needs a route to 2001:db8:b::/64 through its neighbour R2.', 'On R1: ipv6 route 2001:db8:b::/64 2001:db8:12::2'] },
    { id: 'back', text: 'PC2 reaches PC1', hints: ['The reply needs its own route back.', 'R2 needs a route to 2001:db8:a::/64 through R1.', 'On R2: ipv6 route 2001:db8:a::/64 2001:db8:12::1'] },
  ],
  tests: [
    { id: 'pc1-to-pc2', requirement: 'there', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '2001:db8:b::10' } } },
    { id: 'pc1-to-far-router', requirement: 'there', points: 1, check: { kind: 'reach', params: { from: 'PC1', to: '2001:db8:b::1' } } },
    { id: 'pc2-to-pc1', requirement: 'back', points: 3, check: { kind: 'reach', params: { from: 'PC2', to: '2001:db8:a::10' } } },
  ],
  solution:
    '"ipv6 route 2001:db8:b::/64 2001:db8:12::2" on R1 and "ipv6 route 2001:db8:a::/64 2001:db8:12::1" on R2. The only differences from IPv4 are the command name and the prefix-length notation instead of a mask. As with IPv4, one route makes the request arrive and the reply die on the far router.',
  layout: v6Sites().layout,
  start: () => v6Sites().topology,
  reference: () => v6Sites((d) => d.route6('R1', '2001:db8:b::', 64, '2001:db8:12::2').route6('R2', '2001:db8:a::', 64, '2001:db8:12::1')).topology,
  wrong: [
    () => v6Sites((d) => d.route6('R1', '2001:db8:b::', 64, '2001:db8:12::2')).topology, // one way only
    () => v6Sites((d) => d.route6('R2', '2001:db8:a::', 64, '2001:db8:12::1')).topology,
  ],
};
