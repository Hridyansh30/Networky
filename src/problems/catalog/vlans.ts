// VLAN problems: access ports, trunks and routing between VLANs.
import type { Params, ProblemSpec } from '../spec';
import { stable } from './nets';

// ---------------------------------------------------------------- easy

/** Engineering PCs and a guest laptop on one switch. `vlans` = access VLAN of Fa0/1, Fa0/2, Fa0/3. */
function oneSwitch(vlans: [number, number, number]) {
  return stable()
    .dev('switch', 'S1', 260, 0)
    .dev('pc', 'PC1', 40, 170)
    .dev('pc', 'PC2', 260, 190)
    .dev('laptop', 'Guest', 480, 170)
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('PC2', 'FastEthernet0', 'S1', 'FastEthernet0/2')
    .link('Guest', 'FastEthernet0', 'S1', 'FastEthernet0/3')
    .access('S1', 'FastEthernet0/1', vlans[0])
    .access('S1', 'FastEthernet0/2', vlans[1])
    .access('S1', 'FastEthernet0/3', vlans[2])
    .ip('PC1', 'FastEthernet0', '172.16.0.11', 24)
    .ip('PC2', 'FastEthernet0', '172.16.0.12', 24)
    .ip('Guest', 'FastEthernet0', '172.16.0.50', 24)
    .done();
}

export const firstVlan: ProblemSpec = {
  slug: 'first-vlan',
  version: 1,
  title: 'Fence off the guest',
  topic: 'VLANs',
  difficulty: 'easy',
  type: 'configure',
  statement:
    'Two engineering PCs and a guest laptop share one switch, all in the default VLAN 1, so the guest can reach the engineers.\n\nMove the two engineering ports (S1 Fa0/1 and Fa0/2) into VLAN 20. Leave the guest in VLAN 1. Afterwards PC1 and PC2 must still reach each other, and the guest must not reach them.',
  requirements: [
    { id: 'eng', text: 'PC1 and PC2 are in VLAN 20 and reach each other', hints: ['A VLAN is a separate LAN inside the same switch.', 'Select S1 and look at the switchport settings of Fa0/1 and Fa0/2.', 'On S1: interface fa0/1, switchport access vlan 20. Then the same on interface fa0/2.'] },
    { id: 'guest', text: 'The guest cannot reach the engineers', hints: ['Frames never cross from one VLAN to another inside a switch.', 'If the guest still gets through, one engineering port is still in VLAN 1.', 'Fa0/3 stays in VLAN 1; Fa0/1 and Fa0/2 both go to VLAN 20.'] },
  ],
  tests: [
    { id: 'fa1-vlan', requirement: 'eng', points: 1, check: { kind: 'accessVlan', params: { switch: 'S1', port: 'FastEthernet0/1', vlan: 20 } } },
    { id: 'fa2-vlan', requirement: 'eng', points: 1, check: { kind: 'accessVlan', params: { switch: 'S1', port: 'FastEthernet0/2', vlan: 20 } } },
    { id: 'pc1-to-pc2', requirement: 'eng', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '172.16.0.12' } } },
    { id: 'guest-blocked', requirement: 'guest', points: 2, check: { kind: 'reach', params: { from: 'Guest', to: '172.16.0.11', expect: 'unreachable' } } },
    { id: 'guest-vlan', requirement: 'guest', points: 1, check: { kind: 'accessVlan', params: { switch: 'S1', port: 'FastEthernet0/3', vlan: 1 } } },
  ],
  solution:
    'Put Fa0/1 and Fa0/2 in VLAN 20 (switchport access vlan 20) and leave Fa0/3 in VLAN 1. All three hosts keep addresses in the same IP subnet, yet the guest\'s ARP broadcast for 172.16.0.11 is only flooded inside VLAN 1, so it never gets an answer. That is the point of a VLAN: separation at layer 2, whatever the IP addresses say.',
  layout: oneSwitch([1, 1, 1]).layout,
  start: () => oneSwitch([1, 1, 1]).topology,
  reference: () => oneSwitch([20, 20, 1]).topology,
  wrong: [
    () => oneSwitch([20, 1, 1]).topology, // only one engineer moved
    () => oneSwitch([20, 20, 20]).topology, // everyone moved: the guest is back with them
  ],
};

// ---------------------------------------------------------------- medium: trunk

