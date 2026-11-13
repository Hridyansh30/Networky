// IPv6: a whole second network layer, running beside IPv4 on the same wires.
//
// What changes compared with IPv4:
//   - 128-bit addresses. Every IPv6 interface ALSO has a LINK-LOCAL address
//     (fe80::/64 + an EUI-64 id built from its MAC), used only on its own link.
//   - No ARP and no broadcast. NEIGHBOR DISCOVERY (NDP, part of ICMPv6) asks
//     "who has 2001:db8:1::5?" with a NEIGHBOR SOLICITATION sent to a
//     SOLICITED-NODE MULTICAST group (ff02::1:ffXX:XXXX), which only the
//     owner listens to. The owner answers with a NEIGHBOR ADVERTISEMENT.
//   - SLAAC: a host can configure itself. It sends a ROUTER SOLICITATION to
//     ff02::2 (all routers); a router answers with a ROUTER ADVERTISEMENT
//     carrying the /64 prefix; the host appends its EUI-64 id and uses the
//     router's link-local address as its gateway. No DHCP needed.
//   - 'Hop limit' is IPv6's TTL; routers still answer ICMPv6 time exceeded.
//
// Simplifications: no DAD, no DHCPv6, no IPv6 ACLs/NAT/routing protocols,
// and link-local destinations are only pingable on the source's own link.

import { CATALOG, isHostKind } from '../../model/catalog';
import {
  formatIPv6,
  inSubnetV6,
  isLinkLocal,
  isMulticastV6,
  isValidIPv6,
  linkLocalFromMac,
  multicastMacV6,
  networkOfV6,
  normalizeIPv6,
  slaacAddress,
  solicitedNode,
} from '../../model/ip6';
import type { Device, Interface } from '../../model/types';
import type { Frame, L4, Payload } from '../packets';
import type { EnginePlugin, Probe, SimApi } from '../plugin';
import { AD, type Route } from '../routing';

export const ALL_NODES = 'ff02::1';
export const ALL_ROUTERS = 'ff02::2';
const DEFAULT_HOP_LIMIT = 64;

export type Icmpv6Type = 'echo-request' | 'echo-reply' | 'time-exceeded' | 'unreachable' | 'ns' | 'na' | 'rs' | 'ra';

export interface Icmpv6 extends L4 {
  proto: 'icmpv6';
  type: Icmpv6Type;
  id?: number;
  seq?: number;
  code?: 'no-route' | 'address';
  /** NS / NA: the address being asked about */
  target?: string;
  /** NA / RA: link-layer address option */
  mac?: string;
  /** RA: prefix information */
  prefixes?: { prefix: string; prefixLength: number }[];
}

export interface Ipv6Packet extends Payload {
  kind: 'ipv6';
  src: string;
  dst: string;
  hopLimit: number;
  l4: Icmpv6;
}

export const isIpv6 = (p: Payload): p is Ipv6Packet => p.kind === 'ipv6';

interface NeighborEntry {
  mac: string;
  interfaceId: string;
  learnedAt: number;
}

interface Pending6 {
  deviceId: string;
  interfaceId: string;
  nextHop: string;
  packet: Ipv6Packet;
  forwarded?: string; // ingress interface id
}

interface Ipv6State {
  /** device -> IPv6 address -> neighbour */
  neighbors: Record<string, Record<string, NeighborEntry>>;
  /** interface -> address learned by SLAAC */
  slaac: Record<string, { address: string; prefixLength: number; router: string; routerInterfaceId: string }>;
  pending: Pending6[];
}

const state = (sim: SimApi) => sim.state<Ipv6State>('ipv6', () => ({ neighbors: {}, slaac: {}, pending: [] }));

// =============================================================== addressing

export function globalOf(sim: SimApi, iface: Interface): { address: string; prefixLength: number } | undefined {
  return iface.ipv6 ?? state(sim).slaac[iface.id];
}

/** IPv6 is enabled on an interface that has (or will get) a global address. */
export function ipv6Enabled(sim: SimApi, iface: Interface): boolean {
  return !!(iface.ipv6 || iface.ipv6Auto || state(sim).slaac[iface.id]);
}

export function linkLocalOf(iface: Interface): string {
  return linkLocalFromMac(iface.mac);
}

function ownsAddress(sim: SimApi, device: Device, ip: string): boolean {
  return sim.interfacesOf(device).some((i) => ipv6Enabled(sim, i) && (globalOf(sim, i)?.address === ip || linkLocalOf(i) === ip));
}

