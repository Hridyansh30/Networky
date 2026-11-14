// The engine core: a discrete-time network simulation.
//
//   tick N:  some frames are "on the wire" (inFlight)
//   step():  every in-flight frame arrives at the far end of its cable,
//            the receiving device processes it, and whatever it sends
//            becomes the in-flight set for tick N+1.
//
// One step = one hop across one cable, so you can stop between any two hops.
//
// The core knows: cables, hubs, VLAN-aware switches, NICs, ARP, IPv4, ICMP,
// connected + static routing. Everything else is a plugin (see plugin.ts).
//
// The engine reads the Topology (configuration) and keeps its own runtime
// state (ARP caches, MAC tables, plugin state). Configuration is what you
// typed; state is what the network learned.

import { CATALOG } from '../model/catalog';
import { formatIPv4, inSubnet, isValidIPv4, networkOf, prefixToMaskNum, parseIPv4 } from '../model/ip';
import { peerInterfaceId, switchportOf } from '../model/ops';
import type { Device, Interface, Ipv4Config, SwitchportConfig, Topology } from '../model/types';
import {
  BROADCAST_MAC,
  IPV4_BROADCAST,
  ZERO_MAC,
  isArp,
  isIcmp,
  isIpv4,
  type ArpMessage,
  type Frame,
  type IcmpMessage,
  type Ipv4Packet,
  type Payload,
  type Transmission,
  type UnreachableCode,
} from './packets';
import type { EgressContext, EnginePlugin, LogEntry, Probe, ProbeRequest, ProbeStatus, SimApi, Verdict } from './plugin';
import { longestMatch, routingTable, selectBest, interfaceIsUp, type Route } from './routing';

export type { LogEntry, LogKind, Probe, ProbeStatus } from './plugin';
/** @deprecated phase 2 name, kept for readability in tests */
export type PingRecord = Probe;
export type PingStatus = ProbeStatus;

export const DEFAULT_TTL = 64;
/**
 * Safety valves. Ethernet frames have no TTL, so with a switching loop and no
 * STP a broadcast circulates forever. Real networks melt down; we stop it and
 * explain why. They also bound the work a hostile topology file can cause.
 */
export const MAX_IN_FLIGHT = 400;
export const MAX_COPIES_PER_FRAME = 64;
export const MAX_LOG = 20_000;

/**
 * Work units: one per step plus one per frame delivered. A deterministic
 * measure of how much a run cost, unlike wall-clock time, which depends on
 * the machine. The grader sets a budget in these units (see grading/grade.ts).
 */
export type WorkBudget = number;

export interface ArpEntry {
  mac: string;
  interfaceId: string;
  learnedAt: number;
}

/** One frame crossing one cable, recorded when it arrives. */
export interface HopRecord {
  /** 1-based sequence number (the 'Event #' in the PDU details) */
  index: number;
  tick: number;
  frame: Frame;
  linkId: string;
  fromIf: string;
  toIf: string;
  fromDevice: string;
  toDevice: string;
  /** protocol tag, e.g. 'arp', 'icmp', 'ospf' (see tagOf) */
  tag: string;
  control: boolean;
}

export interface MacEntry {
  mac: string;
  vlan: number;
  interfaceId: string;
  learnedAt: number;
}

interface PendingArp {
  deviceId: string;
  interfaceId: string;
  nextHop: string;
  packet: Ipv4Packet;
  /** the interface a forwarded packet arrived on (for the ICMP error) */
  ingressId?: string;
}

export class Simulation implements SimApi {
  readonly topology: Topology;
  readonly plugins: readonly EnginePlugin[];
  tick = 0;
  inFlight: Transmission[] = [];
  log: LogEntry[] = [];
  /** Pings and connection tests, oldest first. */
  pings: Probe[] = [];
  /** per device: IP -> MAC (hosts and routers) */
  arp: Record<string, Record<string, ArpEntry>> = {};
  /** per switch: 'vlan|mac' -> port */
  mac: Record<string, Record<string, MacEntry>> = {};
  /**
   * Every frame that crossed a cable, in order: the rows of the event table
   * and the input of the PDU details view. Capped like the log.
   */
  hops: HopRecord[] = [];
  /** Work done so far: steps taken plus frames delivered. */
  work = 0;
  /** Stop stepping once `work` reaches this. Infinity (the default) means no limit. */
  workBudget: WorkBudget = Infinity;

  private pending: PendingArp[] = [];
  private bootQueue: number[] = [];
  private nextFrameId = 1;
  private nextTxId = 1;
  private nextProbeId = 1;
  private macToInterface = new Map<string, Interface>();
  private copies = new Map<number, number>();
  private stormFrames = new Set<number>();
  private pluginState = new Map<string, unknown>();
  private ingressHooks: EnginePlugin[];
  private egressHooks: EnginePlugin[];

  constructor(topology: Topology, plugins: readonly EnginePlugin[] = []) {
    this.topology = topology;
    this.plugins = plugins;
    for (const i of Object.values(topology.interfaces)) if (!i.parentId) this.macToInterface.set(i.mac, i);
    this.ingressHooks = plugins.filter((p) => p.ipv4Ingress).sort((a, b) => (a.ingressPriority ?? 50) - (b.ingressPriority ?? 50));
    this.egressHooks = plugins.filter((p) => p.ipv4Egress).sort((a, b) => (a.egressPriority ?? 50) - (b.egressPriority ?? 50));
  }

