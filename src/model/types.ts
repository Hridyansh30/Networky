// The topology model: what the network IS. No React, no DOM, no positions.
// Everything else (UI, the phase 2 engine, exporters) reads this.

import type { ServicesConfig } from './services';

export type DeviceKind = 'pc' | 'laptop' | 'server' | 'hub' | 'switch' | 'router';
export type PortType = 'fastethernet' | 'gigabitethernet' | 'serial' | 'fiber';
export type CableType = 'copper-straight' | 'copper-cross' | 'fiber' | 'serial';

export interface Ipv4Config {
  address: string; // dotted quad, e.g. '192.168.1.10'
  prefixLength: number; // 0..32
}

export interface Interface {
  id: string;
  deviceId: string;
  name: string; // 'GigabitEthernet0/1', what the CLI will show later
  portType: PortType;
  mac: string; // generated once, never changes
  ipv4?: Ipv4Config; // only on L3 interfaces (pc, server, router)
  adminUp: boolean; // 'shutdown' / 'no shutdown'
  linkId?: string; // set when a cable is plugged in

  // ---- phase 3 ----
  /** Switch ports only. Absent = access port in VLAN 1 (the factory default). */
  switchport?: SwitchportConfig;
  /** Router subinterface (router-on-a-stick): 'GigabitEthernet0/0.10'. Has no cable of its own. */
  parentId?: string;
  /** 802.1Q VLAN a subinterface sends and receives ('encapsulation dot1Q 10'). */
  vlanTag?: number;
  /** Host: get the IPv4 address, mask and gateway from DHCP instead of `ipv4`. */
  dhcp?: boolean;
  /** Global unicast IPv6 address. The link-local fe80:: address is derived from the MAC. */
  ipv6?: Ipv6Config;
  /** Host: build an IPv6 address with SLAAC from the router's advertisement. */
  ipv6Auto?: boolean;
  /** Router: ACL names applied to traffic entering / leaving this interface. */
  aclIn?: string;
  aclOut?: string;
  /** Router: NAT role of this interface. */
  nat?: 'inside' | 'outside';
  /** Router: DHCP relay target ('ip helper-address'). */
  helperAddress?: string;
  /** Router: OSPF cost override. Default comes from bandwidth. */
  ospfCost?: number;
}

export interface SwitchportConfig {
  mode: 'access' | 'trunk';
  accessVlan: number;
  /** Untagged VLAN on a trunk. */
  nativeVlan: number;
  /** Trunk only. Absent = all VLANs allowed. */
  allowedVlans?: number[];
}

export interface Ipv6Config {
  address: string; // compressed form, e.g. '2001:db8:1::1'
  prefixLength: number;
}

export interface DhcpPool {
  name: string;
  network: string;
  prefixLength: number;
  defaultRouter?: string;
  dnsServer?: string;
  /** Addresses the server must never hand out. */
  excluded?: string[];
}

export type AclAction = 'permit' | 'deny';
export type AclProtocol = 'ip' | 'icmp' | 'tcp' | 'udp';

export interface AclRule {
  action: AclAction;
  /** Standard ACLs always use 'ip' and match the source only. */
  protocol: AclProtocol;
  src: string;
  srcWildcard: string;
  dst?: string; // extended only
  dstWildcard?: string;
  dstPort?: number; // extended tcp/udp only: 'eq <port>'
}

export interface Acl {
  type: 'standard' | 'extended';
  rules: AclRule[];
}

export interface NatConfig {
  /** 'ip nat inside source static <local> <global>' */
  statics: { local: string; global: string }[];
  /** PAT: 'ip nat inside source list <acl> interface <outside> overload' */
  overload?: { acl: string; outsideInterfaceId: string };
}

export interface RoutingNetwork {
  prefix: string;
  prefixLength: number;
}

export interface StaticRoute {
  prefix: string; // network address, e.g. '10.0.2.0'
  prefixLength: number;
  nextHop: string;
}

export interface Device {
  id: string;
  kind: DeviceKind;
  hostname: string;
  interfaceIds: string[];
  defaultGateway?: string; // pc and server only
  staticRoutes?: StaticRoute[]; // router only

  // ---- phase 3 ----
  defaultGatewayV6?: string; // pc and server
  /** Switch: STP bridge priority (lower wins the root election). Default 32768. */
  stpPriority?: number;
  /** Router or server acting as a DHCP server. */
  dhcpPools?: DhcpPool[];
  /** Router: access lists by name ('10', '101', 'BLOCK_WEB'). */
  acls?: Record<string, Acl>;
  nat?: NatConfig;
  /** Router: RIPv2, enabled when present. Networks select interfaces, like 'network 10.0.0.0'. */
  rip?: { networks: RoutingNetwork[] };
  /** Router: OSPF, enabled when present. */
  ospf?: { routerId?: string; networks: (RoutingNetwork & { area: number })[] };
  ipv6StaticRoutes?: StaticRoute[];
  /** PC, laptop, server: the DNS server it asks (else the one from DHCP). */
  dnsServer?: string;
  /** PC, laptop, server: application services and Desktop app settings (model/services.ts). */
  services?: ServicesConfig;
}

export interface Link {
  id: string;
  a: string; // interface id
  b: string; // interface id
  cable: CableType;
}

export interface Topology {
  version: 1; // bump when the shape changes, migrate on load
  devices: Record<string, Device>;
  interfaces: Record<string, Interface>;
  links: Record<string, Link>;
}

/** UI-only: where each device is drawn. Kept out of Topology on purpose. */
export type Layout = Record<string, { x: number; y: number }>;