export function neighborsOf(sim: SimApi, deviceId: string): Record<string, NeighborEntry> {
  return state(sim).neighbors[deviceId] ?? {};
}

export function slaacOf(sim: SimApi, interfaceId: string) {
  return state(sim).slaac[interfaceId];
}

// ================================================================== routing

export function routesV6(sim: SimApi, router: Device): Route[] {
  const connected: Route[] = [];
  for (const iface of sim.interfacesOf(router)) {
    const g = globalOf(sim, iface);
    if (!g || !sim.isUp(iface)) continue;
    connected.push({ source: 'connected', code: 'C', ad: AD.connected, metric: 0, network: formatIPv6(networkOfV6(g.address, g.prefixLength)), prefixLength: g.prefixLength, interfaceId: iface.id });
  }
  const statics: Route[] = [];
  for (const r of router.ipv6StaticRoutes ?? []) {
    const via = lpm6(connected, r.nextHop);
    if (!via) continue;
    statics.push({ source: 'static', code: 'S', ad: AD.static, metric: 0, network: formatIPv6(networkOfV6(r.prefix, r.prefixLength)), prefixLength: r.prefixLength, interfaceId: via.interfaceId, nextHop: r.nextHop });
  }
  return [...connected, ...statics].sort((a, b) => b.prefixLength - a.prefixLength);
}

function lpm6(routes: Route[], dst: string): Route | undefined {
  let best: Route | undefined;
  for (const r of routes) if (inSubnetV6(dst, r.network, r.prefixLength) && (!best || r.prefixLength > best.prefixLength)) best = r;
  return best;
}

// ===================================================================== send

function frameOut(sim: SimApi, iface: Interface, dstMac: string, packet: Ipv6Packet, note?: string) {
  const control = ['ns', 'na', 'rs', 'ra'].includes(packet.l4.type);
  sim.transmit(iface, sim.makeFrame(iface.mac, dstMac, packet, { control }), note);
}

/** Pick the egress interface and next hop, then resolve with NDP and send. Returns an error if impossible. */
function send(sim: SimApi, device: Device, packet: Ipv6Packet, forwardedFrom?: Interface): string | null {
  let egress: Interface | undefined;
  let nextHop = packet.dst;
  if (device.kind === 'router') {
    const route = lpm6(routesV6(sim, device), packet.dst);
    if (!route) return `${device.hostname} has no IPv6 route to ${packet.dst}`;
    egress = sim.topology.interfaces[route.interfaceId];
    nextHop = route.nextHop ?? packet.dst;
  } else {
    egress = sim.interfacesOf(device).find((i) => ipv6Enabled(sim, i));
    if (!egress) return `${device.hostname} has no IPv6 address`;
    const g = globalOf(sim, egress);
    if (!isLinkLocal(packet.dst)) {
      if (!g) return `${device.hostname} has no global IPv6 address${egress.ipv6Auto ? ' (SLAAC has not configured one)' : ''}`;
      if (!inSubnetV6(packet.dst, g.address, g.prefixLength)) {
        const gw = device.defaultGatewayV6 ?? state(sim).slaac[egress.id]?.router;
        if (!gw) return `${packet.dst} is off-link and ${device.hostname} has no IPv6 default gateway`;
        nextHop = gw;
        sim.logEvent({ deviceId: device.id, kind: 'info', text: `${device.hostname}: ${packet.dst} is off-link, sending to gateway ${gw}` });
      }
    }
  }
  const src = packet.src || (isLinkLocal(packet.dst) || isLinkLocal(nextHop) && !globalOf(sim, egress) ? linkLocalOf(egress) : globalOf(sim, egress)?.address ?? linkLocalOf(egress));
  resolveAndSend(sim, device, egress, nextHop, { ...packet, src }, forwardedFrom?.id);
  return null;
}