  // =================================================================== API

  /**
   * Start the control plane: STP, then routing protocols, then DHCP/SLAAC.
   * Each phase starts when the previous one has gone quiet.
   */
  boot(): this {
    this.bootQueue = [...new Set(this.plugins.filter((p) => p.boot).map((p) => p.bootOrder ?? 50))].sort((a, b) => a - b);
    this.startNextBootPhase();
    return this;
  }

  /** Is the control plane still starting up? */
  get booting(): boolean {
    return this.bootQueue.length > 0;
  }

  /** Ping from a device. Returns the probe record (watch its status). */
  ping(sourceDeviceId: string, destination: string, opts: { ttl?: number; seq?: number } = {}): Probe {
    return this.probe({ kind: 'ping', sourceDeviceId, destination, ...opts });
  }

  /** Start a ping or a TCP connection test. */
  probe(request: ProbeRequest): Probe {
    for (const p of this.plugins) {
      const probe = p.startProbe?.(this, request);
      if (probe) return probe;
    }
    const probe = this.newProbe(request);
    if (request.kind !== 'ping') return this.finishProbe(probe, 'unreachable', `no plugin handles '${request.kind}' probes`);
    if (!isValidIPv4(request.destination)) return this.finishProbe(probe, 'unreachable', `'${request.destination}' is not an address this network understands`);
    return this.startIcmpPing(probe);
  }

  /** Advance one hop. Returns the transmissions that were delivered. */
  step(): Transmission[] {
    const arriving = this.inFlight;
    this.inFlight = [];
    this.tick++;
    this.work += 1 + arriving.length;
    for (const tx of arriving) {
      this.recordHop(tx);
      this.receive(tx);
    }

    if (this.inFlight.length > MAX_IN_FLIGHT) {
      this.logEvent({ kind: 'failure', text: `${this.inFlight.length} frames on the wire at once: a broadcast storm. Dropping them all.` });
      this.inFlight = [];
    }
    if (this.inFlight.length === 0) this.settle();
    return arriving;
  }

  /** Step until nothing is on the wire and boot has finished (or a step limit). */
  run(maxSteps = 2000): this {
    for (let i = 0; i < maxSteps && !this.isIdle() && !this.overBudget; i++) this.step();
    return this;
  }

  /** True once the work budget is spent; run() then does nothing. */
  get overBudget(): boolean {
    return this.work >= this.workBudget;
  }

  isIdle(): boolean {
    return this.inFlight.length === 0 && this.bootQueue.length === 0;
  }

  /** Full routing table: connected + static + every plugin's routes, best per prefix. */
  routes(deviceId: string): Route[] {
    const base = routingTable(this.topology, deviceId);
    const extra = this.plugins.flatMap((p) => p.routes?.(this, deviceId) ?? []);
    return extra.length ? selectBest([...base, ...extra]) : base;
  }

  /** Who owns a MAC address (for the UI). */
  interfaceByMac(mac: string): Interface | undefined {
    return this.macToInterface.get(mac);
  }

  // ============================================================ SimApi

  logEvent(e: Omit<LogEntry, "tick">): void {
    if (this.log.length < MAX_LOG) this.log.push({ tick: this.tick, ...e });
  }

  state<T>(plugin: string, init: () => T): T {
    if (!this.pluginState.has(plugin)) this.pluginState.set(plugin, init());
    return this.pluginState.get(plugin) as T;
  }

  plugin<T extends EnginePlugin>(name: string): T | undefined {
    return this.plugins.find((p) => p.name === name) as T | undefined;
  }

  device(id: string): Device {
    const d = this.topology.devices[id];
    if (!d) throw new Error(`Device ${id} does not exist`);
    return d;
  }

  interfacesOf(device: Device): Interface[] {
    return device.interfaceIds.map((id) => this.topology.interfaces[id]);
  }

  isUp(iface: Interface): boolean {
    return interfaceIsUp(this.topology, iface.id);
  }

  makeFrame(srcMac: string, dstMac: string, payload: Payload, opts: { control?: boolean } = {}): Frame {
    const frame: Frame = { id: this.nextFrameId++, srcMac, dstMac, payload };
    if (opts.control) this.controlFrames.add(frame.id);
    return frame;
  }
  private controlFrames = new Set<number>();
  private recordHop(tx: Transmission) {
    if (this.hops.length >= MAX_LOG) return;
    const ifs = this.topology.interfaces;
    this.hops.push({
      index: this.hops.length + 1,
      tick: this.tick,
      frame: tx.frame,
      linkId: tx.linkId,
      fromIf: tx.fromIf,
      toIf: tx.toIf,
      fromDevice: ifs[tx.fromIf].deviceId,
      toDevice: ifs[tx.toIf].deviceId,
      tag: this.tagOf(tx.frame),
      control: this.controlFrames.has(tx.frame.id),
    });
  }

  isControl(frameId: number): boolean {
    return this.controlFrames.has(frameId);
  }

  ipv4Of(iface: Interface): Ipv4Config | undefined {
    for (const p of this.plugins) {
      const v = p.ipv4Of?.(this, iface);
      if (v !== undefined) return v ?? undefined;
    }
    return iface.ipv4;
  }