/** Two switches, Sales (VLAN 10) and HR (VLAN 20) on each. `uplink`: how the link between them is set. */
function twoSwitches(uplink: 'access1' | 'access10' | 'trunk' | 'halfTrunk') {
  const d = stable()
    .dev('switch', 'S1', 140, 0)
    .dev('switch', 'S2', 520, 0)
    .dev('pc', 'Sales1', 0, 180)
    .dev('pc', 'HR1', 240, 180)
    .dev('pc', 'Sales2', 420, 180)
    .dev('pc', 'HR2', 660, 180)
    .link('S1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1', 'copper-cross')
    .link('Sales1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('HR1', 'FastEthernet0', 'S1', 'FastEthernet0/2')
    .link('Sales2', 'FastEthernet0', 'S2', 'FastEthernet0/1')
    .link('HR2', 'FastEthernet0', 'S2', 'FastEthernet0/2')
    .access('S1', 'FastEthernet0/1', 10)
    .access('S1', 'FastEthernet0/2', 20)
    .access('S2', 'FastEthernet0/1', 10)
    .access('S2', 'FastEthernet0/2', 20)
    .ip('Sales1', 'FastEthernet0', '10.10.0.1', 24)
    .ip('Sales2', 'FastEthernet0', '10.10.0.2', 24)
    .ip('HR1', 'FastEthernet0', '10.20.0.1', 24)
    .ip('HR2', 'FastEthernet0', '10.20.0.2', 24);
  if (uplink === 'trunk') d.trunk('S1', 'GigabitEthernet0/1').trunk('S2', 'GigabitEthernet0/1');
  if (uplink === 'halfTrunk') d.trunk('S1', 'GigabitEthernet0/1');
  if (uplink === 'access10') d.access('S1', 'GigabitEthernet0/1', 10).access('S2', 'GigabitEthernet0/1', 10);
  return d.done();
}

export const trunkLink: ProblemSpec = {
  slug: 'trunk-between-switches',
  version: 1,
  title: 'Two VLANs, one cable',
  topic: 'VLANs',
  difficulty: 'medium',
  type: 'troubleshoot',
  statement:
    'Sales (VLAN 10) and HR (VLAN 20) each have a PC on S1 and a PC on S2. The access ports are correct on both switches, but neither department can reach its colleague on the other switch.\n\nFix the link between S1 and S2 so that both VLANs cross it. Do not add a second cable.',
  requirements: [
    { id: 'sales', text: 'Sales1 reaches Sales2', hints: ['An access port carries exactly one VLAN.', 'Check the mode of Gi0/1 on both switches: which VLAN does the uplink carry today?', 'On both switches: interface gi0/1, switchport mode trunk.'] },
    { id: 'hr', text: 'HR1 reaches HR2', hints: ['To carry several VLANs over one cable, frames must be tagged (802.1Q).', 'Making the uplink an access port in VLAN 10 fixes Sales only.', 'Both ends of the link must be trunks.'] },
  ],
  tests: [
    { id: 'sales-across', requirement: 'sales', points: 3, check: { kind: 'reach', params: { from: 'Sales1', to: '10.10.0.2' } } },
    { id: 'hr-across', requirement: 'hr', points: 3, check: { kind: 'reach', params: { from: 'HR1', to: '10.20.0.2' } } },
    { id: 'sales-port', requirement: 'sales', points: 1, check: { kind: 'accessVlan', params: { switch: 'S2', port: 'FastEthernet0/1', vlan: 10 } } },
    { id: 'hr-port', requirement: 'hr', points: 1, check: { kind: 'accessVlan', params: { switch: 'S2', port: 'FastEthernet0/2', vlan: 20 } } },
  ],
  solution:
    'The uplink Gi0/1 is an access port in VLAN 1 on both switches, so it carries neither VLAN 10 nor VLAN 20. Set it to trunk mode on both ends: a trunk tags each frame with its VLAN number, so one cable carries both departments and keeps them apart. An access port in VLAN 10 would rescue Sales and leave HR cut off.',
  layout: twoSwitches('trunk').layout,
  start: () => twoSwitches('access1').topology,
  reference: () => twoSwitches('trunk').topology,
  wrong: [
    () => twoSwitches('access10').topology, // only Sales crosses
    () => twoSwitches('halfTrunk').topology, // a trunk on one end only
  ],
};

// ---------------------------------------------------------------- medium: router on a stick

interface Stick {
  trunk?: boolean;
  subs?: boolean;
}

function stick(vA: number, vB: number, netA: string, netB: string, o: Stick = {}) {
  const d = stable()
    .dev('router', 'R1', 300, 0)
    .dev('switch', 'S1', 300, 150)
    .dev('pc', 'PC1', 60, 310)
    .dev('pc', 'PC2', 300, 330)
    .dev('laptop', 'PC3', 540, 310)
    .link('R1', 'GigabitEthernet0/0', 'S1', 'GigabitEthernet0/1')
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('PC2', 'FastEthernet0', 'S1', 'FastEthernet0/2')
    .link('PC3', 'FastEthernet0', 'S1', 'FastEthernet0/3')
    .access('S1', 'FastEthernet0/1', vA)
    .access('S1', 'FastEthernet0/2', vA)
    .access('S1', 'FastEthernet0/3', vB)
    .ip('PC1', 'FastEthernet0', `${netA}.10`, 24)
    .ip('PC2', 'FastEthernet0', `${netA}.11`, 24)
    .ip('PC3', 'FastEthernet0', `${netB}.10`, 24)
    .gw('PC1', `${netA}.1`)
    .gw('PC2', `${netA}.1`)
    .gw('PC3', `${netB}.1`);
  if (o.trunk) d.trunk('S1', 'GigabitEthernet0/1');
  if (o.subs) d.sub('R1', 'GigabitEthernet0/0', vA, `${netA}.1`, 24).sub('R1', 'GigabitEthernet0/0', vB, `${netB}.1`, 24);
  return d.done();
}

export const routerOnAStick: ProblemSpec = {
  slug: 'router-on-a-stick',
  version: 1,
  title: 'Router on a stick',
  topic: 'VLANs',
  difficulty: 'medium',
  type: 'configure',
  statement:
    'PC1 and PC2 are in VLAN 10 (192.168.10.0/24) and PC3 is in VLAN 20 (192.168.20.0/24). The hosts already use 192.168.10.1 and 192.168.20.1 as gateways, but those addresses do not exist yet, so the VLANs cannot talk.\n\nR1 has a single cable to S1. Make R1 route between the two VLANs over that one cable.',
  requirements: [
    { id: 'trunk', text: 'The cable between S1 and R1 carries both VLANs', hints: ['One cable, two VLANs: the frames need tags.', 'The switch side of the cable to R1 must be a trunk.', 'On S1: interface gi0/1, switchport mode trunk.'] },
    { id: 'route', text: 'R1 is the gateway of each VLAN and PC1 reaches PC3', hints: ['A router needs one interface per subnet. They do not have to be physical.', 'Create a subinterface per VLAN on Gi0/0, each with that VLAN\'s gateway address.', 'On R1: interface gi0/0.10, encapsulation dot1Q 10, ip address 192.168.10.1 255.255.255.0. Same for .20 with 192.168.20.1.'] },
  ],
  tests: [
    { id: 'pc1-to-gw', requirement: 'trunk', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '192.168.10.1' } } },
    { id: 'pc3-to-gw', requirement: 'trunk', points: 2, check: { kind: 'reach', params: { from: 'PC3', to: '192.168.20.1' } } },
    { id: 'pc1-to-pc3', requirement: 'route', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '192.168.20.10' } } },
    { id: 'pc3-to-pc2', requirement: 'route', points: 2, check: { kind: 'reach', params: { from: 'PC3', to: '192.168.10.11' } } },
    { id: 'pc3-port', requirement: 'route', points: 1, check: { kind: 'accessVlan', params: { switch: 'S1', port: 'FastEthernet0/3', vlan: 20 } } },
  ],
  solution:
    'Two things are missing. On S1, Gi0/1 must be a trunk so frames from both VLANs reach R1 with their 802.1Q tag. On R1, create Gi0/0.10 (dot1Q 10, 192.168.10.1/24) and Gi0/0.20 (dot1Q 20, 192.168.20.1/24). A ping from PC1 to PC3 then goes up the trunk tagged 10, is routed inside R1, and comes back down tagged 20. Putting all three PCs in one VLAN would make pings work but is not routing between VLANs.',
  layout: stick(10, 20, '192.168.10', '192.168.20').layout,
  start: () => stick(10, 20, '192.168.10', '192.168.20').topology,
  reference: () => stick(10, 20, '192.168.10', '192.168.20', { trunk: true, subs: true }).topology,
  wrong: [
    () => stick(10, 20, '192.168.10', '192.168.20', { subs: true }).topology, // subinterfaces, but the switch port is still an access port
    () => stick(10, 20, '192.168.10', '192.168.20', { trunk: true }).topology, // trunk, but no gateways on R1
  ],
};

