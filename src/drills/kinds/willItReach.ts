// "Will this ping work?" over a generated switched network. Unlike the other
// kinds, the answer is not computed by drill code: the simulator runs the
// ping (actualOutcome in problems/predict.ts), so the answer is always what
// Networky really does. The generator also writes down what it EXPECTS and
// why; a test runs thousands of variants and fails if the two ever disagree,
// which catches a wrong explanation as surely as a wrong answer.
//
// Runs the engine once per question, so it is graded in the browser only:
// replaying 10 simulations in one request would not fit the free server's
// 10 ms CPU budget (docs/profiles-and-drills.md).

import { Draft } from '../../model/draft';
import { actualOutcome } from '../../problems/predict';
import type { Rng } from '../../problems/random';
import type { DrillKind, DrillQuestion, Level } from '../types';
import { shuffle } from './util';

type Outcome = 'success' | 'lost' | 'unreachable';
export const OUTCOME_TEXT: Record<Outcome, string> = {
  success: 'Replies come back',
  unreachable: 'Destination unreachable: the sending PC gives up (no ARP reply, or no gateway)',
  lost: 'Request timed out: the request or the reply is lost on the way',
};

interface Host {
  name: string;
  sw: 'S1' | 'S2';
  port: string;
  vlan: number;
  ip: string;
  gateway: string | null;
}

interface Built {
  draft: Draft;
  hosts: Host[];
  facts: string[];
  /** The generator's own prediction, with its reasons. */
  predict(a: Host, b: Host): { outcome: Outcome; why: string[] };
}

const VLAN_PAIRS: readonly [number, number][] = [
  [10, 20],
  [10, 30],
  [20, 40],
  [100, 200],
];

function pcs(r: Rng, perSwitch: Record<'S1' | 'S2', number>, vlans: readonly number[], addr: (vlan: number, i: number) => string, gateway: (vlan: number) => string | null): Host[] {
  const hosts: Host[] = [];
  let n = 1;
  for (const sw of ['S1', 'S2'] as const) {
    const vs = Array.from({ length: perSwitch[sw] }, () => r.pick(vlans));
    vs.forEach((vlan, i) => {
      hosts.push({ name: `PC${n}`, sw, port: `FastEthernet0/${i + 1}`, vlan, ip: addr(vlan, 10 + n), gateway: gateway(vlan) });
      n++;
    });
  }
  return hosts;
}

/** Level 1: one switch, two VLANs, one IP subnet. Only the VLAN decides. */
function oneSwitch(r: Rng): Built {
  const [a, b] = r.pick(VLAN_PAIRS);
  const net = `192.168.${r.int(1, 254)}`;
  let hosts = pcs(r, { S1: 4, S2: 0 }, [a, b], (_, i) => `${net}.${i}`, () => null);
  if (new Set(hosts.map((h) => h.vlan)).size < 2) hosts = hosts.map((h, i) => (i === 0 ? { ...h, vlan: h.vlan === a ? b : a } : h));
  const d = new Draft({ stableIds: true }).dev('switch', 'S1', 300, 0);
  hosts.forEach((h, i) => d.dev('pc', h.name, i * 150, 200).link(h.name, 'FastEthernet0', 'S1', h.port).access('S1', h.port, h.vlan).ip(h.name, 'FastEthernet0', h.ip, 24));
  return {
    draft: d,
    hosts,
    facts: [`One switch, S1. Every PC is in ${net}.0/24 with no default gateway.`, ...hosts.map((h) => `${h.name} (${h.ip}) is in VLAN ${h.vlan}.`)],
    predict: (x, y) =>
      x.vlan === y.vlan
        ? { outcome: 'success', why: [`${x.name} and ${y.name} are both in VLAN ${x.vlan}, so the switch delivers the ARP request and the ping.`] }
        : { outcome: 'unreachable', why: [`The address is in ${x.name}'s own subnet, so it ARPs for it directly.`, `But ${x.name} is in VLAN ${x.vlan} and ${y.name} in VLAN ${y.vlan}: a VLAN is its own broadcast domain, so the ARP request never reaches ${y.name}. No ARP reply, no MAC address to send to: "destination host unreachable". Same subnet is not enough.`] },
  };
}

