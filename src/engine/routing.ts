// Routing tables.
//
// A router builds its table (the RIB) from several SOURCES. The core supplies
// two of them:
//   - CONNECTED: one route per interface that is up/up and has an IP
//   - STATIC:    every configured route whose next hop is reachable through
//                a connected route (otherwise the router can't use it)
// Plugins add more (RIP, OSPF) through the `routes` hook.
//
// When two sources know the same prefix, the lower ADMINISTRATIVE DISTANCE
// wins (connected 0 < static 1 < OSPF 110 < RIP 120), then the lower metric.
// Forwarding then picks the LONGEST matching prefix.

import { formatIPv4, inSubnet, networkOf } from '../model/ip';
import { peerInterfaceId } from '../model/ops';
import type { Topology } from '../model/types';

export interface Route {
  /** Who installed it: 'connected', 'static', 'rip', 'ospf'... */
  source: string;
  /** One-letter code shown in 'show ip route': C, S, R, O */
  code: string;
  /** Administrative distance: how much the router trusts this source. Lower wins. */
  ad: number;
  /** Cost within the source: hops for RIP, summed cost for OSPF. */
  metric: number;
  network: string;
  prefixLength: number;
  interfaceId: string;
  nextHop?: string;
}

export const AD = { connected: 0, static: 1, ospf: 110, rip: 120 } as const;

/** up/up: admin up, cable plugged in, and the far end is admin up too. Subinterfaces follow their parent. */
export function interfaceIsUp(t: Topology, interfaceId: string): boolean {
  const i = t.interfaces[interfaceId];
  if (!i?.adminUp) return false;
  if (i.parentId) return interfaceIsUp(t, i.parentId);
  if (!i.linkId) return false;
  const peer = peerInterfaceId(t, interfaceId);
  return !!peer && t.interfaces[peer].adminUp;
}

export function connectedRoutes(t: Topology, deviceId: string): Route[] {
  const device = t.devices[deviceId];
  if (!device) return [];
  const routes: Route[] = [];
  for (const id of device.interfaceIds) {
    const i = t.interfaces[id];
    if (!i.ipv4 || !interfaceIsUp(t, id)) continue;
    routes.push({
      source: 'connected',
      code: 'C',
      ad: AD.connected,
      metric: 0,
      network: formatIPv4(networkOf(i.ipv4.address, i.ipv4.prefixLength)),
      prefixLength: i.ipv4.prefixLength,
      interfaceId: id,
    });
  }
  return routes;
}

/** Connected + static routes: everything the configuration alone produces. */
export function routingTable(t: Topology, deviceId: string): Route[] {
  const connected = connectedRoutes(t, deviceId);
  const statics: Route[] = [];
  for (const r of t.devices[deviceId]?.staticRoutes ?? []) {
    const via = longestMatch(connected, r.nextHop);
    if (!via) continue; // next hop not reachable: configured, but not installed
    statics.push({
      source: 'static',
      code: 'S',
      ad: AD.static,
      metric: 0,
      network: r.prefix,
      prefixLength: r.prefixLength,
      interfaceId: via.interfaceId,
      nextHop: r.nextHop,
    });
  }
  return selectBest([...connected, ...statics]);
}

/** Per prefix, keep the most trusted route (lowest AD, then lowest metric). */
export function selectBest(routes: Route[]): Route[] {
  const best = new Map<string, Route>();
  for (const r of routes) {
    const key = `${r.network}/${r.prefixLength}`;
    const cur = best.get(key);
    if (!cur || r.ad < cur.ad || (r.ad === cur.ad && r.metric < cur.metric)) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => b.prefixLength - a.prefixLength || a.network.localeCompare(b.network));
}

export function longestMatch(routes: Route[], dst: string): Route | undefined {
  let best: Route | undefined;
  for (const r of routes) {
    if (inSubnet(dst, r.network, r.prefixLength) && (!best || r.prefixLength > best.prefixLength)) best = r;
  }
  return best;
}
