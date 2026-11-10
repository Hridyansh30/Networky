// DHCP (RFC 2131): how a PC gets an IP address without anyone typing one.
//
// Four messages, "DORA", all UDP (client port 68, server port 67):
//   DISCOVER  client → broadcast   "Is there a DHCP server?"
//   OFFER     server → client      "You can have 192.168.10.11"
//   REQUEST   client → broadcast   "I'll take 192.168.10.11" (broadcast, so other servers know)
//   ACK       server → client      "It's yours. Gateway 192.168.10.1, mask /24"
//
// Routers don't forward broadcasts, so a server on another subnet needs a
// RELAY: 'ip helper-address' on the router turns the broadcast into a unicast
// to the server and stamps it with GIADDR (the relay interface's address).
// The server picks the pool by GIADDR and answers the relay, which
// broadcasts the answer back onto the client's LAN.
//
// Simplifications: no lease timers, renewals or DECLINE/NAK; offers and
// ACKs are broadcast (the client's "broadcast flag", as Packet Tracer does).

import { isHostKind } from '../../model/catalog';
import { formatIPv4, inSubnet, networkOf, prefixToMaskNum } from '../../model/ip';
import type { Device, DhcpPool, Interface, Ipv4Config } from '../../model/types';
import { BROADCAST_MAC, IPV4_BROADCAST, isUdp, type Ipv4Packet, type UdpDatagram } from '../packets';
import type { EnginePlugin, SimApi } from '../plugin';

export const DHCP_SERVER_PORT = 67;
export const DHCP_CLIENT_PORT = 68;

export interface DhcpMessage {
  app: 'dhcp';
  op: 'discover' | 'offer' | 'request' | 'ack';
  xid: number;
  chaddr: string; // client MAC
  yiaddr?: string; // "your" address
  prefixLength?: number;
  router?: string;
  dns?: string;
  serverId?: string;
  giaddr?: string; // relay agent address
}

export const isDhcp = (d: { app: string }): d is DhcpMessage => d.app === 'dhcp';

export interface Lease {
  ip: string;
  prefixLength: number;
  router?: string;
  dns?: string;
  server: string;
}

export interface Binding {
  ip: string;
  mac: string;
  pool: string;
  state: 'offered' | 'bound';
}

interface DhcpState {
  /** client interface id -> lease (the address the client is using) */
  leases: Record<string, Lease>;
  /** server device id -> bindings */
  bindings: Record<string, Binding[]>;
  /** client interface id -> xid of the exchange in progress */
  pending: Record<string, number>;
}

const state = (sim: SimApi) => sim.state<DhcpState>('dhcp', () => ({ leases: {}, bindings: {}, pending: {} }));

export function leasesOf(sim: SimApi): Record<string, Lease> {
  return state(sim).leases;
}

export function bindingsOf(sim: SimApi, deviceId: string): Binding[] {
  return state(sim).bindings[deviceId] ?? [];
}

function udp(srcPort: number, dstPort: number, data: DhcpMessage): UdpDatagram {
  return { proto: 'udp', srcPort, dstPort, data };
}

function broadcast(sim: SimApi, iface: Interface, src: string, msg: DhcpMessage, srcPort: number, dstPort: number, note: string) {
  const packet: Ipv4Packet = { kind: 'ipv4', src, dst: IPV4_BROADCAST, ttl: 64, l4: udp(srcPort, dstPort, msg) };
  sim.sendIpv4Direct(iface, packet, BROADCAST_MAC, { control: true, note });
}

// ------------------------------------------------------------------ client

function startClient(sim: SimApi, device: Device, iface: Interface) {
  const xid = (parseInt(iface.mac.replace(/:/g, '').slice(-6), 16) ^ sim.tick) >>> 0;
  state(sim).pending[iface.id] = xid;
  sim.logEvent({ deviceId: device.id, kind: 'info', control: true, text: `${device.hostname}: no address yet; asks for one with DHCP` });
  broadcast(sim, iface, '0.0.0.0', { app: 'dhcp', op: 'discover', xid, chaddr: iface.mac }, DHCP_CLIENT_PORT, DHCP_SERVER_PORT, 'DHCP DISCOVER to everyone');
}

