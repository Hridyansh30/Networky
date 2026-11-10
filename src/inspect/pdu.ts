// PDU details: one recorded hop broken down by OSI layer, top layer first,
// the way Wireshark and Packet Tracer present a frame.
//
// Where each protocol lives (and why):
//   ICMP / ICMPv6  layer 3. It rides inside IP (protocol 1 / next header 58)
//                  and has no ports. It is IP's own control channel, not a
//                  transport protocol, so it is shown INSIDE the L3 section.
//   OSPF           layer 3, directly inside IP (protocol 89), no TCP or UDP.
//   ARP, STP       layer 2: they never get an IP header at all.
//   DHCP, RIP      layer 7 applications carried over UDP (L4).

import type { Frame } from '../engine/packets';
import { isArp, isIcmp, isIpv4, isTcp, isUdp } from '../engine/packets';
import type { HopRecord, Simulation } from '../engine/simulation';
import { isIpv6, type Ipv6Packet } from '../engine/plugins/ipv6';
import { isBpdu } from '../engine/plugins/stp';
import { CABLES } from '../model/catalog';
import type { Interface } from '../model/types';
import { formatBridge } from '../engine/plugins/stp';

export interface PduField {
  label: string;
  value: string;
}

export interface PduSection {
  /** 'L7' ... 'L1' */
  layer: string;
  title: string;
  fields: PduField[];
  /** A protocol carried inside this layer (ICMP inside IPv4, ARP inside Ethernet). */
  inner?: { title: string; fields: PduField[] };
}

export interface PduDetails {
  index: number;
  tick: number;
  protocol: string;
  from: string;
  to: string;
  summary: string;
  sections: PduSection[];
  /** The frame as data, for the Raw tab. */
  raw: unknown;
}

const f = (label: string, value: string | number | undefined | null): PduField => ({ label, value: value === undefined || value === null || value === '' ? '—' : String(value) });

const ICMP_TYPE: Record<string, [number, string]> = {
  'echo-request': [8, 'Echo request'],
  'echo-reply': [0, 'Echo reply'],
  'time-exceeded': [11, 'Time exceeded'],
  unreachable: [3, 'Destination unreachable'],
};
const ICMP_CODE: Record<string, string> = { net: '0 (network unreachable)', host: '1 (host unreachable)', port: '3 (port unreachable)', admin: '13 (administratively prohibited)' };
const ICMP6_TYPE: Record<string, [number, string]> = {
  'echo-request': [128, 'Echo request'],
  'echo-reply': [129, 'Echo reply'],
  'time-exceeded': [3, 'Time exceeded'],
  unreachable: [1, 'Destination unreachable'],
  rs: [133, 'Router solicitation (NDP)'],
  ra: [134, 'Router advertisement (NDP)'],
  ns: [135, 'Neighbor solicitation (NDP)'],
  na: [136, 'Neighbor advertisement (NDP)'],
};
const IP_PROTO: Record<string, number> = { icmp: 1, tcp: 6, udp: 17, ospf: 89 };
const SPEED: Record<Interface['portType'], string> = { fastethernet: '100 Mbps', gigabitethernet: '1 Gbps', fiber: '1 Gbps (fiber)', serial: '1.544 Mbps (T1)' };

function etherType(frame: Frame): string {
  const p = frame.payload;
  if (isArp(p)) return '0x0806 (ARP)';
  if (isIpv4(p)) return '0x0800 (IPv4)';
  if (isIpv6(p)) return '0x86DD (IPv6)';
  if (isBpdu(p)) return 'none: 802.3 LLC frame (DSAP 0x42, STP)';
  return '—';
}

/** Key/value lines for an application message we don't have a special layout for. */
function appFields(data: Record<string, unknown>): PduField[] {
  return Object.entries(data)
    .filter(([k]) => k !== 'app')
    .map(([k, v]) => f(k, typeof v === 'object' ? JSON.stringify(v) : (v as string)));
}

function ipv6Section(p: Ipv6Packet): PduSection {
  const m = p.l4;
  const [num, name] = ICMP6_TYPE[m.type] ?? [0, m.type];
  const inner: PduField[] = [f('Type', `${num} (${name})`)];
  if (m.id !== undefined) inner.push(f('Identifier', m.id), f('Sequence', m.seq));
  if (m.target) inner.push(f('Target address', m.target));
  if (m.mac) inner.push(f('Link-layer address option', m.mac));
  if (m.prefixes?.length) inner.push(f('Prefix information', m.prefixes.map((x) => `${x.prefix}/${x.prefixLength}`).join(', ')));
  if (m.code) inner.push(f('Code', m.code));
  return {
    layer: 'L3',
    title: 'Network: IPv6',
    fields: [f('Version', 6), f('Source', p.src), f('Destination', p.dst), f('Hop limit', p.hopLimit), f('Next header', '58 (ICMPv6)')],
    inner: { title: 'ICMPv6 (inside IPv6)', fields: inner },
  };
}

