// OSPF (RFC 2328), single area: a LINK-STATE routing protocol.
//
// Where RIP passes rumours ("I can reach X in 3 hops"), OSPF routers build
// the SAME MAP of the whole network and each computes its own shortest paths:
//
//   1. HELLO on every OSPF interface (to 224.0.0.5). A hello lists the
//      neighbours already seen. Seeing your own router ID in a neighbour's
//      hello means two-way communication: the adjacency becomes FULL.
//      Hellos must agree on area and subnet mask, or no adjacency forms.
//   2. Each router describes its links in a ROUTER-LSA: "I'm 1.1.1.1, I have
//      a link to 2.2.2.2 with cost 64, and stub network 10.1.0.0/24 cost 1".
//      LSAs are FLOODED to every router, unchanged. Everyone ends up with
//      the same LINK-STATE DATABASE (LSDB).
//   3. Each router runs DIJKSTRA (SPF) on the LSDB, rooted at itself.
//
// Cost = reference bandwidth (100 Mbps) / interface bandwidth: Fast and
// Gigabit Ethernet = 1, a 1.544 Mbps serial link = 64. 'ip ospf cost' overrides.
//
// Simplifications: one area (area numbers must match, no ABRs), no DR/BDR
// election (every pair on a LAN becomes adjacent), no timers or ageing.

import { formatIPv4, parseIPv4 } from '../../model/ip';
import type { Device, Interface } from '../../model/types';
import type { Ipv4Packet, L4 } from '../packets';
import type { EnginePlugin, SimApi } from '../plugin';
import { AD, connectedRoutes, type Route } from '../routing';
import { multicastMacV4 } from '../simulation';
import { sendMulticast } from './routingCommon';
import { inSubnet, networkOf } from '../../model/ip';

export const OSPF_GROUP = '224.0.0.5';

export type LsaLink = { kind: 'router'; neighbor: string; cost: number } | { kind: 'stub'; network: string; prefixLength: number; cost: number };

export interface RouterLsa {
  origin: string; // router ID
  seq: number;
  links: LsaLink[];
}

export interface OspfHello extends L4 {
  proto: 'ospf';
  type: 'hello';
  routerId: string;
  area: number;
  prefixLength: number;
  neighbors: string[];
}

export interface OspfLsu extends L4 {
  proto: 'ospf';
  type: 'lsu';
  routerId: string;
  lsas: RouterLsa[];
}

type OspfMessage = OspfHello | OspfLsu;
const isOspf = (l4: L4): l4 is OspfMessage => l4.proto === 'ospf';

export interface Neighbor {
  routerId: string;
  ip: string;
  interfaceId: string;
  state: 'init' | 'full';
}

export interface RouterOspf {
  routerId: string;
  /** interface id -> neighbour router ID -> neighbour */
  neighbors: Record<string, Record<string, Neighbor>>;
  lsdb: Record<string, RouterLsa>;
  seq: number;
  routes: Route[];
}

type OspfState = Record<string, RouterOspf>;
const ospfState = (sim: SimApi) => sim.state<OspfState>('ospf', () => ({}));

export function defaultCost(iface: Interface): number {
  return iface.ospfCost ?? (iface.portType === 'serial' ? 64 : 1);
}

/** Configured router-id, else the highest IPv4 address on an up interface (as IOS does without loopbacks). */
export function routerIdOf(sim: SimApi, router: Device): string {
  if (router.ospf?.routerId) return router.ospf.routerId;
  const ips = sim
    .interfacesOf(router)
    .filter((i) => sim.isUp(i))
    .map((i) => sim.ipv4Of(i)?.address)
    .filter((x): x is string => !!x)
    .sort((a, b) => (parseIPv4(b) ?? 0) - (parseIPv4(a) ?? 0));
  return ips[0] ?? '0.0.0.0';
}

/** OSPF interfaces and their areas, chosen by network statements (first match wins). */
function ospfInterfaces(sim: SimApi, router: Device): { iface: Interface; area: number }[] {
  if (!router.ospf) return [];
  const out: { iface: Interface; area: number }[] = [];
  for (const iface of sim.interfacesOf(router)) {
    const ip = sim.ipv4Of(iface);
    if (!ip || !sim.isUp(iface)) continue;
    const n = router.ospf.networks.find((n) => inSubnet(ip.address, n.prefix, n.prefixLength));
    if (n) out.push({ iface, area: n.area });
  }
  return out;
}

export function ospfOf(sim: SimApi, router: Device): RouterOspf {
  const all = ospfState(sim);
  return (all[router.id] ??= { routerId: routerIdOf(sim, router), neighbors: {}, lsdb: {}, seq: 0, routes: [] });
}