function clientReceive(sim: SimApi, device: Device, iface: Interface, msg: DhcpMessage) {
  const s = state(sim);
  if (msg.chaddr !== iface.mac || s.pending[iface.id] !== msg.xid) return; // not my exchange
  if (msg.op === 'offer') {
    sim.logEvent({ deviceId: device.id, kind: 'receive', control: true, text: `${device.hostname} is offered ${msg.yiaddr}/${msg.prefixLength} by ${msg.serverId}` });
    broadcast(
      sim,
      iface,
      '0.0.0.0',
      { app: 'dhcp', op: 'request', xid: msg.xid, chaddr: iface.mac, yiaddr: msg.yiaddr, serverId: msg.serverId },
      DHCP_CLIENT_PORT,
      DHCP_SERVER_PORT,
      'DHCP REQUEST, broadcast so every server hears the choice',
    );
  } else if (msg.op === 'ack' && msg.yiaddr && msg.prefixLength !== undefined) {
    s.leases[iface.id] = { ip: msg.yiaddr, prefixLength: msg.prefixLength, router: msg.router, dns: msg.dns, server: msg.serverId ?? '?' };
    delete s.pending[iface.id];
    sim.logEvent({
      deviceId: device.id,
      kind: 'success',
      control: true,
      text: `${device.hostname} is now ${msg.yiaddr}/${msg.prefixLength}${msg.router ? `, gateway ${msg.router}` : ''}${msg.dns ? `, DNS ${msg.dns}` : ''} (DHCP)`,
    });
  }
}

// ------------------------------------------------------------------ server

function serverAddress(sim: SimApi, iface: Interface): string | undefined {
  return sim.ipv4Of(iface)?.address;
}

/** The first free address in a pool, skipping excluded ones, the router and the server's own addresses. */
function allocate(sim: SimApi, server: Device, pool: DhcpPool, mac: string): string | undefined {
  const s = state(sim);
  const bindings = (s.bindings[server.id] ??= []);
  const existing = bindings.find((b) => b.mac === mac && b.pool === pool.name);
  if (existing) return existing.ip;
  const taken = new Set<string>([
    ...bindings.map((b) => b.ip),
    ...(pool.excluded ?? []),
    ...(pool.defaultRouter ? [pool.defaultRouter] : []),
    ...Object.values(sim.topology.interfaces).flatMap((i) => (i.ipv4 ? [i.ipv4.address] : [])),
  ]);
  const net = networkOf(pool.network, pool.prefixLength);
  const size = (~prefixToMaskNum(pool.prefixLength) >>> 0) + 1;
  for (let host = 1; host < size - 1; host++) {
    const ip = formatIPv4((net + host) >>> 0);
    if (!taken.has(ip)) return ip;
  }
  return undefined;
}

function poolFor(server: Device, addr: string): DhcpPool | undefined {
  return server.dhcpPools?.find((p) => inSubnet(addr, p.network, p.prefixLength));
}

function serverReceive(sim: SimApi, server: Device, iface: Interface, packet: Ipv4Packet, msg: DhcpMessage) {
  const own = serverAddress(sim, iface);
  if (!own || !server.dhcpPools?.length) return false;
  const selector = msg.giaddr ?? own; // relayed: choose by the relay's subnet
  const pool = poolFor(server, selector);
  if (!pool) {
    sim.logEvent({ deviceId: server.id, kind: 'drop', control: true, text: `${server.hostname}: no DHCP pool for subnet of ${selector}` });
    return true;
  }
  const s = state(sim);
  const bindings = (s.bindings[server.id] ??= []);
  if (msg.op === 'discover') {
    const ip = allocate(sim, server, pool, msg.chaddr);
    if (!ip) {
      sim.logEvent({ deviceId: server.id, kind: 'failure', control: true, text: `${server.hostname}: pool ${pool.name} is exhausted` });
      return true;
    }
    if (!bindings.some((b) => b.ip === ip)) bindings.push({ ip, mac: msg.chaddr, pool: pool.name, state: 'offered' });
    sim.logEvent({ deviceId: server.id, kind: 'info', control: true, text: `${server.hostname}: pool ${pool.name} offers ${ip} to ${msg.chaddr}` });
    reply(sim, server, iface, packet, { ...msg, op: 'offer', yiaddr: ip, prefixLength: pool.prefixLength, router: pool.defaultRouter, dns: pool.dnsServer, serverId: own });
  } else if (msg.op === 'request') {
    if (msg.serverId && msg.serverId !== own) {
      // The client chose another server: release what we offered.
      s.bindings[server.id] = bindings.filter((b) => !(b.mac === msg.chaddr && b.state === 'offered'));
      return true;
    }
    const b = bindings.find((x) => x.mac === msg.chaddr && x.ip === msg.yiaddr);
    if (!b) return true;
    b.state = 'bound';
    reply(sim, server, iface, packet, { ...msg, op: 'ack', prefixLength: pool.prefixLength, router: pool.defaultRouter, dns: pool.dnsServer, serverId: own });
  }
  return true;
}