function resolveAndSend(sim: SimApi, device: Device, egress: Interface, nextHop: string, packet: Ipv6Packet, forwarded?: string) {
  if (isMulticastV6(packet.dst)) return frameOut(sim, egress, multicastMacV6(packet.dst), packet);
  const entry = state(sim).neighbors[device.id]?.[nextHop];
  if (entry) return frameOut(sim, egress, entry.mac, packet);
  const s = state(sim);
  const asking = s.pending.some((p) => p.deviceId === device.id && p.interfaceId === egress.id && p.nextHop === nextHop);
  s.pending.push({ deviceId: device.id, interfaceId: egress.id, nextHop, packet, forwarded });
  if (asking) return;
  sim.logEvent({ deviceId: device.id, kind: 'info', control: true, text: `${device.hostname} doesn't know ${nextHop}'s MAC; asks with an NDP neighbor solicitation to ${solicitedNode(nextHop)}` });
  const ns: Ipv6Packet = {
    kind: 'ipv6',
    src: globalOf(sim, egress)?.address ?? linkLocalOf(egress),
    dst: solicitedNode(nextHop),
    hopLimit: 255,
    l4: { proto: 'icmpv6', type: 'ns', target: nextHop, mac: egress.mac },
  };
  frameOut(sim, egress, multicastMacV6(ns.dst), ns, 'solicited-node multicast, not a broadcast');
}

function learn(sim: SimApi, device: Device, iface: Interface, ip: string, mac: string) {
  const table = (state(sim).neighbors[device.id] ??= {});
  if (table[ip]?.mac === mac) return;
  table[ip] = { mac, interfaceId: iface.id, learnedAt: sim.tick };
  sim.logEvent({ deviceId: device.id, kind: 'learn', control: true, text: `${device.hostname} caches neighbour ${ip} → ${mac}` });
  const s = state(sim);
  const ready = s.pending.filter((p) => p.deviceId === device.id && p.interfaceId === iface.id && p.nextHop === ip);
  s.pending = s.pending.filter((p) => !ready.includes(p));
  for (const p of ready) frameOut(sim, iface, mac, p.packet, 'held packet released after NDP');
}

// ================================================================== receive

function receive(sim: SimApi, device: Device, iface: Interface, frame: Frame, packet: Ipv6Packet) {
  if (!ipv6Enabled(sim, iface) && !(device.kind === 'router' && iface.ipv6)) {
    sim.logEvent({ deviceId: device.id, kind: 'drop', frameId: frame.id, text: `${device.hostname} ${iface.name} has IPv6 disabled` });
    return;
  }
  const m = packet.l4;
  switch (m.type) {
    case 'ns':
      if (m.target && (globalOf(sim, iface)?.address === m.target || linkLocalOf(iface) === m.target)) {
        if (m.mac) learn(sim, device, iface, packet.src, m.mac);
        const na: Ipv6Packet = { kind: 'ipv6', src: m.target, dst: packet.src, hopLimit: 255, l4: { proto: 'icmpv6', type: 'na', target: m.target, mac: iface.mac } };
        frameOut(sim, iface, m.mac ?? frame.srcMac, na, 'neighbor advertisement, unicast');
      }
      return;
    case 'na':
      if (m.target && m.mac) learn(sim, device, iface, m.target, m.mac);
      return;
    case 'rs':
      if (device.kind === 'router') sendRa(sim, device, iface);
      return;
    case 'ra':
      if (device.kind !== 'router') onRa(sim, device, iface, packet, frame.srcMac);
      return;
  }
  if (ownsAddress(sim, device, packet.dst) || (isMulticastV6(packet.dst) && packet.dst === ALL_NODES)) return deliver(sim, device, packet);
  if (device.kind !== 'router') {
    sim.logEvent({ deviceId: device.id, kind: 'drop', frameId: frame.id, text: `${device.hostname} drops an IPv6 packet for ${packet.dst}: hosts don't forward` });
    return;
  }
  forward(sim, device, iface, packet, frame.id);
}

function deliver(sim: SimApi, device: Device, packet: Ipv6Packet) {
  const m = packet.l4;
  sim.logEvent({ deviceId: device.id, kind: 'receive', text: `${device.hostname} receives ${describe6(packet)}` });
  if (m.type === 'echo-request') {
    const reply: Ipv6Packet = { kind: 'ipv6', src: packet.dst, dst: packet.src, hopLimit: DEFAULT_HOP_LIMIT, l4: { ...m, type: 'echo-reply' } };
    const err = send(sim, device, reply);
    if (err) sim.logEvent({ deviceId: device.id, kind: 'drop', text: `${device.hostname} cannot reply: ${err}` });
    return;
  }
  const probe = m.id !== undefined ? sim.findProbe(m.id) : undefined;
  if (!probe || probe.seq !== m.seq || probe.sourceDeviceId !== device.id) return; // see deliverLocal in simulation.ts
  const rtt = sim.tick - probe.sentAt;
  if (m.type === 'echo-reply') sim.finishProbe(probe, 'success', `reply from ${packet.src}`, rtt, packet.src);
  else if (m.type === 'time-exceeded') sim.finishProbe(probe, 'ttl-exceeded', `hop limit expired at ${packet.src}`, rtt, packet.src);
  else if (m.type === 'unreachable') sim.finishProbe(probe, 'unreachable', `${packet.src} reports destination unreachable (${m.code ?? 'no-route'})`, rtt, packet.src);
}

