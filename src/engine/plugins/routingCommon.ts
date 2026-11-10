// Small helpers shared by the dynamic routing plugins (RIP, OSPF).

import { inSubnet } from '../../model/ip';
import type { Device, Interface, RoutingNetwork } from '../../model/types';
import { multicastMacV4 } from '../simulation';
import type { Ipv4Packet, L4 } from '../packets';
import type { SimApi } from '../plugin';

/** Interfaces selected by 'network' statements: up, addressed, and inside one of the networks. */
export function enabledInterfaces(sim: SimApi, router: Device, networks: RoutingNetwork[]): Interface[] {
  return sim.interfacesOf(router).filter((i) => {
    const ip = sim.ipv4Of(i);
    return ip && sim.isUp(i) && networks.some((n) => inSubnet(ip.address, n.prefix, n.prefixLength));
  });
}

/** Send a routing protocol message to a link-local multicast group (TTL 1: it never crosses a router). */
export function sendMulticast(sim: SimApi, iface: Interface, group: string, l4: L4) {
  const src = sim.ipv4Of(iface)?.address;
  if (!src) return;
  const packet: Ipv4Packet = { kind: 'ipv4', src, dst: group, ttl: 1, l4 };
  sim.sendIpv4Direct(iface, packet, multicastMacV4(group), { control: true });
}
