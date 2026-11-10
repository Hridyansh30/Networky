// Network Address Translation (inside → outside).
//
// Private addresses (10/8, 172.16/12, 192.168/16) can't be routed on the
// internet, so the border router REWRITES them:
//
//   static:   'ip nat inside source static 10.0.0.5 203.0.113.5'
//             one inside host always appears as one public address, both ways.
//   PAT:      'ip nat inside source list 1 interface Gi0/1 overload'
//             MANY inside hosts share the outside interface's ONE address;
//             the router tells them apart by rewriting the PORT (for ICMP,
//             the echo id plays the port's role).
//
// The four names Cisco uses:
//   inside local   = the host's real private address   (10.0.0.5)
//   inside global  = what the outside world sees        (203.0.113.5)
//   outside global = the remote host's address          (8.8.8.8)
//
// Order of operations (like IOS): inside→outside packets are routed first,
// then translated; outside→inside packets are translated first, then routed.
// Simplification: ICMP errors are matched by echo id, not by the quoted header.

import { evaluateAcl } from '../../model/acl';
import type { Device, Interface } from '../../model/types';
import { flowPorts, isIcmp, isTcp, isUdp, type Ipv4Packet, type L4 } from '../packets';
import type { EnginePlugin, SimApi } from '../plugin';

export interface Translation {
  kind: 'static' | 'pat';
  protocol: string;
  insideLocal: string;
  insideGlobal: string;
  localPort?: number;
  globalPort?: number;
  outside?: string;
  hits: number;
}

interface NatState {
  /** router id -> translations */
  table: Record<string, Translation[]>;
  nextPort: Record<string, number>;
}

const natState = (sim: SimApi) => sim.state<NatState>('nat', () => ({ table: {}, nextPort: {} }));

export function translationsOf(sim: SimApi, routerId: string): Translation[] {
  return natState(sim).table[routerId] ?? [];
}

/** Copy an L4 header with new port values (ICMP: the echo id). */
function withPorts(l4: L4, ports: { src?: number; dst?: number }): L4 {
  if (isUdp(l4) || isTcp(l4)) {
    const out: typeof l4 = { ...l4, srcPort: ports.src ?? l4.srcPort, dstPort: ports.dst ?? l4.dstPort };
    return out;
  }
  if (isIcmp(l4)) {
    const out: typeof l4 = { ...l4, id: ports.src ?? ports.dst ?? l4.id };
    return out;
  }
  return l4;
}

function outsideAddress(sim: SimApi, router: Device): string | undefined {
  const id = router.nat?.overload?.outsideInterfaceId;
  return id ? sim.ipv4Of(sim.topology.interfaces[id])?.address : undefined;
}

function translateOutbound(sim: SimApi, router: Device, egress: Interface, packet: Ipv4Packet): Ipv4Packet {
  const nat = router.nat!;
  const table = (natState(sim).table[router.id] ??= []);

  const st = nat.statics.find((s) => s.local === packet.src);
  if (st) {
    let entry = table.find((t) => t.kind === 'static' && t.insideLocal === st.local);
    if (!entry) table.push((entry = { kind: 'static', protocol: '---', insideLocal: st.local, insideGlobal: st.global, hits: 0 }));
    entry.hits++;
    sim.logEvent({ deviceId: router.id, kind: 'info', text: `${router.hostname} NAT (static): source ${packet.src} → ${st.global}` });
    return { ...packet, src: st.global };
  }

  const ov = nat.overload;
  if (!ov || ov.outsideInterfaceId !== egress.id) return packet;
  const acl = router.acls?.[ov.acl];
  if (!acl || !evaluateAcl(acl, { protocol: packet.l4.proto, src: packet.src, dst: packet.dst }).permit) return packet;
  const global = outsideAddress(sim, router);
  const localPort = flowPorts(packet.l4).src;
  if (!global || localPort === undefined) return packet;

  let entry = table.find((t) => t.kind === 'pat' && t.protocol === packet.l4.proto && t.insideLocal === packet.src && t.localPort === localPort);
  if (!entry) {
    // Keep the original port if no one else uses it (IOS does the same), else pick a free one.
    const used = new Set(table.filter((t) => t.kind === 'pat' && t.protocol === packet.l4.proto).map((t) => t.globalPort));
    let port = localPort;
    if (used.has(port)) {
      const s = natState(sim);
      port = s.nextPort[router.id] ??= 1024;
      while (used.has(port)) port++;
      s.nextPort[router.id] = port + 1;
    }
    entry = { kind: 'pat', protocol: packet.l4.proto, insideLocal: packet.src, localPort, insideGlobal: global, globalPort: port, outside: packet.dst, hits: 0 };
    table.push(entry);
  }
  entry.hits++;
  sim.logEvent({
    deviceId: router.id,
    kind: 'info',
    text: `${router.hostname} NAT (PAT overload): ${packet.src}:${localPort} → ${global}:${entry.globalPort}`,
  });
  return { ...packet, src: global, l4: withPorts(packet.l4, { src: entry.globalPort }) };
}

function translateInbound(sim: SimApi, router: Device, packet: Ipv4Packet): Ipv4Packet {
  const nat = router.nat!;
  const st = nat.statics.find((s) => s.global === packet.dst);
  if (st) {
    sim.logEvent({ deviceId: router.id, kind: 'info', text: `${router.hostname} NAT (static): destination ${packet.dst} → ${st.local}` });
    return { ...packet, dst: st.local };
  }
  const table = natState(sim).table[router.id] ?? [];
  // Replies come back to the global port: TCP/UDP in dstPort, ICMP in the echo id.
  const port = isIcmp(packet.l4) ? packet.l4.id : flowPorts(packet.l4).dst;
  const entry = table.find((t) => t.kind === 'pat' && t.insideGlobal === packet.dst && t.protocol === packet.l4.proto && t.globalPort === port);
  if (!entry) return packet;
  entry.hits++;
  sim.logEvent({ deviceId: router.id, kind: 'info', text: `${router.hostname} NAT (PAT): ${packet.dst}:${port} → ${entry.insideLocal}:${entry.localPort}` });
  return { ...packet, dst: entry.insideLocal, l4: withPorts(packet.l4, isIcmp(packet.l4) ? { src: entry.localPort } : { dst: entry.localPort }) };
}

export const natPlugin: EnginePlugin = {
  name: 'nat',
  description: 'NAT: static one-to-one translation and PAT (many inside hosts behind one address)',

  // outside → inside: translate before routing (after the inbound ACL)
  ingressPriority: 20,
  ipv4Ingress(sim, router, iface, packet) {
    if (!router.nat || iface.nat !== 'outside') return { action: 'pass', packet };
    return { action: 'pass', packet: translateInbound(sim, router, packet) };
  },

  // inside → outside: translate after routing (before the outbound ACL)
  egressPriority: 10,
  ipv4Egress(sim, router, ctx, packet) {
    if (!router.nat || ctx.egress.nat !== 'outside' || ctx.ingress?.nat !== 'inside') return { action: 'pass', packet };
    return { action: 'pass', packet: translateOutbound(sim, router, ctx.egress, packet) };
  },

  // A static global address isn't configured on any interface, so the router
  // must answer ARP for it on the outside, or nobody could reach it.
  answersArp(_sim, router, iface, ip) {
    return iface.nat === 'outside' && !!router.nat?.statics.some((s) => s.global === ip);
  },
};
