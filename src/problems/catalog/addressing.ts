// IP addressing problems on the two-LAN office (nets.ts twoLans).
import { privateLan24 } from '../random';
import type { Params, ProblemSpec } from '../spec';
import { stable, twoLans } from './nets';

const L = twoLans().done().layout;

/** twoLans with PC2 addressed the given way. */
const pc2 = (address: string, prefix: number, gateway?: string) => {
  const d = twoLans({ pc2: true }).ip('PC2', 'FastEthernet0', address, prefix);
  if (gateway) d.gw('PC2', gateway);
  return d.done().topology;
};

export const wrongSubnet: ProblemSpec = {
  slug: 'wrong-subnet',
  version: 1,
  title: 'One digit off',
  topic: 'IP Addressing',
  difficulty: 'easy',
  type: 'troubleshoot',
  statement:
    'PC2 was set up by hand this morning and has been offline ever since. PC1, on the same switch, works fine.\n\nThe staff LAN is 10.0.1.0/24 with gateway 10.0.1.1. Find the mistake on PC2 and fix it so PC2 reaches its gateway, PC1 and the server at 10.0.2.10.',
  requirements: [
    { id: 'lan', text: 'PC2 reaches its own LAN (R1 and PC1)', hints: ['Two hosts only talk directly when their addresses are in the same subnet.', 'Compare PC2\'s address with PC1\'s, octet by octet.', 'PC2 is 10.0.11.11; it should be 10.0.1.11 with mask 255.255.255.0.'] },
    { id: 'server', text: 'PC2 reaches Server1 at 10.0.2.10', hints: ['Other networks are reached through the default gateway.', 'The gateway must be an address inside PC2\'s own subnet.', 'Once PC2 is 10.0.1.11/24, gateway 10.0.1.1 works.'] },
  ],
  tests: [
    { id: 'pc2-to-r1', requirement: 'lan', points: 2, check: { kind: 'reach', params: { from: 'PC2', to: '10.0.1.1' } } },
    { id: 'pc2-to-pc1', requirement: 'lan', points: 1, check: { kind: 'reach', params: { from: 'PC2', to: '10.0.1.10' } } },
    { id: 'pc2-to-server', requirement: 'server', points: 2, check: { kind: 'reach', params: { from: 'PC2', to: '10.0.2.10' } } },
  ],
  solution:
    'PC2 was typed as 10.0.11.11/24, which is the network 10.0.11.0/24, not 10.0.1.0/24. With that address PC2 thinks its gateway 10.0.1.1 is on another network and has no way to reach it. Changing the address to 10.0.1.11 puts PC2 back in the LAN, and everything else was already right.',
  layout: L,
  start: () => pc2('10.0.11.11', 24, '10.0.1.1'),
  reference: () => pc2('10.0.1.11', 24, '10.0.1.1'),
  wrong: [
    () => pc2('10.0.11.11', 24, '10.0.11.1'), // "fixed" the gateway to match the typo
    () => pc2('10.0.1.11', 24), // right address, gateway removed along the way
  ],
};

