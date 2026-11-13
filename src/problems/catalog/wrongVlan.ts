import { Draft } from '../../model/draft';
import type { ProblemSpec } from '../spec';

/** Sales (VLAN 10) on one switch. PC2's port was put in VLAN 20 by mistake. */
function net(pc2Vlan: number, pc1Vlan = 10) {
  const d = new Draft({ stableIds: true })
    .dev('switch', 'S1', 240, 0)
    .dev('pc', 'PC1', 80, 160)
    .dev('pc', 'PC2', 400, 160)
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('PC2', 'FastEthernet0', 'S1', 'FastEthernet0/2')
    .access('S1', 'FastEthernet0/1', pc1Vlan)
    .access('S1', 'FastEthernet0/2', pc2Vlan)
    .ip('PC1', 'FastEthernet0', '172.16.10.11', 24)
    .ip('PC2', 'FastEthernet0', '172.16.10.12', 24);
  return d.done();
}

export const wrongVlan: ProblemSpec = {
  slug: 'wrong-vlan',
  version: 1,
  title: 'Same subnet, no ping',
  topic: 'VLANs',
  difficulty: 'medium',
  type: 'troubleshoot',
  statement:
    'PC1 and PC2 both belong to Sales (VLAN 10, 172.16.10.0/24). Their addresses are right and both cables are fine, yet they cannot ping each other.\n\nFix the switch so the two Sales PCs can talk. Sales must stay in VLAN 10.',
  requirements: [
    { id: 'sales', text: 'PC1 and PC2 reach each other inside VLAN 10', hints: ['A VLAN is a separate broadcast domain: an ARP request never crosses into another VLAN.', 'Check which VLAN each of S1\'s ports is in (show vlan brief).', 'On S1: interface FastEthernet0/2, switchport access vlan 10.'] },
  ],
  tests: [
    { id: 'pc1-to-pc2', requirement: 'sales', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '172.16.10.12' } } },
    { id: 'pc1-port', requirement: 'sales', points: 1, check: { kind: 'accessVlan', params: { switch: 'S1', port: 'FastEthernet0/1', vlan: 10 } } },
    { id: 'pc2-port', requirement: 'sales', points: 1, check: { kind: 'accessVlan', params: { switch: 'S1', port: 'FastEthernet0/2', vlan: 10 } } },
  ],
  solution:
    'S1 FastEthernet0/2 (PC2) is an access port in VLAN 20 while PC1 is in VLAN 10. Being in the same IP subnet does not matter: PC1\'s ARP broadcast stays inside VLAN 10, so PC2 never hears it. Put Fa0/2 in VLAN 10. Moving PC1 into VLAN 20 would also make the ping work, but breaks the rule that Sales stays in VLAN 10.',
  layout: net(20).layout,
  start: () => net(20).topology,
  reference: () => net(10).topology,
  wrong: [() => net(20, 20).topology], // pings work, but Sales left VLAN 10
};