/** Level 2: two switches; the link between them is a trunk, or an access port in one VLAN. */
function twoSwitches(r: Rng): Built {
  const [a, b] = r.pick(VLAN_PAIRS);
  const net = `10.${r.int(0, 255)}.${r.int(0, 255)}`;
  const hosts = pcs(r, { S1: 2, S2: 2 }, [a, b], (_, i) => `${net}.${i}`, () => null);
  const trunk = r.int(0, 2) > 0;
  const linkVlan = r.pick([a, b]);
  const d = new Draft({ stableIds: true }).dev('switch', 'S1', 150, 0).dev('switch', 'S2', 550, 0).link('S1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1', 'copper-cross');
  if (trunk) d.trunk('S1', 'GigabitEthernet0/1').trunk('S2', 'GigabitEthernet0/1');
  else d.access('S1', 'GigabitEthernet0/1', linkVlan).access('S2', 'GigabitEthernet0/1', linkVlan);
  hosts.forEach((h, i) => d.dev('pc', h.name, i * 200, 200).link(h.name, 'FastEthernet0', h.sw, h.port).access(h.sw, h.port, h.vlan).ip(h.name, 'FastEthernet0', h.ip, 24));
  return {
    draft: d,
    hosts,
    facts: [
      `Two switches joined on GigabitEthernet0/1. ${trunk ? 'That link is a trunk on both sides.' : `That link is an access port in VLAN ${linkVlan} on both sides, not a trunk.`}`,
      `Every PC is in ${net}.0/24 with no default gateway.`,
      ...hosts.map((h) => `${h.name} (${h.ip}) is on ${h.sw}, VLAN ${h.vlan}.`),
    ],
    predict(x, y) {
      if (x.vlan !== y.vlan) return { outcome: 'unreachable', why: [`${x.name} (VLAN ${x.vlan}) and ${y.name} (VLAN ${y.vlan}) are in different VLANs and there is no router, so ${x.name}'s ARP request never reaches ${y.name}. With no ARP reply, ${x.name} reports the host unreachable.`] };
      if (x.sw === y.sw) return { outcome: 'success', why: [`Both are in VLAN ${x.vlan} on ${x.sw}: the switch delivers the frames without using the link at all.`] };
      if (trunk) return { outcome: 'success', why: [`Both are in VLAN ${x.vlan}. The trunk carries every VLAN, tagged, so the frames cross to ${y.sw}.`] };
      return linkVlan === x.vlan
        ? { outcome: 'success', why: [`Both are in VLAN ${x.vlan}, and the access link between the switches is in VLAN ${linkVlan} too, so their frames cross it (untagged).`] }
        : { outcome: 'unreachable', why: [`Both are in VLAN ${x.vlan}, but the link between the switches is an access port in VLAN ${linkVlan}: only VLAN ${linkVlan} crosses it, so the ARP request never reaches ${y.sw}. A link that must carry several VLANs has to be a trunk.`] };
    },
  };
}

