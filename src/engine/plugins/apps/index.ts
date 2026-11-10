// The application layer: DNS, HTTP, SMTP, POP3, FTP and Messaging.
//
// One exchange = one Probe, so everything the engine already does for pings
// and TCP tests works here for free: an ACL that blocks port 80 sends back
// "administratively prohibited" and the exchange fails with that reason; a
// missing route or an unanswered ARP fails it as unreachable; a packet lost on
// the way fails it when the wire goes quiet.
//
//   client                                   server
//   SYN ───────────────────────────────────►  something listening on the port?
//       ◄─────────────────────────────── SYN-ACK  (or RST: connection refused)
//   PSH-ACK + request ─────────────────────►  serve()
//       ◄───────────────────── PSH-ACK + response
//   FIN ───────────────────────────────────►
//       ◄─────────────────────────────── FIN-ACK   → exchange complete
//
// DNS is UDP: query → answer, or ICMP port unreachable if no DNS service runs.
//
// This plugin must come BEFORE tcpPlugin in the plugin list: tcpPlugin
// claims every TCP segment it sees.

import { CATALOG } from '../../../model/catalog';
import { isValidIPv4 } from '../../../model/ip';
import { PORTS } from '../../../model/services';
import type { Device } from '../../../model/types';
import type { Ipv4Packet } from '../../packets';
import type { EnginePlugin, Probe, SimApi } from '../../plugin';
import { EPHEMERAL_BASE } from '../tcp';
import { createDisk, type Disk } from './disk';
import {
  APP_LABEL,
  describeRequest,
  describeResponse,
  isAppSegment,
  isDnsDatagram,
  type AppFlags,
  type AppName,
  type AppRequest,
  type AppResponse,
  type AppSegment,
  type DnsDatagram,
} from './messages';
import { serve, tcpListener, udpListener } from './services';

export const APPS = 'apps';

interface Exchange {
  request: AppRequest;
  response?: AppResponse;
}

interface AppsState {
  disk: Disk;
  exchanges: Record<number, Exchange>;
}

const appsState = (sim: SimApi) => sim.state<AppsState>(APPS, () => ({ disk: createDisk(), exchanges: {} }));

/** Give the simulation the disk the services read and write (the workspace keeps one per session). */
export function attachDisk(sim: SimApi, disk: Disk): void {
  appsState(sim).disk = disk;
}

export function diskOfSim(sim: SimApi): Disk {
  return appsState(sim).disk;
}

/** The response an exchange got, once its probe has finished with success. */
export function responseOf(sim: SimApi, probeId: number): AppResponse | undefined {
  return appsState(sim).exchanges[probeId]?.response;
}

const PORT_OF: Record<AppName, number> = { dns: PORTS.dns, http: PORTS.http, smtp: PORTS.smtp, pop3: PORTS.pop3, ftp: PORTS.ftp, chat: PORTS.chat };

/**
 * Start one request from a client to a server IP. Returns the probe: watch
 * its status, and read the answer with responseOf() once it is 'success'.
 */
export function startExchange(sim: SimApi, clientId: string, serverIp: string, request: AppRequest): Probe {
  const port = PORT_OF[request.app];
  const probe = sim.newProbe({ kind: 'tcp', sourceDeviceId: clientId, destination: serverIp, port });
  const device = sim.topology.devices[clientId];
  if (!device || !CATALOG[device.kind].l3) return sim.finishProbe(probe, 'unreachable', 'this device cannot send IP packets');
  if (!isValidIPv4(serverIp)) return sim.finishProbe(probe, 'unreachable', `'${serverIp}' is not an IPv4 address`);
  appsState(sim).exchanges[probe.id] = { request };
  const srcPort = EPHEMERAL_BASE + (probe.id % 16000);

  let l4: AppSegment | DnsDatagram;
  if (request.app === 'dns') {
    l4 = { proto: 'udp', srcPort, dstPort: port, probeId: probe.id, data: { app: 'dns', request } };
    sim.logEvent({ deviceId: clientId, kind: 'info', text: `${device.hostname}: ${describeRequest(request)} (UDP to ${serverIp}:53)` });
  } else {
    l4 = { proto: 'tcp', srcPort, dstPort: port, flags: 'syn', probeId: probe.id, app: request.app, dir: 'c2s' };
    sim.logEvent({ deviceId: clientId, kind: 'info', text: `${device.hostname}: open a TCP connection to ${serverIp}:${port} for ${APP_LABEL[request.app]}` });
  }
  const err = sim.sendIpv4(device, { kind: 'ipv4', src: '', dst: serverIp, ttl: probe.ttl, l4 });
  if (err) sim.finishProbe(probe, 'unreachable', err);
  return probe;
}

// ------------------------------------------------------------- the wire

function reply(sim: SimApi, device: Device, packet: Ipv4Packet, seg: AppSegment, flags: AppFlags, extra: Partial<AppSegment> = {}) {
  const out: AppSegment = { ...seg, srcPort: seg.dstPort, dstPort: seg.srcPort, flags, dir: seg.dir === 'c2s' ? 's2c' : 'c2s', request: undefined, response: undefined, ...extra };
  sim.sendIpv4(device, { kind: 'ipv4', src: packet.dst, dst: packet.src, ttl: 64, l4: out });
}

