// What travels on the wire.
//
// Layers nest like the real thing: an Ethernet Frame carries a Payload
// (ARP, IPv4, IPv6, a BPDU...), and an IPv4 packet carries an L4 message
// (ICMP, UDP, TCP, OSPF...).
//
// The types are deliberately OPEN: `Payload` and `L4` only require a
// discriminator string. A protocol plugin defines its own message type and a
// type guard for it, so adding a protocol never means editing this file.

export const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff';
export const ZERO_MAC = '00:00:00:00:00:00';
export const IPV4_BROADCAST = '255.255.255.255';

/** Anything an Ethernet frame can carry. `kind` is the EtherType, in words. */
export interface Payload {
  kind: string;
}

export interface Frame {
  /** Same id on every copy a hub or switch makes, so the log can follow one frame. */
  id: number;
  srcMac: string;
  dstMac: string;
  /** 802.1Q tag. Only present while the frame crosses a trunk link. */
  vlan?: number;
  payload: Payload;
}

/** One frame on one cable during one tick. */
export interface Transmission {
  id: number;
  frame: Frame;
  linkId: string;
  fromIf: string;
  toIf: string;
}

// ------------------------------------------------------------------ ARP (core)

export interface ArpMessage extends Payload {
  kind: 'arp';
  op: 'request' | 'reply';
  senderMac: string;
  senderIp: string;
  targetMac: string; // 00:00:00:00:00:00 in a request: that's what we're asking for
  targetIp: string;
}

export const isArp = (p: Payload): p is ArpMessage => p.kind === 'arp';

// ----------------------------------------------------------------- IPv4 (core)

/** A layer 4 message inside an IP packet. `proto` is the IP protocol, in words. */
export interface L4 {
  proto: string;
}

export interface Ipv4Packet extends Payload {
  kind: 'ipv4';
  src: string;
  dst: string;
  ttl: number;
  l4: L4;
}

export const isIpv4 = (p: Payload): p is Ipv4Packet => p.kind === 'ipv4';

export type IcmpType = 'echo-request' | 'echo-reply' | 'time-exceeded' | 'unreachable';

/** 'net' / 'host': no route / no ARP answer. 'admin': an ACL said no. 'port': nobody listens. */
export type UnreachableCode = 'net' | 'host' | 'admin' | 'port';

export interface IcmpMessage extends L4 {
  proto: 'icmp';
  type: IcmpType;
  /** echo identifier and sequence; errors copy them from the packet that caused the error */
  id: number;
  seq: number;
  code?: UnreachableCode;
}

export const isIcmp = (l4: L4): l4 is IcmpMessage => l4.proto === 'icmp';

/** UDP carries an application message, tagged by `app`. */
export interface UdpDatagram extends L4 {
  proto: 'udp';
  srcPort: number;
  dstPort: number;
  data: { app: string };
}

export const isUdp = (l4: L4): l4 is UdpDatagram => l4.proto === 'udp';

export type TcpFlags = 'syn' | 'syn-ack' | 'rst';

export interface TcpSegment extends L4 {
  proto: 'tcp';
  srcPort: number;
  dstPort: number;
  flags: TcpFlags;
}

export const isTcp = (l4: L4): l4 is TcpSegment => l4.proto === 'tcp';

/** Port-like identity of a flow, used by NAT and ACLs. ICMP's echo id plays the port's role. */
export function flowPorts(l4: L4): { src?: number; dst?: number } {
  if (isUdp(l4) || isTcp(l4)) return { src: l4.srcPort, dst: l4.dstPort };
  if (isIcmp(l4)) return { src: l4.id, dst: l4.id };
  return {};
}
