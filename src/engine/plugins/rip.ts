// RIP version 2 (RFC 2453): a DISTANCE-VECTOR routing protocol.
//
// Each router tells its neighbours "here are the networks I can reach and
// how many hops away they are". A neighbour adds those to its table if they
// are new or shorter, and tells ITS neighbours. Nobody sees the whole map;
// knowledge spreads one hop per exchange ("routing by rumour").
//
//   metric  = hop count. 16 means unreachable, so RIP networks max out at 15 hops.
//   split horizon: never advertise a route back out of the interface you
//                  learned it from (prevents the simplest two-router loop).
//
// Updates go to 224.0.0.9 on UDP port 520. Real RIP repeats them every 30 s;
// here a router sends an update at boot and again only when its table changes
// (a "triggered update"), which converges to the same table.
// Cisco shows a network one router away as [120/1]: advertisements carry the
// sender's metric + 1.

import { connectedRoutes, AD, type Route } from '../routing';
import { isUdp, type Ipv4Packet, type UdpDatagram } from '../packets';
import type { Device, Interface } from '../../model/types';
import type { EnginePlugin, SimApi } from '../plugin';
import { multicastMacV4 } from '../simulation';
import { enabledInterfaces, sendMulticast } from './routingCommon';

export const RIP_GROUP = '224.0.0.9';
export const RIP_PORT = 520;
export const RIP_INFINITY = 16;

export interface RipEntry {
  network: string;
  prefixLength: number;
  metric: number;
}

export interface RipMessage {
  app: 'rip';
  command: 'response';
  entries: RipEntry[];
}

const isRip = (d: { app: string }): d is RipMessage => d.app === 'rip';

interface LearnedRoute extends RipEntry {
  nextHop: string;
  interfaceId: string;
}

type RipState = Record<string, Record<string, LearnedRoute>>;
const ripState = (sim: SimApi) => sim.state<RipState>('rip', () => ({}));
const key = (network: string, len: number) => `${network}/${len}`;

function ripInterfaces(sim: SimApi, router: Device): Interface[] {
  return router.rip ? enabledInterfaces(sim, router, router.rip.networks) : [];
}

/** What this router tells the neighbours on `out` (split horizon applied). */
function advertisement(sim: SimApi, router: Device, out: Interface): RipEntry[] {
  const ripIfs = ripInterfaces(sim, router);
  const entries: RipEntry[] = [];
  for (const c of connectedRoutes(sim.topology, router.id)) {
    if (c.interfaceId === out.id) continue; // they're on that network already
    if (!ripIfs.some((i) => i.id === c.interfaceId)) continue; // not enabled by a network statement
    entries.push({ network: c.network, prefixLength: c.prefixLength, metric: 1 });
  }
  for (const r of Object.values(ripState(sim)[router.id] ?? {})) {
    if (r.interfaceId === out.id) continue; // split horizon
    entries.push({ network: r.network, prefixLength: r.prefixLength, metric: Math.min(RIP_INFINITY, r.metric + 1) });
  }
  return entries;
}

function sendUpdates(sim: SimApi, router: Device, why: string) {
  const ifs = ripInterfaces(sim, router);
  if (ifs.length) sim.logEvent({ deviceId: router.id, kind: 'info', control: true, text: `${router.hostname} RIP: ${why}; sends updates out ${ifs.map((i) => i.name).join(', ')}` });
  for (const iface of ifs) {
    const msg: RipMessage = { app: 'rip', command: 'response', entries: advertisement(sim, router, iface) };
    const l4: UdpDatagram = { proto: 'udp', srcPort: RIP_PORT, dstPort: RIP_PORT, data: msg };
    sendMulticast(sim, iface, RIP_GROUP, l4);
  }
}

function receive(sim: SimApi, router: Device, iface: Interface, packet: Ipv4Packet, msg: RipMessage) {
  if (!ripInterfaces(sim, router).some((i) => i.id === iface.id)) {
    sim.logEvent({ deviceId: router.id, kind: 'drop', control: true, text: `${router.hostname} ignores a RIP update on ${iface.name} (RIP is not enabled there)` });
    return;
  }
  const table = (ripState(sim)[router.id] ??= {});
  const connected = new Set(connectedRoutes(sim.topology, router.id).map((c) => key(c.network, c.prefixLength)));
  const changes: string[] = [];
  for (const e of msg.entries) {
    const k = key(e.network, e.prefixLength);
    if (connected.has(k)) continue;
    const cur = table[k];
    const metric = Math.min(RIP_INFINITY, e.metric);
    if (metric >= RIP_INFINITY) {
      if (cur && cur.nextHop === packet.src) {
        delete table[k];
        changes.push(`${k} is now unreachable`);
      }
      continue;
    }
    if (!cur || (cur.nextHop === packet.src && cur.metric !== metric) || metric < cur.metric) {
      table[k] = { network: e.network, prefixLength: e.prefixLength, metric, nextHop: packet.src, interfaceId: iface.id };
      changes.push(`${k} via ${packet.src} (${metric} hop${metric === 1 ? '' : 's'})`);
    }
  }
  sim.logEvent({ deviceId: router.id, kind: 'receive', control: true, text: `${router.hostname} receives a RIP update from ${packet.src} with ${msg.entries.length} route(s)` });
  if (changes.length) {
    for (const c of changes) sim.logEvent({ deviceId: router.id, kind: 'learn', control: true, text: `${router.hostname} RIP learns ${c}` });
    sendUpdates(sim, router, 'table changed (triggered update)');
  }
}

export const ripPlugin: EnginePlugin = {
  name: 'rip',
  description: 'RIPv2: distance-vector routing by hop count, with split horizon',
  bootOrder: 2,

  boot(sim) {
    for (const r of Object.values(sim.topology.devices)) if (r.kind === 'router' && r.rip) sendUpdates(sim, r, 'starting');
  },

  acceptsMac(sim, device, iface, mac) {
    return device.kind === 'router' && !!device.rip && mac === multicastMacV4(RIP_GROUP) && ripInterfaces(sim, device).some((i) => i.id === iface.id);
  },

  deliverIpv4(sim, device, iface, packet) {
    if (!isUdp(packet.l4) || packet.l4.dstPort !== RIP_PORT || !isRip(packet.l4.data)) return false;
    if (device.kind === 'router' && device.rip) receive(sim, device, iface, packet, packet.l4.data);
    return true;
  },

  routes(sim, deviceId): Route[] {
    return Object.values(ripState(sim)[deviceId] ?? {}).map((r) => ({
      source: 'rip',
      code: 'R',
      ad: AD.rip,
      metric: r.metric,
      network: r.network,
      prefixLength: r.prefixLength,
      interfaceId: r.interfaceId,
      nextHop: r.nextHop,
    }));
  },

  describeL4(l4) {
    return isUdp(l4) && isRip(l4.data) ? `RIPv2 update (${l4.data.entries.length} routes)` : undefined;
  },

  tag(p) {
    const l4 = (p as Ipv4Packet).l4;
    return p.kind === 'ipv4' && l4 && isUdp(l4) && isRip(l4.data) ? 'rip' : undefined;
  },
};