// ---------------------------------------------------------------- hard, randomized

const net = (p: Params, k: 'A' | 'B') => `10.${p[`oct${k}`]}.${p[`v${k}`]}`;
const office = (p: Params, o: Stick = {}) => stick(Number(p.vA), Number(p.vB), net(p, 'A'), net(p, 'B'), o);
const SAMPLE: Params = { vA: 10, vB: 20, octA: 1, octB: 2 };

export const vlanOffice: ProblemSpec = {
  slug: 'inter-vlan-from-scratch',
  version: 1,
  title: 'Inter-VLAN routing, unknown numbers',
  topic: 'VLANs',
  difficulty: 'hard',
  type: 'configure',
  statement:
    'An office switch has two VLANs whose numbers and subnets you have to discover: read the switch ports and the PCs. Each PC already points at a gateway ending in .1 that does not exist yet.\n\nMake R1 route between the two VLANs over its single cable to S1, so every PC reaches every other PC. Every attempt uses different VLAN numbers and subnets.',
  params: (r) => {
    const [vA, vB] = r.distinct(2, 2, 250);
    const [octA, octB] = r.distinct(2, 0, 250);
    return { vA, vB, octA, octB };
  },
  requirements: [
    { id: 'gateways', text: 'Each VLAN\'s PCs reach their gateway on R1', hints: ['Find the VLAN of each access port on S1, and each PC\'s gateway address.', 'R1 needs one subinterface per VLAN, tagged with that VLAN\'s number, and the uplink must be a trunk.', 'S1 gi0/1: switchport mode trunk. R1: gi0/0.{{vA}} dot1Q {{vA}} with 10.{{octA}}.{{vA}}.1/24, and gi0/0.{{vB}} dot1Q {{vB}} with 10.{{octB}}.{{vB}}.1/24.'] },
    { id: 'routing', text: 'PCs in different VLANs reach each other', hints: ['Once both gateways answer, R1 routes between its connected subnets by itself.', 'If one direction fails, one subinterface has the wrong VLAN tag or address.', 'Check both encapsulation dot1Q numbers against the access ports on S1.'] },
  ],
  tests: [
    { id: 'a-gateway', requirement: 'gateways', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '10.{{octA}}.{{vA}}.1' } } },
    { id: 'b-gateway', requirement: 'gateways', points: 2, check: { kind: 'reach', params: { from: 'PC3', to: '10.{{octB}}.{{vB}}.1' } } },
    { id: 'a-to-b', requirement: 'routing', points: 3, visibility: 'shown', check: { kind: 'reach', params: { from: 'PC1', to: '10.{{octB}}.{{vB}}.10' } } },
    { id: 'b-to-a', requirement: 'routing', points: 2, check: { kind: 'reach', params: { from: 'PC3', to: '10.{{octA}}.{{vA}}.11' } } },
    { id: 'a-port', requirement: 'routing', points: 1, check: { kind: 'accessVlan', params: { switch: 'S1', port: 'FastEthernet0/1', vlan: '{{vA}}' } } },
    { id: 'b-port', requirement: 'routing', points: 1, check: { kind: 'accessVlan', params: { switch: 'S1', port: 'FastEthernet0/3', vlan: '{{vB}}' } } },
  ],
  solution:
    'S1 shows Fa0/1 and Fa0/2 in VLAN {{vA}} and Fa0/3 in VLAN {{vB}}; the PCs show 10.{{octA}}.{{vA}}.0/24 and 10.{{octB}}.{{vB}}.0/24 with gateways ending in .1. Make S1 Gi0/1 a trunk, then on R1 create Gi0/0.{{vA}} (encapsulation dot1Q {{vA}}, 10.{{octA}}.{{vA}}.1/24) and Gi0/0.{{vB}} (encapsulation dot1Q {{vB}}, 10.{{octB}}.{{vB}}.1/24). The access ports must stay as they are.',
  layout: office(SAMPLE).layout,
  start: (p) => office(p).topology,
  reference: (p) => office(p, { trunk: true, subs: true }).topology,
  wrong: [
    (p) => office(p, { subs: true }).topology,
    (p) => stick(Number(p.vA), Number(p.vA), net(p, 'A'), net(p, 'B'), { trunk: true, subs: false }).topology, // everyone moved into one VLAN
  ],
};