function sendHello(sim: SimApi, router: Device, iface: Interface, area: number) {
  const s = ospfOf(sim, router);
  const hello: OspfHello = {
    proto: 'ospf',
    type: 'hello',
    routerId: s.routerId,
    area,
    prefixLength: sim.ipv4Of(iface)!.prefixLength,
    neighbors: Object.keys(s.neighbors[iface.id] ?? {}),
  };
  sendMulticast(sim, iface, OSPF_GROUP, hello);
}

function originateLsa(sim: SimApi, router: Device): RouterLsa {
  const s = ospfOf(sim, router);
  const links: LsaLink[] = [];
  for (const { iface } of ospfInterfaces(sim, router)) {
    const ip = sim.ipv4Of(iface)!;
    const cost = defaultCost(iface);
    links.push({ kind: 'stub', network: formatIPv4(networkOf(ip.address, ip.prefixLength)), prefixLength: ip.prefixLength, cost });
    for (const n of Object.values(s.neighbors[iface.id] ?? {})) if (n.state === 'full') links.push({ kind: 'router', neighbor: n.routerId, cost });
  }
  const lsa: RouterLsa = { origin: s.routerId, seq: ++s.seq, links };
  s.lsdb[s.routerId] = lsa;
  return lsa;
}

/** Flood LSAs out of every OSPF interface that has a full neighbour (except `except`). */
function flood(sim: SimApi, router: Device, lsas: RouterLsa[], except?: string) {
  const s = ospfOf(sim, router);
  for (const { iface } of ospfInterfaces(sim, router)) {
    if (iface.id === except) continue;
    if (!Object.values(s.neighbors[iface.id] ?? {}).some((n) => n.state === 'full')) continue;
    sendLsu(sim, router, iface, lsas);
  }
}

function sendLsu(sim: SimApi, router: Device, iface: Interface, lsas: RouterLsa[]) {
  const lsu: OspfLsu = { proto: 'ospf', type: 'lsu', routerId: ospfOf(sim, router).routerId, lsas: lsas.map((l) => ({ ...l, links: [...l.links] })) };
  sendMulticast(sim, iface, OSPF_GROUP, lsu);
}

/** Dijkstra over the LSDB, rooted at this router. */
export function runSpf(sim: SimApi, router: Device) {
  const s = ospfOf(sim, router);
  const me = s.routerId;
  const dist = new Map<string, number>([[me, 0]]);
  const firstHop = new Map<string, string>(); // router ID -> neighbour of `me` the path starts with
  const done = new Set<string>();
  const twoWay = (u: string, v: string) => s.lsdb[v]?.links.some((l) => l.kind === 'router' && l.neighbor === u);

  while (true) {
    let u: string | undefined;
    for (const [node, d] of dist) if (!done.has(node) && (u === undefined || d < dist.get(u)!)) u = node;
    if (u === undefined) break;
    done.add(u);
    for (const link of s.lsdb[u]?.links ?? []) {
      if (link.kind !== 'router' || !twoWay(u, link.neighbor)) continue;
      const nd = dist.get(u)! + link.cost;
      if (!dist.has(link.neighbor) || nd < dist.get(link.neighbor)!) {
        dist.set(link.neighbor, nd);
        firstHop.set(link.neighbor, u === me ? link.neighbor : firstHop.get(u)!);
      }
    }
  }

  const connected = new Set(connectedRoutes(sim.topology, router.id).map((c) => `${c.network}/${c.prefixLength}`));
  const best = new Map<string, Route>();
  for (const [rid, d] of dist) {
    if (rid === me) continue;
    const hop = firstHop.get(rid)!;
    const neighbor = Object.values(s.neighbors)
      .flatMap((m) => Object.values(m))
      .find((n) => n.routerId === hop && n.state === 'full');
    if (!neighbor) continue;
    for (const link of s.lsdb[rid]?.links ?? []) {
      if (link.kind !== 'stub') continue;
      const k = `${link.network}/${link.prefixLength}`;
      if (connected.has(k)) continue;
      const cost = d + link.cost;
      const cur = best.get(k);
      if (!cur || cost < cur.metric) {
        best.set(k, { source: 'ospf', code: 'O', ad: AD.ospf, metric: cost, network: link.network, prefixLength: link.prefixLength, interfaceId: neighbor.interfaceId, nextHop: neighbor.ip });
      }
    }
  }
  s.routes = [...best.values()];
}