function forward(sim: SimApi, router: Device, ingress: Interface, packet: Ipv6Packet, frameId: number) {
  if (isMulticastV6(packet.dst)) return; // link-scope multicast is never routed
  if (packet.hopLimit <= 1) {
    sim.logEvent({ deviceId: router.id, kind: 'drop', frameId, text: `${router.hostname}: hop limit reached 0` });
    return error6(sim, router, ingress, packet, 'time-exceeded');
  }
  const route = lpm6(routesV6(sim, router), packet.dst);
  if (!route) {
    sim.logEvent({ deviceId: router.id, kind: 'drop', frameId, text: `${router.hostname} has no IPv6 route to ${packet.dst}` });
    return error6(sim, router, ingress, packet, 'unreachable');
  }
  const egress = sim.topology.interfaces[route.interfaceId];
  sim.logEvent({ deviceId: router.id, kind: 'info', frameId, text: `${router.hostname} routes ${packet.dst} via ${route.network}/${route.prefixLength} (${route.source}) out ${egress.name}, hop limit ${packet.hopLimit} → ${packet.hopLimit - 1}` });
  resolveAndSend(sim, router, egress, route.nextHop ?? packet.dst, { ...packet, hopLimit: packet.hopLimit - 1 }, ingress.id);
}

function error6(sim: SimApi, router: Device, ingress: Interface, packet: Ipv6Packet, type: 'time-exceeded' | 'unreachable') {
  if (packet.l4.type !== 'echo-request' && packet.l4.type !== 'echo-reply') return;
  const src = globalOf(sim, ingress)?.address ?? linkLocalOf(ingress);
  send(sim, router, { kind: 'ipv6', src, dst: packet.src, hopLimit: DEFAULT_HOP_LIMIT, l4: { proto: 'icmpv6', type, id: packet.l4.id, seq: packet.l4.seq, code: type === 'unreachable' ? 'no-route' : undefined } });
}

// =================================================================== SLAAC

function sendRa(sim: SimApi, router: Device, iface: Interface) {
  const g = iface.ipv6;
  if (!g) return;
  const prefixes = g.prefixLength === 64 ? [{ prefix: formatIPv6(networkOfV6(g.address, 64)), prefixLength: 64 }] : [];
  sim.logEvent({ deviceId: router.id, kind: 'info', control: true, text: `${router.hostname} answers with a router advertisement: prefix ${prefixes.map((p) => `${p.prefix}/64`).join(', ') || '(none: SLAAC needs a /64)'}` });
  const ra: Ipv6Packet = { kind: 'ipv6', src: linkLocalOf(iface), dst: ALL_NODES, hopLimit: 255, l4: { proto: 'icmpv6', type: 'ra', prefixes, mac: iface.mac } };
  frameOut(sim, iface, multicastMacV6(ALL_NODES), ra, 'to all nodes on the link');
}

function onRa(sim: SimApi, host: Device, iface: Interface, packet: Ipv6Packet, srcMac: string) {
  if (!iface.ipv6Auto) return;
  const p = packet.l4.prefixes?.[0];
  if (!p) return;
  const address = slaacAddress(p.prefix, iface.mac);
  state(sim).slaac[iface.id] = { address, prefixLength: 64, router: packet.src, routerInterfaceId: iface.id };
  learn(sim, host, iface, packet.src, packet.l4.mac ?? srcMac);
  sim.logEvent({ deviceId: host.id, kind: 'success', control: true, text: `${host.hostname} SLAAC: ${p.prefix}/64 + EUI-64 from its MAC = ${address}; gateway ${packet.src}` });
}

// ================================================================== probes