  gatewayOf(device: Device): string | undefined {
    for (const p of this.plugins) {
      const g = p.gatewayOf?.(this, device);
      if (g !== undefined) return g;
    }
    return device.defaultGateway;
  }

  newProbe(request: ProbeRequest): Probe {
    const probe: Probe = {
      id: this.nextProbeId++,
      kind: request.kind,
      seq: request.seq ?? 1,
      sourceDeviceId: request.sourceDeviceId,
      destination: request.destination,
      port: request.port,
      ttl: request.ttl ?? DEFAULT_TTL,
      sentAt: this.tick,
      status: 'pending',
    };
    this.pings.push(probe);
    return probe;
  }

  findProbe(id: number): Probe | undefined {
    return this.pings.find((p) => p.id === id && p.status === 'pending');
  }

  finishProbe(probe: Probe, status: ProbeStatus, detail: string, rttTicks?: number, respondent?: string): Probe {
    probe.status = status;
    probe.respondent = respondent;
    probe.detail = detail;
    probe.rttTicks = rttTicks;
    const src = this.topology.devices[probe.sourceDeviceId]?.hostname;
    const what = probe.kind === 'tcp' ? `connect to ${probe.destination}:${probe.port}` : `ping ${probe.destination}`;
    this.logEvent({
      deviceId: probe.sourceDeviceId,
      kind: status === 'success' ? 'success' : 'failure',
      text: `${src}: ${what} ${status === 'success' ? 'succeeded' : 'failed'}: ${detail}${rttTicks !== undefined ? ` (round trip: ${rttTicks} ticks)` : ''}`,
    });
    return probe;
  }

  // ============================================================ the wire (L1)

  transmit(from: Interface, frame: Frame, note?: string): void {
    const device = this.topology.devices[from.deviceId];
    const control = this.controlFrames.has(frame.id);
    // A subinterface sends through its physical port, adding its 802.1Q tag.
    let port = from;
    if (from.parentId) {
      port = this.topology.interfaces[from.parentId];
      frame = { ...frame, vlan: from.vlanTag };
    }
    if (!from.adminUp || !port.adminUp) {
      this.logEvent({ deviceId: device.id, kind: 'drop', frameId: frame.id, control, text: `${device.hostname} ${from.name} is shut down; frame not sent` });
      return;
    }
    if (!port.linkId) {
      this.logEvent({ deviceId: device.id, kind: 'drop', frameId: frame.id, control, text: `${device.hostname} ${port.name} has no cable; frame not sent` });
      return;
    }
    const copies = (this.copies.get(frame.id) ?? 0) + 1;
    this.copies.set(frame.id, copies);
    if (copies > MAX_COPIES_PER_FRAME) {
      if (!this.stormFrames.has(frame.id)) {
        this.stormFrames.add(frame.id);
        this.logEvent({
          kind: 'failure',
          frameId: frame.id,
          text: `Frame #${frame.id} has crossed ${MAX_COPIES_PER_FRAME} cables and is still going: a broadcast storm. There is a switching loop, and Ethernet frames have no TTL to stop them. Spanning Tree (STP) prevents this. Dropping it.`,
        });
      }
      return;
    }
    const toIf = peerInterfaceId(this.topology, port.id)!;
    this.inFlight.push({ id: this.nextTxId++, frame, linkId: port.linkId, fromIf: port.id, toIf });
    const tag = frame.vlan !== undefined ? ` [802.1Q VLAN ${frame.vlan}]` : '';
    this.logEvent({
      deviceId: device.id,
      kind: 'send',
      frameId: frame.id,
      control,
      text: `${device.hostname} ${port.name} sends ${this.describe(frame.payload)}${tag}${note ? ` (${note})` : ''}`,
    });
  }

  private receive(tx: Transmission) {
    const iface = this.topology.interfaces[tx.toIf];
    const device = this.topology.devices[iface.deviceId];
    if (!iface.adminUp) {
      this.logEvent({ deviceId: device.id, kind: 'drop', frameId: tx.frame.id, control: this.isControl(tx.frame.id), text: `${device.hostname} ${iface.name} is shut down; the frame is lost` });
      return;
    }
    if (device.kind === 'hub') return this.hubReceive(device, iface, tx.frame);
    if (device.kind === 'switch') return this.switchReceive(device, iface, tx.frame);
    return this.nicReceive(device, iface, tx.frame);
  }

  // ================================================================ hub (L1)

  /** A hub has no idea what a frame is. Bits in one port, bits out all the others. */
  private hubReceive(hub: Device, ingress: Interface, frame: Frame) {
    const out = this.otherLinkedPorts(hub, ingress);
    this.logEvent({ deviceId: hub.id, kind: 'info', frameId: frame.id, control: this.isControl(frame.id), text: `${hub.hostname} repeats the signal out of ${out.length} port(s)` });
    for (const port of out) this.transmit(port, { ...frame });
  }

  // ============================================================= switch (L2)