/** Level 3: two VLANs, two subnets, a router with a port in each. Gateways decide. */
function routed(r: Rng): Built {
  const [a, b] = r.pick(VLAN_PAIRS);
  const prefix: Record<number, string> = { [a]: `10.${a}.0`, [b]: `10.${b}.0` };
  // Most PCs have a gateway; about one in four was left without one.
  const hosts = pcs(r, { S1: 4, S2: 0 }, [a, b], (v, i) => `${prefix[v]}.${i}`, (v) => (r.int(0, 3) > 0 ? `${prefix[v]}.1` : null));
  if (new Set(hosts.map((h) => h.vlan)).size < 2) {
    const v = hosts[0].vlan === a ? b : a;
    hosts[0] = { ...hosts[0], vlan: v, ip: `${prefix[v]}.11`, gateway: hosts[0].gateway && `${prefix[v]}.1` };
  }
  const d = new Draft({ stableIds: true })
    .dev('switch', 'S1', 300, 100)
    .dev('router', 'R1', 300, -100)
    .link('R1', 'GigabitEthernet0/0', 'S1', 'FastEthernet0/7')
    .link('R1', 'GigabitEthernet0/1', 'S1', 'FastEthernet0/8')
    .access('S1', 'FastEthernet0/7', a)
    .access('S1', 'FastEthernet0/8', b)
    .ip('R1', 'GigabitEthernet0/0', `${prefix[a]}.1`, 24)
    .ip('R1', 'GigabitEthernet0/1', `${prefix[b]}.1`, 24);
  hosts.forEach((h, i) => {
    d.dev('pc', h.name, i * 150, 300).link(h.name, 'FastEthernet0', 'S1', h.port).access('S1', h.port, h.vlan).ip(h.name, 'FastEthernet0', h.ip, 24);
    if (h.gateway) d.gw(h.name, h.gateway);
  });
  return {
    draft: d,
    hosts,
    facts: [
      `Every PC and router R1 plug into switch S1. VLAN ${a} is ${prefix[a]}.0/24 and VLAN ${b} is ${prefix[b]}.0/24; R1 has a port in each (${prefix[a]}.1 and ${prefix[b]}.1).`,
      ...hosts.map((h) => `${h.name} (${h.ip}) is in VLAN ${h.vlan}, ${h.gateway ? `gateway ${h.gateway}` : 'no default gateway'}.`),
    ],
    predict(x, y) {
      if (x.vlan === y.vlan) return { outcome: 'success', why: [`Same VLAN and subnet: ${x.name} ARPs for ${y.name} directly. Gateways are not used.`] };
      if (!x.gateway) return { outcome: 'unreachable', why: [`${y.ip} is outside ${x.name}'s subnet, so ${x.name} needs a default gateway, and it has none. It gives up at once: not a single frame is sent.`] };
      if (!y.gateway) return { outcome: 'lost', why: [`${x.name} sends the request to its gateway and R1 routes it to ${y.name}.`, `But ${y.name} has no gateway, so it cannot send the reply back to another subnet. ${x.name} waits and times out: a ping needs a path both ways.`] };
      return { outcome: 'success', why: [`${x.name} sends to its gateway, R1 routes between the two VLANs, and ${y.name} replies through its own gateway.`] };
    },
  };
}

const BUILD: Record<Level, (r: Rng) => Built> = { 1: oneSwitch, 2: twoSwitches, 3: routed };

/** The question plus what the generator expected, for the test that checks it against the engine. */
export function generateReach(r: Rng, level: Level): { question: DrillQuestion; predicted: Outcome } {
  const built = BUILD[level](r);
  const [x, y] = shuffle(r, built.hosts);
  const topology = built.draft.done().topology;
  const actual = actualOutcome(topology, { id: 'q', prompt: '', traffic: { kind: 'ping', from: x.name, to: y.ip }, choices: [], explanation: '' });
  const outcome: Outcome = actual === 'success' || actual === 'unreachable' ? actual : 'lost';
  const p = built.predict(x, y);
  return {
    predicted: p.outcome,
    question: {
      type: 'choice',
      prompt: [...built.facts, `${x.name} pings ${y.name} (${y.ip}). What happens?`].join('\n'),
      choices: (['success', 'unreachable', 'lost'] as const).map((o) => OUTCOME_TEXT[o]),
      expected: { choice: OUTCOME_TEXT[outcome] },
      explanation: p.outcome === outcome ? p.why : [`The simulator says: ${OUTCOME_TEXT[outcome].toLowerCase()}.`],
    },
  };
}

export const willItReach: DrillKind = {
  id: 'will-it-reach',
  title: 'Will it reach?',
  topic: 'VLANs',
  summary: 'Read a small switched network and predict a ping. The simulator gives the answer.',
  levels: { 1: 'One switch, two VLANs, one subnet', 2: 'Two switches: a trunk, or not', 3: 'A router between VLANs, and gateways' },
  runsEngine: true,
  generate: (r, level) => generateReach(r, level).question,
};
