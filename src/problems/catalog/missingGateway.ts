import { Draft } from '../../model/draft';
import type { ProblemSpec } from '../spec';

/** Two LANs on R1: staff (10.0.1.0/24) and servers (10.0.2.0/24). PC1's gateway is the bug. */
function net(gateway?: string) {
  const d = new Draft({ stableIds: true })
    .dev('pc', 'PC1', 0, 140)
    .dev('switch', 'S1', 160, 140)
    .dev('router', 'R1', 320, 0)
    .dev('switch', 'S2', 480, 140)
    .dev('server', 'Server1', 640, 140)
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
    .link('R1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1')
    .link('Server1', 'GigabitEthernet0', 'S2', 'FastEthernet0/1')
    .ip('R1', 'GigabitEthernet0/0', '10.0.1.1', 24)
    .ip('R1', 'GigabitEthernet0/1', '10.0.2.1', 24)
    .ip('PC1', 'FastEthernet0', '10.0.1.20', 24)
    .ip('Server1', 'GigabitEthernet0', '10.0.2.10', 24)
    .gw('Server1', '10.0.2.1');
  if (gateway) d.gw('PC1', gateway);
  return d.done();
}

export const missingGateway: ProblemSpec = {
  slug: 'missing-gateway',
  version: 1,
  title: 'The server is unreachable',
  topic: 'IP Addressing',
  difficulty: 'easy',
  type: 'troubleshoot',
  statement:
    'A user on PC1 reports that the file server (Server1, 10.0.2.10) "is down". Yet PC1 can ping its own router port, and the server team says the server is fine.\n\nFind out why PC1 cannot reach Server1 and fix it without changing the server or the router.',
  requirements: [
    { id: 'server', text: 'PC1 reaches Server1 at 10.0.2.10', hints: ['A host only sends traffic for other networks to its default gateway.', 'Compare PC1\'s settings with Server1\'s. One field is empty on PC1.', 'Set PC1\'s default gateway to 10.0.1.1 (R1\'s port on PC1\'s LAN).'] },
  ],
  tests: [
    { id: 'pc1-to-r1', requirement: 'server', points: 1, check: { kind: 'reach', params: { from: 'PC1', to: '10.0.1.1' } } },
    { id: 'pc1-to-server', requirement: 'server', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '10.0.2.10' } } },
  ],
  solution:
    'PC1 has a correct address but no default gateway. Pinging 10.0.1.1 works because R1\'s port is in PC1\'s own /24, so PC1 ARPs for it directly. 10.0.2.10 is in a different network, and without a gateway PC1 has nowhere to send it. Setting the gateway to 10.0.1.1 fixes it. A gateway of 10.0.2.1 would be wrong: a gateway must be in the host\'s own subnet.',
  layout: net().layout,
  start: () => net().topology,
  reference: () => net('10.0.1.1').topology,
  wrong: [() => net('10.0.1.254').topology],
};
