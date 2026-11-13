import { Draft } from '../../model/draft';
import { privateLan24 } from '../random';
import type { Params, ProblemSpec } from '../spec';

/** One LAN whose /24 and host numbers change with every attempt. */
function net(p: Params, pc1?: number, gateway?: string) {
  const d = new Draft({ stableIds: true })
    .dev('router', 'R1', 240, 0)
    .dev('switch', 'S1', 240, 140)
    .dev('pc', 'PC0', 80, 280)
    .dev('pc', 'PC1', 400, 280)
    .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
    .link('PC0', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/2')
    .ip('R1', 'GigabitEthernet0/0', `${p.lan}.1`, 24)
    .ip('PC0', 'FastEthernet0', `${p.lan}.${p.pc0}`, 24)
    .gw('PC0', `${p.lan}.1`);
  if (pc1 !== undefined) d.ip('PC1', 'FastEthernet0', `${p.lan}.${pc1}`, 24);
  if (gateway) d.gw('PC1', gateway);
  return d.done();
}

const SAMPLE: Params = { lan: '10.0.0', pc0: 10, pc1: 11 };

export const joinTheLan: ProblemSpec = {
  slug: 'join-the-lan',
  version: 1,
  title: 'Join an unknown LAN',
  topic: 'IP Addressing',
  difficulty: 'hard',
  type: 'configure',
  statement:
    'You are dropped into an office network you have never seen. Nobody tells you its subnet: find it by looking at the devices that already work.\n\nGive PC1 host number .{{pc1}} in that LAN and make it reach the router and PC0. Every attempt uses a different network.',
  params: (r) => {
    const [pc0, pc1] = r.distinct(2, 10, 200);
    return { lan: privateLan24(r), pc0, pc1 };
  },
  requirements: [
    { id: 'join', text: 'PC1 is host .{{pc1}} in the LAN and reaches R1 and PC0', hints: ['The LAN\'s subnet is written on the devices already in it.', 'Open R1 or PC0 and read their address and mask: that is the LAN.', 'Set PC1 to {{lan}}.{{pc1}} / 255.255.255.0 with gateway {{lan}}.1.'] },
  ],
  tests: [
    { id: 'pc1-to-r1', requirement: 'join', points: 2, visibility: 'shown', check: { kind: 'reach', params: { from: 'PC1', to: '{{lan}}.1' } } },
    { id: 'pc1-to-pc0', requirement: 'join', points: 1, check: { kind: 'reach', params: { from: 'PC1', to: '{{lan}}.{{pc0}}' } } },
    { id: 'pc1-address', requirement: 'join', points: 1, check: { kind: 'interfaceIp', params: { device: 'PC1', port: 'FastEthernet0', address: '{{lan}}.{{pc1}}/24' } } },
  ],
  solution:
    'R1 is {{lan}}.1/24 and PC0 is {{lan}}.{{pc0}}/24, so the LAN is {{lan}}.0/24. PC1 gets {{lan}}.{{pc1}} with mask 255.255.255.0 and gateway {{lan}}.1. The skill being tested is reading a network you did not build, which is most of real troubleshooting.',
  layout: net(SAMPLE).layout,
  start: (p) => net(p).topology,
  reference: (p) => net(p, Number(p.pc1), `${p.lan}.1`).topology,
  wrong: [
    (p) => net(p, Number(p.pc0), `${p.lan}.1`).topology, // copies PC0's address
    (p) => net(p, Number(p.pc1) === 200 ? 199 : Number(p.pc1) + 1, `${p.lan}.1`).topology, // works, but not the host number asked for
  ],
};
