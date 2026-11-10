// TCP connection test: the first two steps of the three-way handshake.
//
//   client → SYN       "may I connect to port 80?"
//   server → SYN-ACK   "yes, something listens there"   → the port is OPEN
//   server → RST       "nothing listens there"           → connection REFUSED
//
// This is what 'telnet 10.0.0.5 80' or a browser does first. It exists here
// so extended ACLs ('deny tcp any host X eq 80') and PAT can be tested with
// real ports. No data is sent after the handshake.

import { CATALOG } from '../../model/catalog';
import { isValidIPv4 } from '../../model/ip';
import type { Device } from '../../model/types';
import { isTcp, type Ipv4Packet, type TcpSegment } from '../packets';
import type { EnginePlugin, Probe, SimApi } from '../plugin';

/** Well-known services each kind of device listens on. */
export const LISTENING: Partial<Record<Device['kind'], number[]>> = {
  server: [21, 22, 23, 25, 53, 80, 443],
  router: [22, 23],
};

export const EPHEMERAL_BASE = 49152;

interface ProbeSegment extends TcpSegment {
  /** Which probe this segment belongs to (stands in for TCP sequence numbers). */
  probeId: number;
}

function start(sim: SimApi, probe: Probe): Probe {
  const device = sim.topology.devices[probe.sourceDeviceId];
  if (!device || !CATALOG[device.kind].l3) return sim.finishProbe(probe, 'unreachable', 'the source cannot send IP packets');
  const port = probe.port!;
  sim.logEvent({ deviceId: device.id, kind: 'info', text: `${device.hostname}: connect to ${probe.destination} port ${port} (TCP SYN)` });
  const syn: ProbeSegment = { proto: 'tcp', srcPort: EPHEMERAL_BASE + probe.id, dstPort: port, flags: 'syn', probeId: probe.id };
  const err = sim.sendIpv4(device, { kind: 'ipv4', src: '', dst: probe.destination, ttl: probe.ttl, l4: syn });
  if (err) sim.finishProbe(probe, 'unreachable', err);
  return probe;
}

function onSegment(sim: SimApi, device: Device, packet: Ipv4Packet, seg: ProbeSegment) {
  if (seg.flags === 'syn') {
    const open = (LISTENING[device.kind] ?? []).includes(seg.dstPort);
    sim.logEvent({ deviceId: device.id, kind: 'receive', text: `${device.hostname} receives TCP SYN for port ${seg.dstPort}: ${open ? 'a service listens, answers SYN-ACK' : 'nothing listens, answers RST'}` });
    const reply: ProbeSegment = { ...seg, srcPort: seg.dstPort, dstPort: seg.srcPort, flags: open ? 'syn-ack' : 'rst' };
    sim.sendIpv4(device, { kind: 'ipv4', src: packet.dst, dst: packet.src, ttl: 64, l4: reply });
    return;
  }
  const probe = sim.findProbe(seg.probeId);
  if (!probe) return;
  const rtt = sim.tick - probe.sentAt;
  if (seg.flags === 'syn-ack') sim.finishProbe(probe, 'success', `port ${probe.port} is open on ${packet.src}`, rtt, packet.src);
  else sim.finishProbe(probe, 'refused', `${packet.src} refused port ${probe.port} (nothing listening)`, rtt, packet.src);
}

export const tcpPlugin: EnginePlugin = {
  name: 'tcp',
  description: 'TCP connection test (SYN / SYN-ACK / RST) for checking ports through ACLs and NAT',

  startProbe(sim, request) {
    if (request.kind !== 'tcp' || !isValidIPv4(request.destination)) return undefined;
    return start(sim, sim.newProbe(request));
  },

  deliverIpv4(sim, device, _iface, packet) {
    if (!isTcp(packet.l4)) return false;
    const seg = packet.l4 as ProbeSegment;
    if (typeof seg.probeId !== 'number') return true;
    onSegment(sim, device, packet, seg);
    return true;
  },

  describeL4(l4) {
    return isTcp(l4) ? `TCP ${l4.flags.toUpperCase()} :${l4.srcPort} → :${l4.dstPort}` : undefined;
  },

  tag(p) {
    const l4 = (p as Ipv4Packet).l4;
    return p.kind === 'ipv4' && l4 && isTcp(l4) ? 'tcp' : undefined;
  },
};