  private switchReceive(sw: Device, ingress: Interface, frame: Frame) {
    const control = this.isControl(frame.id);
    // Frames addressed to the switch itself (BPDUs) never get forwarded.
    if (isBridgeGroupMac(frame.dstMac)) {
      if (!this.plugins.some((p) => p.handleSwitchFrame?.(this, sw, ingress, frame))) {
        this.logEvent({ deviceId: sw.id, kind: 'drop', frameId: frame.id, control, text: `${sw.hostname} consumes a frame for ${frame.dstMac} (bridge group address)` });
      }
      return;
    }
    if (!this.portForwards(sw, ingress)) {
      this.logEvent({ deviceId: sw.id, kind: 'drop', frameId: frame.id, control, text: `${sw.hostname} ${ingress.name} is blocked by STP; the frame is discarded` });
      return;
    }

    // 1. Which VLAN is this frame in?
    const sp = switchportOf(ingress);
    let vlan: number;
    if (sp.mode === 'access') {
      if (frame.vlan !== undefined) {
        this.logEvent({ deviceId: sw.id, kind: 'drop', frameId: frame.id, control, text: `${sw.hostname} ${ingress.name} is an access port; it drops a frame tagged for VLAN ${frame.vlan}` });
        return;
      }
      vlan = sp.accessVlan;
    } else {
      vlan = frame.vlan ?? sp.nativeVlan;
      if (!trunkAllows(sp, vlan)) {
        this.logEvent({ deviceId: sw.id, kind: 'drop', frameId: frame.id, control, text: `${sw.hostname} trunk ${ingress.name} does not allow VLAN ${vlan}` });
        return;
      }
    }

    // 2. Learn: the SOURCE address tells us where that host lives (per VLAN).
    const table = (this.mac[sw.id] ??= {});
    const srcKey = `${vlan}|${frame.srcMac}`;
    const known = table[srcKey];
    if (!known || known.interfaceId !== ingress.id) {
      table[srcKey] = { mac: frame.srcMac, vlan, interfaceId: ingress.id, learnedAt: this.tick };
      this.logEvent({ deviceId: sw.id, kind: 'learn', frameId: frame.id, control, text: `${sw.hostname} learns ${frame.srcMac} is on ${ingress.name} (VLAN ${vlan})` });
    }

    // 3. Forward: the DESTINATION address decides where it goes, inside the same VLAN only.
    const dst = frame.dstMac === BROADCAST_MAC ? undefined : table[`${vlan}|${frame.dstMac}`];
    if (!dst) {
      const why = frame.dstMac === BROADCAST_MAC ? 'broadcast' : isMulticastMac(frame.dstMac) ? 'multicast' : `${frame.dstMac} is unknown`;
      const out = this.otherLinkedPorts(sw, ingress).filter((p) => carriesVlan(switchportOf(p), vlan) && this.portForwards(sw, p));
      this.logEvent({ deviceId: sw.id, kind: 'info', frameId: frame.id, control, text: `${sw.hostname} floods the frame (${why}) out of ${out.length} port(s) in VLAN ${vlan}` });
      for (const port of out) this.transmit(port, egressFrame(frame, switchportOf(port), vlan));
      return;
    }
    if (dst.interfaceId === ingress.id) {
      this.logEvent({ deviceId: sw.id, kind: 'drop', frameId: frame.id, control, text: `${sw.hostname} filters the frame: ${frame.dstMac} is on the port it came from` });
      return;
    }
    const out = this.topology.interfaces[dst.interfaceId];
    if (!this.portForwards(sw, out)) {
      this.logEvent({ deviceId: sw.id, kind: 'drop', frameId: frame.id, control, text: `${sw.hostname} ${out.name} is blocked by STP` });
      return;
    }
    this.transmit(out, egressFrame(frame, switchportOf(out), vlan), 'known MAC, forwarded out one port');
  }

  private portForwards(sw: Device, port: Interface): boolean {
    return this.plugins.every((p) => p.portForwards?.(this, sw, port) ?? true);
  }

  // ======================================== hosts and routers (L2 -> L3)

  private nicReceive(device: Device, physical: Interface, frame: Frame) {
    const control = this.isControl(frame.id);
    // 802.1Q: a router hands a tagged frame to the matching subinterface.
    let iface = physical;
    if (frame.vlan !== undefined) {
      const sub = device.interfaceIds.map((id) => this.topology.interfaces[id]).find((i) => i.parentId === physical.id && i.vlanTag === frame.vlan);
      if (!sub) {
        this.logEvent({ deviceId: device.id, kind: 'drop', frameId: frame.id, control, text: `${device.hostname} ${physical.name} drops a frame tagged VLAN ${frame.vlan}: no subinterface for it` });
        return;
      }
      if (!sub.adminUp) return;
      iface = sub;
    }
    // The NIC drops frames for other MACs. On a hub, every host sees every
    // frame; this check is the only reason they don't all answer.
    const accepted =
      frame.dstMac === physical.mac || frame.dstMac === BROADCAST_MAC || this.plugins.some((p) => p.acceptsMac?.(this, device, iface, frame.dstMac));
    if (!accepted) {
      this.logEvent({ deviceId: device.id, kind: 'drop', frameId: frame.id, control, text: `${device.hostname} ${physical.name} ignores a frame for ${frame.dstMac} (not its MAC)` });
      return;
    }
    const p = frame.payload;
    if (isArp(p)) return this.arpReceive(device, iface, p, frame.id);
    if (isIpv4(p)) return this.ipReceive(device, iface, p, frame.id);
    if (!this.plugins.some((pl) => pl.handleFrame?.(this, device, iface, frame))) {
      this.logEvent({ deviceId: device.id, kind: 'drop', frameId: frame.id, control, text: `${device.hostname} does not understand a ${p.kind} frame` });
    }
  }

