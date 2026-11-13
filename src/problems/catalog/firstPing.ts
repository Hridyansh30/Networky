import { Draft } from '../../model/draft';
import type { ProblemSpec } from '../spec';

/** PC0 and PC1 on one switch behind R1. PC1 is plugged in but has no address. */
function net(opts: { pc1?: string; gateway?: boolean} = {}) {
  const d = new Draft({ stableIds: true })
    .dev('router', 'R1', 240, 0)
    .dev('switch', 'S1', 240, 140)
    .dev('pc', 'PC0', 80, 280)
    .dev('pc', 'PC1', 400, 280)
    .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
    .link('PC0', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/2')
    .ip('R1', 'GigabitEthernet0/0', '192.168.1.1', 24)
    .ip('PC0', 'FastEthernet0', '192.168.1.10', 24)
    .gw('PC0', '192.168.1.1');
  if (opts.pc1) d.ip('PC1', 'FastEthernet0', opts.pc1, 24);
  if (opts.gateway) d.gw('PC1', '192.168.1.1');
  return d.done();
}

export const firstPing: ProblemSpec = {
  slug: 'first-ping',
  version: 1,
  title: 'Your first ping',
  topic: 'IP Addressing',
  difficulty: 'easy',
  type: 'configure',
  statement:
    'PC1 was just plugged into the office switch, but it has no IP address, so it cannot talk to anyone.\n\nThe office LAN is 192.168.1.0/24 and its router, R1, is 192.168.1.1. Give PC1 the address 192.168.1.11/24 so it can reach PC0 and R1.',
  requirements: [
    { id: 'address', text: 'PC1 has 192.168.1.11/24', hints: ['Every host needs an address inside its LAN before it can send anything.', 'Click PC1 and open its Config tab.', 'Set IPv4 address 192.168.1.11 and subnet mask 255.255.255.0.'] },
    { id: 'reach', text: 'PC1 reaches PC0 and its gateway R1', hints: ['Hosts on the same LAN talk directly; the gateway is only for other networks.', 'Ping 192.168.1.10 and 192.168.1.1 from PC1 to check.', 'Check the mask: 255.255.255.0 puts PC1 in the same /24 as PC0 and R1.'] },
  ],
  tests: [
    { id: 'pc1-address', requirement: 'address', points: 2, check: { kind: 'interfaceIp', params: { device: 'PC1', port: 'FastEthernet0', address: '192.168.1.11/24' } } },
    { id: 'pc1-to-pc0', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '192.168.1.10' } } },
    { id: 'pc1-to-r1', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '192.168.1.1' } } },
  ],
  solution:
    'PC1 needs an address in the LAN it is plugged into: 192.168.1.11 with mask 255.255.255.0 (/24). That alone lets it reach PC0 and R1, because both are in the same /24 and ARP finds them directly. The default gateway (192.168.1.1) is what PC1 would use for any address outside 192.168.1.0/24.',
  layout: net().layout,
  start: () => net().topology,
  reference: () => net({ pc1: '192.168.1.11', gateway: true }).topology,
  wrong: [
    () => net({ pc1: '192.168.2.11', gateway: true }).topology, // wrong subnet
    () => net({ pc1: '192.168.1.10', gateway: true }).topology, // duplicates PC0
  ],
};