function onServer(sim: SimApi, device: Device, packet: Ipv4Packet, seg: AppSegment) {
  switch (seg.flags) {
    case 'syn': {
      const app = tcpListener(device, seg.dstPort);
      sim.logEvent({ deviceId: device.id, kind: 'receive', text: `${device.hostname} receives SYN for port ${seg.dstPort}: ${app ? `${APP_LABEL[app]} listens, answers SYN-ACK` : 'nothing listens, answers RST'}` });
      reply(sim, device, packet, seg, app ? 'syn-ack' : 'rst');
      return;
    }
    case 'psh-ack': {
      if (!seg.request || tcpListener(device, seg.dstPort) !== seg.request.app) return reply(sim, device, packet, seg, 'rst');
      const response = serve({ device, disk: appsState(sim).disk, clientIp: packet.src, tick: sim.tick }, seg.request);
      sim.logEvent({ deviceId: device.id, kind: 'receive', text: `${device.hostname} (${APP_LABEL[seg.request.app]}) got "${describeRequest(seg.request)}", answers "${describeResponse(response)}"` });
      reply(sim, device, packet, seg, 'psh-ack', { response });
      return;
    }
    case 'fin':
      reply(sim, device, packet, seg, 'fin-ack');
      return;
  }
}

function onClient(sim: SimApi, device: Device, packet: Ipv4Packet, seg: AppSegment) {
  const probe = sim.findProbe(seg.probeId);
  const exchange = appsState(sim).exchanges[seg.probeId];
  if (!probe || !exchange || probe.sourceDeviceId !== device.id) return;
  const rtt = sim.tick - probe.sentAt;
  switch (seg.flags) {
    case 'syn-ack':
      // Handshake done: send the request (the ACK rides on it).
      reply(sim, device, packet, seg, 'psh-ack', { request: exchange.request });
      return;
    case 'rst':
      sim.finishProbe(probe, 'refused', `${packet.src} refused port ${seg.srcPort}: no ${APP_LABEL[seg.app]} service is running there`, rtt, packet.src);
      return;
    case 'psh-ack':
      exchange.response = seg.response;
      reply(sim, device, packet, seg, 'fin');
      return;
    case 'fin-ack':
      sim.finishProbe(probe, 'success', exchange.response ? describeResponse(exchange.response) : 'connection closed', rtt, packet.src);
      return;
  }
}

function onDns(sim: SimApi, device: Device, iface: Parameters<NonNullable<EnginePlugin['deliverIpv4']>>[2], packet: Ipv4Packet, dg: DnsDatagram) {
  if (dg.data.request) {
    if (!udpListener(device, dg.dstPort)) {
      sim.logEvent({ deviceId: device.id, kind: 'drop', text: `${device.hostname} has no DNS service: answers ICMP port unreachable` });
      sim.icmpError(device, iface, packet, { type: 'unreachable', code: 'port' });
      return;
    }
    const response = serve({ device, disk: appsState(sim).disk, clientIp: packet.src, tick: sim.tick }, dg.data.request);
    sim.logEvent({ deviceId: device.id, kind: 'receive', text: `${device.hostname} (DNS) ${describeResponse(response)}` });
    const out: DnsDatagram = { ...dg, srcPort: dg.dstPort, dstPort: dg.srcPort, data: { app: 'dns', response: response as AppResponse & { app: 'dns' } } };
    sim.sendIpv4(device, { kind: 'ipv4', src: packet.dst, dst: packet.src, ttl: 64, l4: out });
    return;
  }
  const probe = sim.findProbe(dg.probeId);
  const exchange = appsState(sim).exchanges[dg.probeId];
  if (!probe || !exchange || probe.sourceDeviceId !== device.id || !dg.data.response) return;
  exchange.response = dg.data.response;
  sim.finishProbe(probe, 'success', describeResponse(dg.data.response), sim.tick - probe.sentAt, packet.src);
}

export const appsPlugin: EnginePlugin = {
  name: APPS,
  description: 'Application services: DNS, HTTP, SMTP, POP3, FTP and messaging between computers',

  deliverIpv4(sim, device, iface, packet) {
    const l4 = packet.l4;
    if (isDnsDatagram(l4)) {
      onDns(sim, device, iface, packet, l4);
      return true;
    }
    if (!isAppSegment(l4)) return false;
    if (l4.dir === 'c2s') onServer(sim, device, packet, l4);
    else onClient(sim, device, packet, l4);
    return true;
  },

  describeL4(l4) {
    if (isDnsDatagram(l4)) {
      const d = l4.data;
      return `UDP :${l4.srcPort} → :${l4.dstPort} ${d.request ? describeRequest(d.request) : d.response ? describeResponse(d.response) : 'DNS'}`;
    }
    if (!isAppSegment(l4)) return undefined;
    const what = l4.request ? describeRequest(l4.request) : l4.response ? describeResponse(l4.response) : APP_LABEL[l4.app];
    return `TCP ${l4.flags.toUpperCase()} :${l4.srcPort} → :${l4.dstPort} · ${what}`;
  },

  tag(p) {
    const l4 = (p as Ipv4Packet).l4;
    if (p.kind !== 'ipv4' || !l4) return undefined;
    if (isDnsDatagram(l4)) return 'app';
    if (!isAppSegment(l4)) return undefined;
    return l4.request || l4.response ? 'app' : 'tcp';
  },
};