  // ===================================================================== ARP

  private arpReceive(device: Device, iface: Interface, msg: ArpMessage, frameId: number) {
    const own = this.ipv4Of(iface)?.address;
    const mine = own === msg.targetIp || this.plugins.some((p) => p.answersArp?.(this, device, iface, msg.targetIp));
    if (!mine) {
      this.logEvent({ deviceId: device.id, kind: 'drop', frameId, text: `${device.hostname} ignores ARP for ${msg.targetIp} (not its address)` });
      return;
    }
    // Both a request and a reply tell us the sender's MAC. Cache it.
    if (msg.senderIp !== '0.0.0.0') this.learnArp(device, iface, msg.senderIp, msg.senderMac);
    if (msg.op === 'request') {
      const reply: ArpMessage = { kind: 'arp', op: 'reply', senderMac: iface.mac, senderIp: msg.targetIp, targetMac: msg.senderMac, targetIp: msg.senderIp };
      this.transmit(iface, this.makeFrame(iface.mac, msg.senderMac, reply), 'unicast reply, straight back');
    } else {
      this.flushPending(device, iface, msg.senderIp);
    }
  }

  private learnArp(device: Device, iface: Interface, ip: string, mac: string) {
    const table = (this.arp[device.id] ??= {});
    if (table[ip]?.mac === mac) return;
    table[ip] = { mac, interfaceId: iface.id, learnedAt: this.tick };
    this.logEvent({ deviceId: device.id, kind: 'learn', text: `${device.hostname} caches ARP ${ip} → ${mac}` });
  }

  // ==================================================================== IPv4

  private ipReceive(device: Device, iface: Interface, packet: Ipv4Packet, frameId: number) {
    const control = this.isControl(frameId);
    // Routers run inbound filters (ACL in, NAT outside->inside) before anything else.
    if (device.kind === 'router') {
      const v = this.runHooks(this.ingressHooks, packet, (p, pk) => p.ipv4Ingress!(this, device, iface, pk));
      if (v.action === 'drop') {
        this.logEvent({ deviceId: device.id, kind: 'drop', frameId, control, text: `${device.hostname} ${iface.name} (in): ${v.reason}` });
        if (v.icmp) this.icmpError(device, iface, packet, { type: 'unreachable', code: v.icmp });
        return;
      }
      packet = v.packet;
    }

    if (this.isLocal(device, iface, packet.dst)) return this.deliverLocal(device, iface, packet, frameId);
    if (device.kind !== 'router') {
      this.logEvent({ deviceId: device.id, kind: 'drop', frameId, control, text: `${device.hostname} drops a packet for ${packet.dst}: hosts don't forward` });
      return;
    }
    if (isMulticastIp(packet.dst) || this.isSubnetBroadcast(iface, packet.dst)) {
      this.logEvent({ deviceId: device.id, kind: 'drop', frameId, control, text: `${device.hostname} does not forward broadcasts or link-local multicasts` });
      return;
    }
    this.forward(device, iface, packet, frameId);
  }

  /** Addressed to this device: one of its IPs, a broadcast, or a multicast it joined. */
  private isLocal(device: Device, iface: Interface, dst: string): boolean {
    if (dst === IPV4_BROADCAST || this.isSubnetBroadcast(iface, dst) || isMulticastIp(dst)) return true;
    return this.interfacesOf(device).some((i) => this.ipv4Of(i)?.address === dst);
  }

  private isSubnetBroadcast(iface: Interface, dst: string): boolean {
    const ip = this.ipv4Of(iface);
    if (!ip || ip.prefixLength >= 31) return false;
    const bcast = (networkOf(ip.address, ip.prefixLength) | (~prefixToMaskNum(ip.prefixLength) >>> 0)) >>> 0;
    return parseIPv4(dst) === bcast;
  }

  private deliverLocal(device: Device, iface: Interface, packet: Ipv4Packet, frameId: number) {
    if (!isIcmp(packet.l4)) {
      if (!this.plugins.some((p) => p.deliverIpv4?.(this, device, iface, packet))) {
        this.logEvent({ deviceId: device.id, kind: 'drop', frameId, control: this.isControl(frameId), text: `${device.hostname} has nothing listening for ${packet.l4.proto} ${this.describeL4(packet)}` });
      }
      return;
    }
    const icmp = packet.l4;
    this.logEvent({ deviceId: device.id, kind: 'receive', frameId, text: `${device.hostname} receives ${this.describe(packet)}` });
    if (icmp.type === 'echo-request') {
      if (packet.dst === IPV4_BROADCAST || isMulticastIp(packet.dst)) return; // no broadcast pings
      const reply: Ipv4Packet = { kind: 'ipv4', src: packet.dst, dst: packet.src, ttl: DEFAULT_TTL, l4: { ...icmp, type: 'echo-reply' } as IcmpMessage };
      const err = this.sendIpv4(device, reply);
      if (err) this.logEvent({ deviceId: device.id, kind: 'drop', text: `${device.hostname} cannot reply: ${err}` });
      return;
    }
    const probe = this.findProbe(icmp.id);
    // Only the host that sent the probe can learn its fate. An ICMP error
    // about a dropped echo REPLY goes to the replying host, and must not
    // tell the original sender anything: that sender just times out.
    if (!probe || probe.seq !== icmp.seq || probe.sourceDeviceId !== device.id) return;
    const rtt = this.tick - probe.sentAt;
    if (icmp.type === 'echo-reply') this.finishProbe(probe, 'success', `reply from ${packet.src}`, rtt, packet.src);
    else if (icmp.type === 'time-exceeded') this.finishProbe(probe, 'ttl-exceeded', `TTL expired at ${packet.src}`, rtt, packet.src);
    else if (icmp.code === 'admin') this.finishProbe(probe, 'prohibited', `${packet.src} reports administratively prohibited (an ACL)`, rtt, packet.src);
    else this.finishProbe(probe, 'unreachable', `${packet.src} reports destination ${icmp.code ?? 'net'} unreachable`, rtt, packet.src);
  }

