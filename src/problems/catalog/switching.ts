// Switching problems: cabling and spanning tree.
import type { ProblemSpec } from '../spec';
import { stable } from './nets';

/** A small LAN where PC2's cable is the thing to fix. `to` = the switch port PC2 is plugged into. */
function lan(to?: [string, string]) {
  const d = stable()
    .dev('router', 'R1', 260, 0)
    .dev('switch', 'S1', 260, 140)
    .dev('pc', 'PC1', 80, 290)
    .dev('pc', 'PC2', 440, 290)
    .dev('switch', 'S2', 620, 140)
    .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .ip('R1', 'GigabitEthernet0/0', '192.168.10.1', 24)
    .ip('PC1', 'FastEthernet0', '192.168.10.11', 24)
    .ip('PC2', 'FastEthernet0', '192.168.10.12', 24)
    .gw('PC1', '192.168.10.1')
    .gw('PC2', '192.168.10.1');
  if (to) d.link('PC2', 'FastEthernet0', to[0], to[1]);
  return d.done();
}

export const unplugged: ProblemSpec = {
  slug: 'unplugged',
  version: 1,
  title: 'Is it plugged in?',
  topic: 'Switching',
  difficulty: 'easy',
  type: 'configure',
  statement:
    'PC2 is new. Its address (192.168.10.12/24) and gateway are already set, but nobody has cabled it yet.\n\nConnect PC2 to the office LAN so it can reach PC1 and the router R1. S2 is a spare switch that is not connected to anything.',
  requirements: [
    { id: 'link', text: 'PC2 reaches PC1 and R1', hints: ['No cable, no layer 1: nothing above it can work.', 'Drag from PC2\'s port dot to a free port on the switch the rest of the LAN uses.', 'Connect PC2 FastEthernet0 to S1 FastEthernet0/2 with a straight-through copper cable.'] },
  ],
  tests: [
    { id: 'pc2-to-pc1', requirement: 'link', points: 2, check: { kind: 'reach', params: { from: 'PC2', to: '192.168.10.11' } } },
    { id: 'pc2-to-r1', requirement: 'link', points: 2, check: { kind: 'reach', params: { from: 'PC2', to: '192.168.10.1' } } },
  ],
  solution:
    'PC2 only needs a cable to the switch that PC1 and R1 are on: PC2 FastEthernet0 to any free port on S1. A PC to a switch is a straight-through cable. Plugging it into S2 gives a green link light but no connectivity, because S2 is not connected to the rest of the LAN: a link being "up" only tells you about that one cable.',
  layout: lan().layout,
  start: () => lan().topology,
  reference: () => lan(['S1', 'FastEthernet0/2']).topology,
  wrong: [() => lan(['S2', 'FastEthernet0/1']).topology], // link light on, wrong switch
};

/** Three switches in a triangle with the servers on S1. `priorities` by switch name. */
function triangle(priorities: Record<string, number> = {}) {
  const d = stable()
    .dev('switch', 'S1', 320, 0)
    .dev('switch', 'S2', 100, 200)
    .dev('switch', 'S3', 540, 200)
    .dev('server', 'Server1', 560, 0)
    .dev('pc', 'PC1', 0, 360)
    .dev('pc', 'PC2', 640, 360)
    .link('S1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1', 'copper-cross')
    .link('S1', 'FastEthernet0/1', 'S3', 'FastEthernet0/1', 'copper-cross')
    .link('S2', 'FastEthernet0/2', 'S3', 'FastEthernet0/2', 'copper-cross')
    .link('Server1', 'GigabitEthernet0', 'S1', 'FastEthernet0/8')
    .link('PC1', 'FastEthernet0', 'S2', 'FastEthernet0/5')
    .link('PC2', 'FastEthernet0', 'S3', 'FastEthernet0/5')
    .ip('Server1', 'GigabitEthernet0', '10.0.0.100', 24)
    .ip('PC1', 'FastEthernet0', '10.0.0.1', 24)
    .ip('PC2', 'FastEthernet0', '10.0.0.2', 24);
  for (const [name, p] of Object.entries(priorities)) d.stpPriority(name, p);
  return d.done();
}

export const stpRoot: ProblemSpec = {
  slug: 'stp-root',
  version: 1,
  title: 'Choose the root bridge',
  topic: 'Switching',
  difficulty: 'medium',
  type: 'configure',
  statement:
    'Three switches form a triangle for redundancy. Spanning tree picked its root bridge by accident (the lowest MAC address wins a tie), and S3, an access switch, has been given a low priority by a previous admin.\n\nThe server sits on S1, the core switch. Make S1 the spanning-tree root so traffic to the server takes the direct links, and keep the network loop-free.',
  requirements: [
    { id: 'root', text: 'S1 is the spanning-tree root bridge', hints: ['The root is the switch with the lowest bridge ID: priority first, then MAC address.', 'Look at each switch\'s STP priority (show spanning-tree). Lower wins.', 'On S1: spanning-tree vlan 1 priority 4096. Make sure no other switch is lower.'] },
    { id: 'works', text: 'PC1 and PC2 still reach the server', hints: ['Do not disable spanning tree or remove a cable: the loop protection must stay.', 'Blocked (amber) ports are normal: that is STP removing the loop.', 'Only change bridge priorities.'] },
  ],
  tests: [
    { id: 's1-root', requirement: 'root', points: 3, check: { kind: 'stpRoot', params: { switch: 'S1' } } },
    { id: 'pc1-to-server', requirement: 'works', points: 1, check: { kind: 'reach', params: { from: 'PC1', to: '10.0.0.100' } } },
    { id: 'pc2-to-server', requirement: 'works', points: 1, check: { kind: 'reach', params: { from: 'PC2', to: '10.0.0.100' } } },
  ],
  solution:
    'The root bridge is the switch with the lowest bridge ID, which is the priority followed by the MAC. S3 was left at priority 8192, lower than the default 32768 on S1 and S2, so S3 wins. Give S1 a priority below 8192 (4096), or raise S3 back to the default and lower S1. Then the ports toward S1 become root ports and the S2 to S3 link blocks.',
  layout: triangle().layout,
  start: () => triangle({ S3: 8192 }).topology,
  reference: () => triangle({ S3: 8192, S1: 4096 }).topology,
  wrong: [
    () => triangle({ S3: 8192, S1: 12288 }).topology, // lowered S1, but S3 is still lower
    () => triangle({ S3: 8192, S2: 4096 }).topology, // lowered the wrong switch
  ],
};