function startPing(sim: SimApi, probe: Probe): Probe {
  const device = sim.topology.devices[probe.sourceDeviceId];
  if (!device || !CATALOG[device.kind].l3) return sim.finishProbe(probe, 'unreachable', 'the source cannot send IP packets');
  const dst = normalizeIPv6(probe.destination)!;
  probe.destination = dst;
  if (ownsAddress(sim, device, dst)) return sim.finishProbe(probe, 'success', 'loopback: it never leaves the device', 0);
  sim.logEvent({ deviceId: device.id, kind: 'info', text: `${device.hostname}: ping ${dst}` });
  const err = send(sim, device, { kind: 'ipv6', src: '', dst, hopLimit: probe.ttl, l4: { proto: 'icmpv6', type: 'echo-request', id: probe.id, seq: probe.seq } });
  if (err) sim.finishProbe(probe, 'unreachable', err);
  return probe;
}

function describe6(p: Ipv6Packet): string {
  const m = p.l4;
  const names: Record<Icmpv6Type, string> = {
    'echo-request': 'ICMPv6 echo request',
    'echo-reply': 'ICMPv6 echo reply',
    'time-exceeded': 'ICMPv6 time exceeded',
    unreachable: 'ICMPv6 destination unreachable',
    ns: `NDP neighbor solicitation: who has ${m.target}?`,
    na: `NDP neighbor advertisement: ${m.target} is at ${m.mac}`,
    rs: 'NDP router solicitation',
    ra: 'NDP router advertisement',
  };
  return `${names[m.type]} ${p.src} → ${p.dst}${m.type.startsWith('echo') || m.type === 'time-exceeded' ? ` (hop limit ${p.hopLimit})` : ''}`;
}

// ================================================================== plugin

export const ipv6Plugin: EnginePlugin = {
  name: 'ipv6',
  description: 'IPv6: link-local + global addresses, NDP instead of ARP, SLAAC, ICMPv6 ping, static routes',
  bootOrder: 3,

  boot(sim) {
    for (const host of Object.values(sim.topology.devices)) {
      if (!isHostKind(host.kind)) continue;
      for (const iface of sim.interfacesOf(host)) {
        if (!iface.ipv6Auto || !iface.linkId) continue;
        sim.logEvent({ deviceId: host.id, kind: 'info', control: true, text: `${host.hostname} SLAAC: asks for a prefix with a router solicitation` });
        const rs: Ipv6Packet = { kind: 'ipv6', src: linkLocalOf(iface), dst: ALL_ROUTERS, hopLimit: 255, l4: { proto: 'icmpv6', type: 'rs', mac: iface.mac } };
        frameOut(sim, iface, multicastMacV6(ALL_ROUTERS), rs, 'to all routers on the link');
      }
    }
  },

  acceptsMac(sim, device, iface, mac) {
    if (!mac.startsWith('33:33:')) return false;
    if (!ipv6Enabled(sim, iface)) return false;
    if (mac === multicastMacV6(ALL_NODES)) return true;
    if (mac === multicastMacV6(ALL_ROUTERS)) return device.kind === 'router';
    const mine = [linkLocalOf(iface), globalOf(sim, iface)?.address].filter((x): x is string => !!x);
    return mine.some((a) => multicastMacV6(solicitedNode(a)) === mac);
  },

  handleFrame(sim, device, iface, frame) {
    if (!isIpv6(frame.payload)) return false;
    receive(sim, device, iface, frame, frame.payload);
    return true;
  },

  onIdle(sim) {
    const s = state(sim);
    const failed = s.pending;
    s.pending = [];
    for (const p of failed) {
      const device = sim.topology.devices[p.deviceId];
      sim.logEvent({ deviceId: device.id, kind: 'failure', text: `${device.hostname}: no neighbor advertisement from ${p.nextHop}; packet dropped` });
      if (p.forwarded) error6(sim, device, sim.topology.interfaces[p.forwarded], p.packet, 'unreachable');
      else if (p.packet.l4.id !== undefined) {
        const probe = sim.findProbe(p.packet.l4.id);
        if (probe && probe.sourceDeviceId === device.id) sim.finishProbe(probe, 'unreachable', `no NDP answer from ${p.nextHop}`);
      }
    }
  },

  startProbe(sim, request) {
    if (request.kind !== 'ping' || !isValidIPv6(request.destination)) return undefined;
    return startPing(sim, sim.newProbe(request));
  },

  describe(p) {
    return isIpv6(p) ? describe6(p) : undefined;
  },

  tag(p) {
    if (!isIpv6(p)) return undefined;
    const t = p.l4.type;
    if (t === 'echo-request' || t === 'echo-reply') return 'icmp';
    if (t === 'time-exceeded' || t === 'unreachable') return 'icmp-error';
    return 'ndp';
  },
};
