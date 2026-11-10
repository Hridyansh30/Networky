// The plugin contract.
//
// The engine core (simulation.ts) knows only Ethernet, hubs, switches, ARP,
// IPv4, ICMP and static routing. Every other protocol is an EnginePlugin
// that hooks into well-defined points of the packet path:
//
//   wire ─► switch ──────────────► NIC ─────────► IPv4 ─────────────► routing ─► IPv4 out
//           portForwards (STP)     acceptsMac      ipv4Ingress (ACL,NAT) routes   ipv4Egress (NAT,ACL)
//           handleSwitchFrame      handleFrame     deliverIpv4 (DHCP,RIP,OSPF,TCP)
//
// Rules for plugin authors:
//  1. Depend on SimApi only, never on another plugin's internals.
//  2. Keep runtime state in sim.state(name, init), never in module globals
//     (two simulations must never share state).
//  3. Every hook is optional. Returning undefined / false means "not mine".
//
// Adding a protocol = writing one file in plugins/ and listing it in
// plugins/index.ts. Removing one = deleting that line.

import type { Device, Interface, Ipv4Config, Topology } from '../model/types';
import type { Frame, Ipv4Packet, L4, Payload, UnreachableCode } from './packets';
import type { Route } from './routing';

export type LogKind = 'send' | 'receive' | 'learn' | 'drop' | 'success' | 'failure' | 'info' | 'phase';

export interface LogEntry {
  tick: number;
  deviceId?: string;
  kind: LogKind;
  text: string;
  frameId?: number;
  /** Control-plane chatter (STP, routing protocols, NDP, DHCP), which the UI can hide. */
  control?: boolean;
}

export type ProbeKind = 'ping' | 'tcp';
export type ProbeStatus = 'pending' | 'success' | 'refused' | 'unreachable' | 'prohibited' | 'ttl-exceeded' | 'lost';

/** A ping or a TCP connection test, and how it ended. */
export interface Probe {
  id: number;
  kind: ProbeKind;
  seq: number;
  sourceDeviceId: string;
  destination: string;
  port?: number;
  ttl: number;
  sentAt: number;
  status: ProbeStatus;
  rttTicks?: number;
  detail?: string;
  /** The address that answered (the destination, or the router that sent an ICMP error). */
  respondent?: string;
}

export interface ProbeRequest {
  kind: ProbeKind;
  sourceDeviceId: string;
  destination: string;
  ttl?: number;
  seq?: number;
  port?: number;
}

/** What a filter hook decides about a packet. */
export type Verdict =
  | { action: 'pass'; packet: Ipv4Packet }
  | { action: 'drop'; reason: string; /** send this ICMP unreachable back to the source */ icmp?: UnreachableCode };

export interface EgressContext {
  /** Where the packet came in; undefined when the router itself originated it. */
  ingress?: Interface;
  egress: Interface;
}

/** What plugins may use from the engine. The Simulation class implements it. */
export interface SimApi {
  readonly topology: Topology;
  readonly tick: number;

  logEvent(entry: Omit<LogEntry, "tick">): void;
  /** Runtime state owned by one plugin, created on first use. */
  state<T>(plugin: string, init: () => T): T;

  // --- layer 2
  makeFrame(srcMac: string, dstMac: string, payload: Payload, opts?: { control?: boolean }): Frame;
  transmit(from: Interface, frame: Frame, note?: string): void;

  // --- topology helpers
  device(id: string): Device;
  interfacesOf(device: Device): Interface[];
  isUp(iface: Interface): boolean;