function onHello(sim: SimApi, router: Device, iface: Interface, packet: Ipv4Packet, hello: OspfHello) {
  const s = ospfOf(sim, router);
  const mine = ospfInterfaces(sim, router).find((x) => x.iface.id === iface.id);
  if (!mine) return;
  const myIp = sim.ipv4Of(iface)!;
  if (hello.area !== mine.area) {
    sim.logEvent({ deviceId: router.id, kind: 'drop', control: true, text: `${router.hostname} OSPF area mismatch: hello from ${hello.routerId} is for area ${hello.area}, but ${iface.name} is in area ${mine.area}. No adjacency` });
    return;
  }
  if (hello.prefixLength !== myIp.prefixLength) {
    sim.logEvent({ deviceId: router.id, kind: 'drop', control: true, text: `${router.hostname} OSPF: subnet mask mismatch with ${hello.routerId} on ${iface.name} (/${hello.prefixLength} vs /${myIp.prefixLength}). No adjacency` });
    return;
  }
  if (hello.routerId === s.routerId) {
    sim.logEvent({ deviceId: router.id, kind: 'failure', control: true, text: `${router.hostname} OSPF: another router uses my router ID ${s.routerId}. Router IDs must be unique` });
    return;
  }
  const table = (s.neighbors[iface.id] ??= {});
  let n = table[hello.routerId];
  let changed = false;
  if (!n) {
    n = table[hello.routerId] = { routerId: hello.routerId, ip: packet.src, interfaceId: iface.id, state: 'init' };
    sim.logEvent({ deviceId: router.id, kind: 'learn', control: true, text: `${router.hostname} OSPF: new neighbour ${hello.routerId} (${packet.src}) on ${iface.name}, state INIT` });
    changed = true;
  }
  if (n.state !== 'full' && hello.neighbors.includes(s.routerId)) {
    n.state = 'full';
    changed = true;
    sim.logEvent({ deviceId: router.id, kind: 'success', control: true, text: `${router.hostname} OSPF: adjacency with ${hello.routerId} is FULL (it lists me in its hello)` });
    // Database exchange: give the new neighbour everything we know...
    sendLsu(sim, router, iface, Object.values(s.lsdb));
    // ...and tell everyone about our new link.
    flood(sim, router, [originateLsa(sim, router)]);
    runSpf(sim, router);
  }
  if (changed) sendHello(sim, router, iface, mine.area); // let them see us too
}

function onLsu(sim: SimApi, router: Device, iface: Interface, lsu: OspfLsu) {
  const s = ospfOf(sim, router);
  if (!s.neighbors[iface.id]?.[lsu.routerId]) return; // only from neighbours
  const fresh: RouterLsa[] = [];
  for (const lsa of lsu.lsas) {
    if (lsa.origin === s.routerId) continue;
    const cur = s.lsdb[lsa.origin];
    if (!cur || lsa.seq > cur.seq) {
      s.lsdb[lsa.origin] = lsa;
      fresh.push(lsa);
    }
  }
  if (!fresh.length) return;
  sim.logEvent({ deviceId: router.id, kind: 'learn', control: true, text: `${router.hostname} OSPF: installs ${fresh.length} new LSA(s) from ${fresh.map((l) => l.origin).join(', ')}, floods them on, reruns SPF` });
  flood(sim, router, fresh, iface.id);
  runSpf(sim, router);
}

export const ospfPlugin: EnginePlugin = {
  name: 'ospf',
  description: 'OSPF: link-state routing; routers flood LSAs and run Dijkstra',
  bootOrder: 2,

  boot(sim) {
    for (const router of Object.values(sim.topology.devices)) {
      if (router.kind !== 'router' || !router.ospf) continue;
      const s = ospfOf(sim, router);
      originateLsa(sim, router);
      const ifs = ospfInterfaces(sim, router);
      sim.logEvent({ deviceId: router.id, kind: 'info', control: true, text: `${router.hostname} OSPF: router ID ${s.routerId}; hellos out ${ifs.map((x) => x.iface.name).join(', ') || 'no interfaces'}` });
      for (const { iface, area } of ifs) sendHello(sim, router, iface, area);
    }
  },

  acceptsMac(sim, device, iface, mac) {
    return device.kind === 'router' && !!device.ospf && mac === multicastMacV4(OSPF_GROUP) && ospfInterfaces(sim, device).some((x) => x.iface.id === iface.id);
  },

  deliverIpv4(sim, device, iface, packet) {
    if (!isOspf(packet.l4)) return false;
    if (device.kind !== 'router' || !device.ospf) return true;
    if (packet.l4.type === 'hello') onHello(sim, device, iface, packet, packet.l4);
    else onLsu(sim, device, iface, packet.l4);
    return true;
  },

  routes(sim, deviceId) {
    return ospfState(sim)[deviceId]?.routes ?? [];
  },

  describeL4(l4) {
    if (!isOspf(l4)) return undefined;
    if (l4.type === 'hello') return `OSPF Hello (router ID ${l4.routerId}, area ${l4.area}, sees: ${l4.neighbors.join(', ') || 'nobody yet'})`;
    return `OSPF LS Update (${l4.lsas.map((l) => `${l.origin}#${l.seq}`).join(', ')})`;
  },

  tag(p) {
    const l4 = (p as Ipv4Packet).l4;
    return p.kind === 'ipv4' && l4 && isOspf(l4) ? 'ospf' : undefined;
  },
};