/** Answer on the client's LAN (broadcast), or back to the relay agent (unicast to GIADDR). */
function reply(sim: SimApi, server: Device, iface: Interface, request: Ipv4Packet, msg: DhcpMessage) {
  const own = serverAddress(sim, iface)!;
  if (msg.giaddr) {
    const packet: Ipv4Packet = { kind: 'ipv4', src: own, dst: msg.giaddr, ttl: 64, l4: udp(DHCP_SERVER_PORT, DHCP_SERVER_PORT, msg) };
    const err = sim.sendIpv4(server, packet);
    if (err) sim.logEvent({ deviceId: server.id, kind: 'failure', control: true, text: `${server.hostname}: cannot reach relay ${msg.giaddr}: ${err}` });
  } else {
    void request;
    broadcast(sim, iface, own, msg, DHCP_SERVER_PORT, DHCP_CLIENT_PORT, `DHCP ${msg.op.toUpperCase()}`);
  }
}

// ------------------------------------------------------------------- relay

function relayReceive(sim: SimApi, router: Device, iface: Interface, packet: Ipv4Packet, msg: DhcpMessage): boolean {
  const own = sim.ipv4Of(iface)?.address;
  // From a client, on an interface with a helper address: forward to the server.
  if (iface.helperAddress && own && packet.dst === IPV4_BROADCAST && (msg.op === 'discover' || msg.op === 'request')) {
    sim.logEvent({ deviceId: router.id, kind: 'info', control: true, text: `${router.hostname} relays DHCP ${msg.op.toUpperCase()} to ${iface.helperAddress} (ip helper-address), GIADDR ${own}` });
    const relayed: Ipv4Packet = { kind: 'ipv4', src: own, dst: iface.helperAddress, ttl: 64, l4: udp(DHCP_SERVER_PORT, DHCP_SERVER_PORT, { ...msg, giaddr: own }) };
    const err = sim.sendIpv4(router, relayed);
    if (err) sim.logEvent({ deviceId: router.id, kind: 'failure', control: true, text: `${router.hostname}: relay failed: ${err}` });
    return true;
  }
  // From the server, addressed to us as GIADDR: broadcast on the client's LAN.
  if (msg.giaddr && (msg.op === 'offer' || msg.op === 'ack')) {
    const clientSide = sim.interfacesOf(router).find((i) => sim.ipv4Of(i)?.address === msg.giaddr);
    if (!clientSide) return false;
    sim.logEvent({ deviceId: router.id, kind: 'info', control: true, text: `${router.hostname} relays DHCP ${msg.op.toUpperCase()} back onto ${clientSide.name}` });
    broadcast(sim, clientSide, msg.giaddr, msg, DHCP_SERVER_PORT, DHCP_CLIENT_PORT, `relayed DHCP ${msg.op.toUpperCase()}`);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ plugin

export const dhcpPlugin: EnginePlugin = {
  name: 'dhcp',
  description: 'DHCP: servers hand out addresses from pools (DORA); routers relay with ip helper-address',
  bootOrder: 3,

  boot(sim) {
    for (const device of Object.values(sim.topology.devices)) {
      if (!isHostKind(device.kind)) continue;
      for (const iface of sim.interfacesOf(device)) if (iface.dhcp && iface.linkId) startClient(sim, device, iface);
    }
  },

  ipv4Of(sim, iface): Ipv4Config | null | undefined {
    if (!iface.dhcp) return undefined;
    const lease = state(sim).leases[iface.id];
    // null-ish: a DHCP client without a lease has NO address, not its static one.
    return lease ? { address: lease.ip, prefixLength: lease.prefixLength } : null;
  },

  gatewayOf(sim, device) {
    for (const id of device.interfaceIds) {
      const lease = state(sim).leases[id];
      if (lease?.router) return lease.router;
    }
    return undefined;
  },

  deliverIpv4(sim, device, iface, packet) {
    if (!isUdp(packet.l4) || !isDhcp(packet.l4.data)) return false;
    const msg = packet.l4.data;
    if (packet.l4.dstPort === DHCP_CLIENT_PORT) {
      if (isHostKind(device.kind)) clientReceive(sim, device, iface, msg);
      return true;
    }
    if (packet.l4.dstPort !== DHCP_SERVER_PORT) return false;
    if (device.kind === 'router' && relayReceive(sim, device, iface, packet, msg)) return true;
    if (device.dhcpPools?.length) return serverReceive(sim, device, iface, packet, msg);
    return true; // a DHCP broadcast reached a device that isn't a server: ignore quietly
  },

  describeL4(l4) {
    if (!isUdp(l4) || !isDhcp(l4.data)) return undefined;
    const m = l4.data;
    return `DHCP ${m.op.toUpperCase()}${m.yiaddr ? ` ${m.yiaddr}` : ''}`;
  },

  tag(p) {
    const l4 = (p as Ipv4Packet).l4;
    return p.kind === 'ipv4' && l4 && isUdp(l4) && isDhcp(l4.data) ? 'dhcp' : undefined;
  },
};