  private startIcmpPing(probe: Probe): Probe {
    const device = this.topology.devices[probe.sourceDeviceId];
    if (!device) return this.finishProbe(probe, 'unreachable', 'source device does not exist');
    if (!CATALOG[device.kind].l3) {
      return this.finishProbe(probe, 'unreachable', `${device.hostname} is a layer ${CATALOG[device.kind].layer} device and cannot send IP packets`);
    }
    if (this.interfacesOf(device).some((i) => this.ipv4Of(i)?.address === probe.destination)) {
      return this.finishProbe(probe, 'success', 'loopback: it never leaves the device', 0);
    }
    this.logEvent({ deviceId: device.id, kind: 'info', text: `${device.hostname}: ping ${probe.destination}${probe.ttl !== DEFAULT_TTL ? ` (TTL ${probe.ttl})` : ''}` });
    const packet: Ipv4Packet = {
      kind: 'ipv4',
      src: '', // filled from the egress interface once the route is known
      dst: probe.destination,
      ttl: probe.ttl,
      l4: { proto: 'icmp', type: 'echo-request', id: probe.id, seq: probe.seq } as IcmpMessage,
    };
    const err = this.sendIpv4(device, packet);
    if (err) this.finishProbe(probe, 'unreachable', err);
    return probe;
  }

  // ============================================================ routing (L3)

  private forward(router: Device, ingress: Interface, packet: Ipv4Packet, frameId: number) {
    // TTL stops packets from looping forever between misconfigured routers.
    if (packet.ttl <= 1) {
      this.logEvent({ deviceId: router.id, kind: 'drop', frameId, text: `${router.hostname}: TTL reached 0, packet dropped` });
      this.icmpError(router, ingress, packet, { type: 'time-exceeded' });
      return;
    }
    const route = longestMatch(this.routes(router.id), packet.dst);
    if (!route) {
      this.logEvent({ deviceId: router.id, kind: 'drop', frameId, text: `${router.hostname} has no route to ${packet.dst}` });
      this.icmpError(router, ingress, packet, { type: 'unreachable', code: 'net' });
      return;
    }
    const egress = this.topology.interfaces[route.interfaceId];
    this.logEvent({
      deviceId: router.id,
      kind: 'info',
      frameId,
      control: this.isControl(frameId),
      text: `${router.hostname} routes ${packet.dst} via ${route.network}/${route.prefixLength} (${route.source}) out ${egress.name}, TTL ${packet.ttl} → ${packet.ttl - 1}`,
    });
    this.egressAndSend(router, { ingress, egress }, route.nextHop ?? packet.dst, { ...packet, ttl: packet.ttl - 1 });
  }

  /** Run outbound hooks (NAT inside->outside, ACL out), then ARP and send. */
  private egressAndSend(router: Device, ctx: EgressContext, nextHop: string, packet: Ipv4Packet) {
    const v = this.runHooks(this.egressHooks, packet, (p, pk) => p.ipv4Egress!(this, router, ctx, pk));
    if (v.action === 'drop') {
      this.logEvent({ deviceId: router.id, kind: 'drop', text: `${router.hostname} ${ctx.egress.name} (out): ${v.reason}` });
      if (v.icmp && ctx.ingress) this.icmpError(router, ctx.ingress, packet, { type: 'unreachable', code: v.icmp });
      return;
    }
    this.resolveAndSend(router, ctx.egress, nextHop, v.packet, ctx.ingress?.id);
  }

  icmpError(router: Device, ingress: Interface, packet: Ipv4Packet, error: { type: 'unreachable' | 'time-exceeded'; code?: UnreachableCode }): void {
    // Never an error about an error: two broken routers could otherwise answer each other forever (RFC 1122).
    if (isIcmp(packet.l4) && packet.l4.type !== 'echo-request' && packet.l4.type !== 'echo-reply') return;
    if (packet.src === '0.0.0.0' || isMulticastIp(packet.dst)) return;
    const src = this.ipv4Of(ingress)?.address;
    if (!src) return;
    const ids = isIcmp(packet.l4) ? { id: packet.l4.id, seq: packet.l4.seq } : { id: -1, seq: -1, ...probeIdsOf(packet) };
    const l4: IcmpMessage = { proto: 'icmp', type: error.type, code: error.code, ...ids };
    this.sendIpv4(router, { kind: 'ipv4', src, dst: packet.src, ttl: DEFAULT_TTL, l4 });
  }