export function pduDetails(sim: Simulation, hop: HopRecord): PduDetails {
  const t = sim.topology;
  const fromIf = t.interfaces[hop.fromIf];
  const toIf = t.interfaces[hop.toIf];
  const fromDev = t.devices[hop.fromDevice];
  const toDev = t.devices[hop.toDevice];
  const frame = hop.frame;
  const p = frame.payload;
  const sections: PduSection[] = [];

  // ---- L7 / L4 / L3
  if (isIpv4(p)) {
    const l4 = p.l4;
    if (isUdp(l4)) {
      const app = l4.data.app.toUpperCase();
      sections.push({ layer: 'L7', title: `Application: ${app}`, fields: appFields(l4.data as unknown as Record<string, unknown>) });
      sections.push({ layer: 'L4', title: 'Transport: UDP', fields: [f('Source port', l4.srcPort), f('Destination port', l4.dstPort)] });
    } else if (isTcp(l4)) {
      sections.push({
        layer: 'L4',
        title: 'Transport: TCP',
        fields: [f('Source port', l4.srcPort), f('Destination port', l4.dstPort), f('Flags', l4.flags.toUpperCase().replace('-', ', '))],
      });
    }
    const ip: PduSection = {
      layer: 'L3',
      title: 'Network: IPv4',
      fields: [f('Version', 4), f('Source', p.src), f('Destination', p.dst), f('TTL', p.ttl), f('Protocol', `${IP_PROTO[l4.proto] ?? '?'} (${l4.proto.toUpperCase()})`)],
    };
    if (isIcmp(l4)) {
      const [num, name] = ICMP_TYPE[l4.type];
      ip.inner = {
        title: 'ICMP (inside IPv4, protocol 1)',
        fields: [f('Type', `${num} (${name})`), f('Code', l4.code ? ICMP_CODE[l4.code] : 0), f('Identifier', `0x${l4.id.toString(16).padStart(4, '0')}`), f('Sequence', l4.seq)],
      };
    } else if (l4.proto === 'ospf') {
      ip.inner = { title: 'OSPF (inside IPv4, protocol 89)', fields: appFields(l4 as unknown as Record<string, unknown>).filter((x) => x.label !== 'proto') };
    }
    sections.push(ip);
  } else if (isIpv6(p)) {
    sections.push(ipv6Section(p));
  }

  // ---- L2
  const l2: PduSection = {
    layer: 'L2',
    title: frame.vlan !== undefined ? 'Data link: Ethernet II + 802.1Q tag' : 'Data link: Ethernet II',
    fields: [f('Destination MAC', frame.dstMac), f('Source MAC', frame.srcMac), f('802.1Q VLAN tag', frame.vlan ?? 'none (untagged)'), f('EtherType', etherType(frame))],
  };
  if (isArp(p)) {
    l2.inner = {
      title: `ARP ${p.op} (carried directly in Ethernet, no IP header)`,
      fields: [f('Operation', p.op === 'request' ? '1 (request)' : '2 (reply)'), f('Sender MAC', p.senderMac), f('Sender IP', p.senderIp), f('Target MAC', p.targetMac), f('Target IP', p.targetIp)],
    };
  } else if (isBpdu(p)) {
    l2.inner = {
      title: 'STP configuration BPDU',
      fields: [f('Root bridge', formatBridge(p.root)), f('Root path cost', p.rootCost), f('Sender bridge', formatBridge(p.bridge)), f('Sender port', p.portId)],
    };
  }
  sections.push(l2);

  // ---- L1
  const link = t.links[hop.linkId];
  sections.push({
    layer: 'L1',
    title: 'Physical',
    fields: [
      f('Out of', `${fromDev?.hostname} ${fromIf?.name}`),
      f('Into', `${toDev?.hostname} ${toIf?.name}`),
      f('Cable', link ? CABLES[link.cable].label : '—'),
      f('Port speed', fromIf ? SPEED[fromIf.portType] : '—'),
    ],
  });

  return {
    index: hop.index,
    tick: hop.tick,
    protocol: hop.tag,
    from: `${fromDev?.hostname ?? '?'} (${fromIf?.name ?? '?'})`,
    to: `${toDev?.hostname ?? '?'} (${toIf?.name ?? '?'})`,
    summary: sim.describe(p),
    sections,
    raw: frame,
  };
}