  // --- layer 3
  /** The address an interface really has right now (configured, or leased by DHCP). */
  ipv4Of(iface: Interface): Ipv4Config | undefined;
  gatewayOf(device: Device): string | undefined;
  routes(deviceId: string): Route[];
  /** Route, ARP and send a packet this device originates. Returns an error if it can't leave. */
  sendIpv4(device: Device, packet: Ipv4Packet): string | null;
  /** Send straight out one interface to a known MAC (broadcasts, multicasts, replies). */
  sendIpv4Direct(iface: Interface, packet: Ipv4Packet, dstMac: string, opts?: { control?: boolean; note?: string }): void;
  /** ICMP error back to the sender of `packet` (never about another ICMP error). */
  icmpError(router: Device, ingress: Interface, packet: Ipv4Packet, error: { type: 'unreachable' | 'time-exceeded'; code?: UnreachableCode }): void;

  // --- probes (ping, TCP connect)
  newProbe(request: ProbeRequest): Probe;
  findProbe(id: number): Probe | undefined;
  finishProbe(probe: Probe, status: ProbeStatus, detail: string, rttTicks?: number, respondent?: string): Probe;

  plugin<T extends EnginePlugin>(name: string): T | undefined;
}

export interface EnginePlugin {
  readonly name: string;
  /** One line for the UI: what this protocol does. */
  readonly description: string;

  /**
   * Control-plane start-up. Plugins boot in ascending order; a phase starts
   * only after the previous one has gone quiet. STP=1, routing=2, addressing=3.
   */
  bootOrder?: number;
  boot?(sim: SimApi): void;
  /** Called whenever the wire goes empty: fail anything still waiting. */
  onIdle?(sim: SimApi): void;

  // ---------------------------------------------------------------- layer 2
  /** Extra destination MACs a NIC should accept (multicast groups). */
  acceptsMac?(sim: SimApi, device: Device, iface: Interface, mac: string): boolean;
  /** A frame with a payload the core doesn't know reached a host or router. Return true if handled. */
  handleFrame?(sim: SimApi, device: Device, iface: Interface, frame: Frame): boolean;
  /** A frame addressed to the switch itself (e.g. a BPDU). Return true if consumed. */
  handleSwitchFrame?(sim: SimApi, sw: Device, ingress: Interface, frame: Frame): boolean;
  /** May this switch port carry data frames? (STP blocks some.) */
  portForwards?(sim: SimApi, sw: Device, port: Interface): boolean;

  // ---------------------------------------------------------------- layer 3
  /** Override an interface's IPv4 config (DHCP). undefined = no opinion; null = "has no address right now". */
  ipv4Of?(sim: SimApi, iface: Interface): Ipv4Config | null | undefined;
  gatewayOf?(sim: SimApi, device: Device): string | undefined;
  /** Should this interface answer ARP for an IP that isn't its own? (NAT, proxy ARP) */
  answersArp?(sim: SimApi, device: Device, iface: Interface, ip: string): boolean;
  /** Before routing, on the ingress interface. Lower priority runs first. */
  ingressPriority?: number;
  ipv4Ingress?(sim: SimApi, router: Device, iface: Interface, packet: Ipv4Packet): Verdict;
  /** After routing, before the frame is built. Lower priority runs first. */
  egressPriority?: number;
  ipv4Egress?(sim: SimApi, router: Device, ctx: EgressContext, packet: Ipv4Packet): Verdict;
  /** Extra routes for the routing table. */
  routes?(sim: SimApi, deviceId: string): Route[];
  /** An IPv4 packet for this device carrying something other than ICMP echo. Return true if handled. */
  deliverIpv4?(sim: SimApi, device: Device, iface: Interface, packet: Ipv4Packet): boolean;

  // ------------------------------------------------------------------ probes
  /** Take over a probe the core can't do (IPv6 ping, TCP). Return the probe, or undefined. */
  startProbe?(sim: SimApi, request: ProbeRequest): Probe | undefined;

  // ------------------------------------------------------------------ visual
  describe?(payload: Payload): string | undefined;
  describeL4?(l4: L4): string | undefined;
  /** Colour class for an envelope on a cable. */
  tag?(payload: Payload): string | undefined;
  /** Extra state for drawing a port (STP blocking). */
  portStatus?(sim: SimApi, iface: Interface): 'blocking' | undefined;
}