  sendIpv4(device: Device, packet: Ipv4Packet): string | null {
    if (device.kind === 'router') {
      const route = longestMatch(this.routes(device.id), packet.dst);
      if (!route) return `${device.hostname} has no route to ${packet.dst}`;
      const egress = this.topology.interfaces[route.interfaceId];
      const out = { ...packet, src: packet.src || this.ipv4Of(egress)!.address };
      this.egressAndSend(device, { egress }, route.nextHop ?? packet.dst, out);
      return null;
    }
    // A host's whole routing logic: is it on my subnet? If not, ask the gateway.
    const iface = this.interfacesOf(device).find((i) => this.ipv4Of(i));
    const ip = iface && this.ipv4Of(iface);
    if (!iface || !ip) return `${device.hostname} has no IP address${this.interfacesOf(device).some((i) => i.dhcp) ? ' (DHCP has not given it one)' : ''}`;
    const out = { ...packet, src: packet.src || ip.address };
    if (inSubnet(packet.dst, ip.address, ip.prefixLength)) {
      this.resolveAndSend(device, iface, packet.dst, out);
      return null;
    }
    const gw = this.gatewayOf(device);
    if (!gw) return `${packet.dst} is outside ${device.hostname}'s subnet and it has no default gateway`;
    if (!inSubnet(gw, ip.address, ip.prefixLength)) return `${device.hostname}'s gateway ${gw} is outside its own subnet`;
    this.logEvent({ deviceId: device.id, kind: 'info', text: `${device.hostname}: ${packet.dst} is not on my subnet, sending to gateway ${gw}` });
    this.resolveAndSend(device, iface, gw, out);
    return null;
  }

  sendIpv4Direct(iface: Interface, packet: Ipv4Packet, dstMac: string, opts: { control?: boolean; note?: string } = {}): void {
    this.transmit(iface, this.makeFrame(iface.mac, dstMac, packet, opts), opts.note);
  }

  /** L3 -> L2: find the next hop's MAC (ARP if needed), then frame the packet. */
  private resolveAndSend(device: Device, egress: Interface, nextHop: string, packet: Ipv4Packet, ingressId?: string) {
    // A serial link is point-to-point (HDLC/PPP): exactly one device at the
    // other end, so there is nothing to ask. No ARP on serial links.
    if (egress.portType === 'serial') {
      const peer = peerInterfaceId(this.topology, egress.id);
      const peerMac = peer ? this.topology.interfaces[peer].mac : BROADCAST_MAC;
      this.transmit(egress, this.makeFrame(egress.mac, peerMac, packet), 'point-to-point serial link, no ARP needed');
      return;
    }
    const entry = this.arp[device.id]?.[nextHop];
    if (entry) {
      this.transmit(egress, this.makeFrame(egress.mac, entry.mac, packet));
      return;
    }
    const alreadyAsking = this.pending.some((p) => p.deviceId === device.id && p.interfaceId === egress.id && p.nextHop === nextHop);
    this.pending.push({ deviceId: device.id, interfaceId: egress.id, nextHop, packet, ingressId });
    if (alreadyAsking) return;
    const own = this.ipv4Of(egress);
    if (!own) return;
    this.logEvent({ deviceId: device.id, kind: 'info', text: `${device.hostname} doesn't know ${nextHop}'s MAC yet; holds the packet and asks with ARP` });
    const request: ArpMessage = { kind: 'arp', op: 'request', senderMac: egress.mac, senderIp: own.address, targetMac: ZERO_MAC, targetIp: nextHop };
    this.transmit(egress, this.makeFrame(egress.mac, BROADCAST_MAC, request), 'broadcast to everyone on the LAN');
  }

  private flushPending(device: Device, iface: Interface, ip: string) {
    const ready = this.pending.filter((p) => p.deviceId === device.id && p.interfaceId === iface.id && p.nextHop === ip);
    this.pending = this.pending.filter((p) => !ready.includes(p));
    const mac = this.arp[device.id][ip].mac;
    for (const p of ready) this.transmit(iface, this.makeFrame(iface.mac, mac, p.packet), 'held packet released after ARP');
  }

  // ============================================================ idle / boot

  /**
   * Called when nothing is on the wire. Nothing else can happen now, so any
   * ARP still unanswered never will be, and any probe still pending was lost.
   * Then the next boot phase (if any) gets its turn.
   */
  private settle() {
    const failed = this.pending;
    this.pending = [];
    for (const p of failed) {
      const device = this.topology.devices[p.deviceId];
      this.logEvent({ deviceId: device.id, kind: 'failure', text: `${device.hostname}: no ARP reply from ${p.nextHop}; packet dropped` });
      if (p.ingressId) {
        this.icmpError(device, this.topology.interfaces[p.ingressId], p.packet, { type: 'unreachable', code: 'host' });
      } else {
        const ids = probeIdsOf(p.packet);
        const probe = ids && this.findProbe(ids.id);
        if (probe && probe.sourceDeviceId === device.id) this.finishProbe(probe, 'unreachable', `no ARP reply from ${p.nextHop}`);
      }
    }
    for (const p of this.plugins) p.onIdle?.(this);
    if (this.inFlight.length) return; // an ICMP error or plugin retry is on its way

    if (this.bootQueue.length) {
      this.startNextBootPhase();
      if (this.inFlight.length || this.bootQueue.length) return;
    }
    for (const probe of this.pings) {
      if (probe.status === 'pending') this.finishProbe(probe, 'lost', 'no reply; the packet was dropped on the way (see the log)');
    }
  }