export const wrongMask: ProblemSpec = {
  slug: 'wrong-mask',
  version: 1,
  title: 'The mask that hides the gateway',
  topic: 'IP Addressing',
  difficulty: 'easy',
  type: 'troubleshoot',
  statement:
    'PC2 has the address 10.0.1.200, which is a perfectly good address in the staff LAN 10.0.1.0/24. Its gateway is set to 10.0.1.1, also correct. It still cannot reach anything.\n\nFix PC2 without changing its IP address or its gateway.',
  requirements: [
    { id: 'mask', text: 'PC2 keeps 10.0.1.200 and uses the LAN\'s real mask', hints: ['The mask decides which addresses a host believes are its neighbours.', 'Work out the range 10.0.1.200 belongs to with PC2\'s current mask. Is 10.0.1.1 inside it?', 'PC2\'s mask is 255.255.255.128 (/25). The LAN is /24: use 255.255.255.0.'] },
    { id: 'reach', text: 'PC2 reaches R1, PC1 and Server1', hints: ['A host must be able to ARP for its gateway, so the gateway must look local.', 'With /25, PC2 thinks its LAN is 10.0.1.128 to 10.0.1.255.', 'Set 10.0.1.200/24 and test with a ping to 10.0.2.10.'] },
  ],
  tests: [
    { id: 'pc2-address', requirement: 'mask', points: 2, check: { kind: 'interfaceIp', params: { device: 'PC2', port: 'FastEthernet0', address: '10.0.1.200/24' } } },
    { id: 'pc2-to-r1', requirement: 'reach', points: 1, check: { kind: 'reach', params: { from: 'PC2', to: '10.0.1.1' } } },
    { id: 'pc2-to-pc1', requirement: 'reach', points: 1, check: { kind: 'reach', params: { from: 'PC2', to: '10.0.1.10' } } },
    { id: 'pc2-to-server', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC2', to: '10.0.2.10' } } },
  ],
  solution:
    'With mask 255.255.255.128 (/25), PC2 believes its network is 10.0.1.128/25, hosts .129 to .254. Its gateway 10.0.1.1 and PC1 (10.0.1.10) fall outside that range, so PC2 will not ARP for them. The real LAN is /24. Setting the mask to 255.255.255.0 makes .1 and .10 local again.',
  layout: L,
  start: () => pc2('10.0.1.200', 25, '10.0.1.1'),
  reference: () => pc2('10.0.1.200', 24, '10.0.1.1'),
  wrong: [() => pc2('10.0.1.100', 25, '10.0.1.1')], // moved into the lower /25: pings work, but the address changed and the mask is still wrong
};

// ------------------------------------------------------------ hard, randomized

const SIZES = { 26: 64, 27: 32, 28: 16 } as const;
const MASKS = { 26: '255.255.255.192', 27: '255.255.255.224', 28: '255.255.255.240' } as const;

/**
 * R1 splits one /24 into equal subnets. LAN A is subnet number {{a}}, LAN B
 * subnet number {{b}}; R1 holds the first usable address of each.
 */
function subnets(p: Params, hosts: { pc1?: number; pc2?: number; gateways?: boolean } = {}) {
  const len = Number(p.len);
  const d = stable()
    .dev('pc', 'PC1', 0, 220)
    .dev('switch', 'S1', 140, 100)
    .dev('router', 'R1', 360, 0)
    .dev('switch', 'S2', 580, 100)
    .dev('pc', 'PC2', 720, 220)
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
    .link('R1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1')
    .link('PC2', 'FastEthernet0', 'S2', 'FastEthernet0/1')
    .ip('R1', 'GigabitEthernet0/0', `${p.net}.${p.gwA}`, len)
    .ip('R1', 'GigabitEthernet0/1', `${p.net}.${p.gwB}`, len);
  if (hosts.pc1 !== undefined) d.ip('PC1', 'FastEthernet0', `${p.net}.${hosts.pc1}`, len);
  if (hosts.pc2 !== undefined) d.ip('PC2', 'FastEthernet0', `${p.net}.${hosts.pc2}`, len);
  if (hosts.gateways) d.gw('PC1', `${p.net}.${p.gwA}`).gw('PC2', `${p.net}.${p.gwB}`);
  return d.done();
}

const SAMPLE: Params = { net: '10.0.0', len: 26, gwA: 1, gwB: 65, lastA: 62, lastB: 126 };

export const lastUsableHost: ProblemSpec = {
  slug: 'last-usable-host',
  version: 1,
  title: 'Last usable host',
  topic: 'IP Addressing',
  difficulty: 'hard',
  type: 'configure',
  statement:
    'A /24 has been cut into equal subnets, and R1 already holds the first usable address of two of them: one per LAN. Read R1 to find out how the block was cut.\n\nGive PC1 and PC2 the LAST usable host address of their own subnet, with the right mask and gateway, so they can reach each other. Every attempt uses a different block and a different cut.',
  params: (r) => {
    const len = r.pick([26, 27, 28] as const);
    const size = SIZES[len];
    const [a, b] = r.distinct(2, 0, 256 / size - 1);
    return { net: privateLan24(r), len, mask: MASKS[len], gwA: a * size + 1, gwB: b * size + 1, lastA: a * size + size - 2, lastB: b * size + size - 2 };
  },
  requirements: [
    { id: 'pc1', text: 'PC1 has the last usable address of its subnet', hints: ['A subnet\'s last address is its broadcast; the last usable host is one below it.', 'R1\'s mask gives the block size: 256 minus the last mask octet. Subnets start at multiples of that size.', 'PC1: {{net}}.{{lastA}} mask {{mask}}, gateway {{net}}.{{gwA}}.'] },
    { id: 'pc2', text: 'PC2 has the last usable address of its subnet', hints: ['Each LAN is its own subnet with its own network and broadcast address.', 'Find the subnet that contains R1\'s address on PC2\'s side, then its broadcast.', 'PC2: {{net}}.{{lastB}} mask {{mask}}, gateway {{net}}.{{gwB}}.'] },
    { id: 'talk', text: 'PC1 and PC2 reach each other through R1', hints: ['Traffic between subnets goes through the router.', 'Each PC\'s gateway is R1\'s address in that PC\'s subnet.', 'Gateways: {{net}}.{{gwA}} for PC1, {{net}}.{{gwB}} for PC2.'] },
  ],
  tests: [
    { id: 'pc1-address', requirement: 'pc1', points: 2, check: { kind: 'interfaceIp', params: { device: 'PC1', port: 'FastEthernet0', address: '{{net}}.{{lastA}}/{{len}}' } } },
    { id: 'pc2-address', requirement: 'pc2', points: 2, check: { kind: 'interfaceIp', params: { device: 'PC2', port: 'FastEthernet0', address: '{{net}}.{{lastB}}/{{len}}' } } },
    { id: 'pc1-to-pc2', requirement: 'talk', points: 2, visibility: 'shown', check: { kind: 'reach', params: { from: 'PC1', to: '{{net}}.{{lastB}}' } } },
    { id: 'pc2-to-pc1', requirement: 'talk', points: 1, check: { kind: 'reach', params: { from: 'PC2', to: '{{net}}.{{lastA}}' } } },
  ],
  solution:
    'R1\'s mask is {{mask}} (/{{len}}), so each subnet holds 256 minus the last mask octet addresses and subnets start at multiples of that size. R1\'s {{net}}.{{gwA}} is the first host of PC1\'s subnet, whose broadcast is {{net}}.{{lastA}} plus one, so the last usable host is {{net}}.{{lastA}}. The same reasoning gives {{net}}.{{lastB}} for PC2. Each PC uses R1\'s address in its own subnet as gateway.',
  layout: subnets(SAMPLE).layout,
  start: (p) => subnets(p).topology,
  reference: (p) => subnets(p, { pc1: Number(p.lastA), pc2: Number(p.lastB), gateways: true }).topology,
  wrong: [
    (p) => subnets(p, { pc1: Number(p.lastA) - 1, pc2: Number(p.lastB) - 1, gateways: true }).topology, // works, but not the last usable host
    (p) => subnets(p, { pc1: Number(p.lastA), pc2: Number(p.lastB) }).topology, // right addresses, no gateways
  ],
};
