import { Draft } from '../../model/draft';
import type { ProblemSpec } from '../spec';

type Routes = { r1?: string; r2?: string };

/** PC1 ─ R1 ─ R2 ─ PC2. The routers only know their connected networks until routes are added. */
function net(routes: Routes = {}) {
  const d = new Draft({ stableIds: true })
    .dev('pc', 'PC1', 0, 160)
    .dev('router', 'R1', 220, 40)
    .dev('router', 'R2', 480, 40)
    .dev('pc', 'PC2', 700, 160)
    .link('PC1', 'FastEthernet0', 'R1', 'GigabitEthernet0/0', 'copper-cross')
    .link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1', 'copper-cross')
    .link('R2', 'GigabitEthernet0/0', 'PC2', 'FastEthernet0', 'copper-cross')
    .ip('PC1', 'FastEthernet0', '10.1.0.10', 24)
    .ip('R1', 'GigabitEthernet0/0', '10.1.0.1', 24)
    .ip('R1', 'GigabitEthernet0/1', '10.0.12.1', 30)
    .ip('R2', 'GigabitEthernet0/1', '10.0.12.2', 30)
    .ip('R2', 'GigabitEthernet0/0', '10.2.0.1', 24)
    .ip('PC2', 'FastEthernet0', '10.2.0.10', 24)
    .gw('PC1', '10.1.0.1')
    .gw('PC2', '10.2.0.1');
  if (routes.r1) d.route('R1', '10.2.0.0', 24, routes.r1);
  if (routes.r2) d.route('R2', '10.1.0.0', 24, routes.r2);
  return d.done();
}

export const staticRoutes: ProblemSpec = {
  slug: 'static-routes',
  version: 1,
  title: 'Route between two sites',
  topic: 'Routing',
  difficulty: 'medium',
  type: 'configure',
  statement:
    'Two sites are joined by a point-to-point link: R1 serves 10.1.0.0/24 and R2 serves 10.2.0.0/24, and the link between them is 10.0.12.0/30.\n\nEvery address is already set, but PC1 and PC2 cannot reach each other. Add static routes so they can, in both directions.',
  requirements: [
    { id: 'there', text: 'PC1 reaches PC2', hints: ['A router only knows the networks on its own ports, plus the routes you give it.', 'R1 needs to know where 10.2.0.0/24 is. Its neighbour on the link is R2.', 'On R1: ip route 10.2.0.0 255.255.255.0 10.0.12.2'] },
    { id: 'back', text: 'PC2 reaches PC1', hints: ['A ping is a round trip: the reply needs a route back.', 'R2 needs to know where 10.1.0.0/24 is.', 'On R2: ip route 10.1.0.0 255.255.255.0 10.0.12.1'] },
  ],
  tests: [
    { id: 'pc1-to-pc2', requirement: 'there', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '10.2.0.10' } } },
    { id: 'r1-route', requirement: 'there', points: 1, check: { kind: 'route', params: { device: 'R1', prefix: '10.2.0.0/24', source: 'static', via: '10.0.12.2' } } },
    { id: 'pc2-to-pc1', requirement: 'back', points: 3, check: { kind: 'reach', params: { from: 'PC2', to: '10.1.0.10' } } },
    { id: 'r2-route', requirement: 'back', points: 1, check: { kind: 'route', params: { device: 'R2', prefix: '10.1.0.0/24', source: 'static', via: '10.0.12.1' } } },
  ],
  solution:
    'Each router knows its two connected networks and nothing else. R1 needs "ip route 10.2.0.0 255.255.255.0 10.0.12.2" (send 10.2.0.0/24 to R2) and R2 needs "ip route 10.1.0.0 255.255.255.0 10.0.12.1". With only the first route, PC1\'s ping reaches PC2 but the reply is dropped at R2: a ping needs routes both ways.',
  layout: net().layout,
  start: () => net().topology,
  reference: () => net({ r1: '10.0.12.2', r2: '10.0.12.1' }).topology,
  wrong: [
    () => net({ r1: '10.0.12.2' }).topology, // one way only: the reply has no route back
    () => net({ r1: '10.0.12.1', r2: '10.0.12.2' }).topology, // next hops point at themselves
  ],
};