  private startNextBootPhase() {
    while (this.bootQueue.length) {
      const order = this.bootQueue.shift()!;
      const group = this.plugins.filter((p) => p.boot && (p.bootOrder ?? 50) === order);
      this.logEvent({ kind: 'phase', control: true, text: `Starting ${group.map((p) => p.name).join(' + ')}` });
      for (const p of group) p.boot!(this);
      if (this.inFlight.length) return; // wait for this phase to go quiet
    }
  }

  // ================================================================= helpers

  /** Run filter hooks in priority order. Each hook sees the previous hook's output. */
  private runHooks(hooks: EnginePlugin[], packet: Ipv4Packet, call: (p: EnginePlugin, packet: Ipv4Packet) => Verdict): Verdict {
    for (const p of hooks) {
      const v = call(p, packet);
      if (v.action === 'drop') return v;
      packet = v.packet;
    }
    return { action: 'pass', packet };
  }

  private otherLinkedPorts(device: Device, ingress: Interface): Interface[] {
    return this.interfacesOf(device).filter((i) => i.id !== ingress.id && i.linkId && !i.parentId);
  }

  describe(p: Payload): string {
    for (const pl of this.plugins) {
      const d = pl.describe?.(p);
      if (d) return d;
    }
    if (isArp(p)) return p.op === 'request' ? `ARP request: who has ${p.targetIp}? Tell ${p.senderIp}` : `ARP reply: ${p.senderIp} is at ${p.senderMac}`;
    if (isIpv4(p)) return `${this.describeL4(p)} ${p.src} → ${p.dst} (TTL ${p.ttl})`;
    return `${p.kind} frame`;
  }

  private describeL4(p: Ipv4Packet): string {
    for (const pl of this.plugins) {
      const d = pl.describeL4?.(p.l4);
      if (d) return d;
    }
    if (isIcmp(p.l4)) {
      const t = p.l4.type;
      if (t === 'unreachable') return `ICMP ${p.l4.code === 'admin' ? 'administratively prohibited' : `${p.l4.code ?? 'net'} unreachable`}`;
      return `ICMP ${t.replace('-', ' ')}`;
    }
    return p.l4.proto.toUpperCase();
  }

  /** Colour class for drawing a frame on a cable. */
  tagOf(frame: Frame): string {
    for (const pl of this.plugins) {
      const t = pl.tag?.(frame.payload);
      if (t) return t;
    }
    if (isArp(frame.payload)) return 'arp';
    if (isIpv4(frame.payload) && isIcmp(frame.payload.l4)) {
      const t = frame.payload.l4.type;
      return t === 'echo-request' || t === 'echo-reply' ? 'icmp' : 'icmp-error';
    }
    return 'other';
  }

  portStatus(iface: Interface): 'blocking' | undefined {
    for (const p of this.plugins) {
      const s = p.portStatus?.(this, iface);
      if (s) return s;
    }
    return undefined;
  }
}

// =================================================================== utils

export function trunkAllows(sp: SwitchportConfig, vlan: number): boolean {
  return !sp.allowedVlans || sp.allowedVlans.includes(vlan);
}

export function carriesVlan(sp: SwitchportConfig, vlan: number): boolean {
  return sp.mode === 'access' ? sp.accessVlan === vlan : trunkAllows(sp, vlan);
}

/** Tag on trunks (except the native VLAN), untagged on access ports. */
function egressFrame(frame: Frame, sp: SwitchportConfig, vlan: number): Frame {
  const copy: Frame = { ...frame };
  if (sp.mode === 'trunk' && vlan !== sp.nativeVlan) copy.vlan = vlan;
  else delete copy.vlan;
  return copy;
}

export function isMulticastIp(ip: string): boolean {
  const first = Number(ip.split('.')[0]);
  return first >= 224 && first <= 239;
}

export function isMulticastMac(mac: string): boolean {
  return (parseInt(mac.slice(0, 2), 16) & 1) === 1;
}

/** 01:80:c2:00:00:0x is consumed by the bridge itself (STP, LLDP...). */
export function isBridgeGroupMac(mac: string): boolean {
  return mac.startsWith('01:80:c2:00:00:0');
}

/** Map a multicast IPv4 group to its MAC: 01:00:5e + low 23 bits. */
export function multicastMacV4(group: string): string {
  const n = parseIPv4(group) ?? 0;
  const low = n & 0x7fffff;
  return ['01', '00', '5e', ((low >> 16) & 0x7f).toString(16).padStart(2, '0'), ((low >> 8) & 255).toString(16).padStart(2, '0'), (low & 255).toString(16).padStart(2, '0')].join(':');
}

/** Which probe a non-ICMP packet belongs to (TCP probes carry their id in the source port). */
function probeIdsOf(packet: Ipv4Packet): { id: number; seq: number } | undefined {
  if (isIcmp(packet.l4)) return { id: packet.l4.id, seq: packet.l4.seq };
  const l4 = packet.l4 as { srcPort?: number; probeId?: number };
  if (typeof l4.probeId === 'number') return { id: l4.probeId, seq: 1 };
  return undefined;
}

export { formatIPv4 };
