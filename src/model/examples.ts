// Ready-made networks to learn from. Built with the same ops the UI uses,
// so they are always valid topologies.

import { parseRule } from './acl';
import {
  addDevice,
  addSubinterface,
  addStaticRoute,
  connect,
  createTopology,
  setAcl,
  setDefaultGateway,
  setDefaultGatewayV6,
  setDhcpPools,
  setInterfaceIp,
  setInterfaceOptions,
  setNat,
  setOspf,
  setRip,
  setStpPriority,
  setSwitchport,
  type InterfacePatch,
} from './ops';
import type { Acl, CableType, DeviceKind, DhcpPool, Layout, NatConfig, RoutingNetwork, Topology } from './types';

/** Something to try in an example, and what should happen. Tests check every one. */
export interface Exercise {
  kind: 'ping' | 'tcp';
  from: string; // hostname
  to: string; // address
  port?: number;
  expect: 'success' | 'unreachable' | 'prohibited' | 'refused' | 'lost';
  why: string;
}

export interface Example {
  name: string;
  description: string;
  /** Protocols this lab is about (matches the protocol filter names). */
  topics: string[];
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  minutes: number;
  exercises: Exercise[];
  build(): { topology: Topology; layout: Layout };
}

class Draft {
  t = createTopology();
  layout: Layout = {};
  private byName: Record<string, string> = {};

  dev(kind: DeviceKind, name: string, x: number, y: number) {
    const r = addDevice(this.t, kind, { hostname: name });
    this.t = r.topology;
    this.byName[name] = r.deviceId;
    this.layout[r.deviceId] = { x, y };
    return this;
  }
  private port(name: string, port: string) {
    const d = this.t.devices[this.byName[name]];
    return d.interfaceIds.find((i) => this.t.interfaces[i].name === port)!;
  }
  link(a: string, ap: string, b: string, bp: string, cable: CableType = 'copper-straight') {
    this.t = connect(this.t, this.port(a, ap), this.port(b, bp), cable).topology;
    return this;
  }
  ip(name: string, port: string, address: string, prefixLength: number) {
    this.t = setInterfaceIp(this.t, this.port(name, port), { address, prefixLength });
    return this;
  }
  gw(name: string, gateway: string) {
    this.t = setDefaultGateway(this.t, this.byName[name], gateway);
    return this;
  }
  route(name: string, prefix: string, prefixLength: number, nextHop: string) {
    this.t = addStaticRoute(this.t, this.byName[name], { prefix, prefixLength, nextHop });
    return this;
  }
  access(sw: string, port: string, vlan: number) {
    this.t = setSwitchport(this.t, this.port(sw, port), { mode: 'access', accessVlan: vlan, nativeVlan: 1 });
    return this;
  }
  trunk(sw: string, port: string) {
    this.t = setSwitchport(this.t, this.port(sw, port), { mode: 'trunk', accessVlan: 1, nativeVlan: 1 });
    return this;
  }
  sub(router: string, port: string, vlan: number, address: string, prefixLength: number) {
    const r = addSubinterface(this.t, this.port(router, port), vlan);
    this.t = setInterfaceIp(r.topology, r.interfaceId, { address, prefixLength });
    return this;
  }
  opts(name: string, port: string, patch: InterfacePatch) {
    this.t = setInterfaceOptions(this.t, this.port(name, port), patch);
    return this;
  }
  v6(name: string, port: string, address: string, prefixLength = 64) {
    return this.opts(name, port, { ipv6: { address, prefixLength } });
  }
  gw6(name: string, gateway: string) {
    this.t = setDefaultGatewayV6(this.t, this.byName[name], gateway);
    return this;
  }
  pools(name: string, pools: DhcpPool[]) {
    this.t = setDhcpPools(this.t, this.byName[name], pools);
    return this;
  }
  acl(name: string, acl: string, type: Acl['type'], ...rules: string[]) {
    this.t = setAcl(this.t, this.byName[name], acl, { type, rules: rules.map((r) => parseRule(r, type)) });
    return this;
  }
  nat(name: string, build: (port: (p: string) => string) => NatConfig) {
    this.t = setNat(this.t, this.byName[name], build((p) => this.port(name, p)));
    return this;
  }
  rip(name: string, networks: RoutingNetwork[]) {
    this.t = setRip(this.t, this.byName[name], networks);
    return this;
  }
  ospf(name: string, routerId: string, networks: RoutingNetwork[]) {
    this.t = setOspf(this.t, this.byName[name], { routerId, networks: networks.map((n) => ({ ...n, area: 0 })) });
    return this;
  }
  stpPriority(name: string, priority: number) {
    this.t = setStpPriority(this.t, this.byName[name], priority);
    return this;
  }
  done() {
    return { topology: this.t, layout: this.layout };
  }
}

/**
 * PC1 ─ R1 ─ R2 ─ R3 ─ PC3, 10.1.0.0/24 on the left, 10.3.0.0/24 on the right.
 *  'serial': R1═R2═R3 over serial links (the RIP lab).
 *  'ospf'  : R1─R2─R3 over Gigabit/fiber, PLUS a direct slow serial R1═R3.
 */
function threeRouters(mode: 'serial' | 'ospf' = 'serial'): Draft {
  const d = new Draft()
    .dev('pc', 'PC1', 0, 320)
    .dev('router', 'R1', 160, 120)
    .dev('router', 'R2', 480, 0)
    .dev('router', 'R3', 800, 120)
    .dev('pc', 'PC3', 960, 320)
    .link('PC1', 'FastEthernet0', 'R1', 'GigabitEthernet0/0', 'copper-cross')
    .link('R3', 'GigabitEthernet0/0', 'PC3', 'FastEthernet0', 'copper-cross')
    .ip('PC1', 'FastEthernet0', '10.1.0.10', 24)
    .ip('R1', 'GigabitEthernet0/0', '10.1.0.1', 24)
    .ip('R3', 'GigabitEthernet0/0', '10.3.0.1', 24)
    .ip('PC3', 'FastEthernet0', '10.3.0.10', 24)
    .gw('PC1', '10.1.0.1')
    .gw('PC3', '10.3.0.1');
  if (mode === 'serial') {
    return d
      .link('R1', 'Serial0/0/0', 'R2', 'Serial0/0/0', 'serial')
      .link('R2', 'Serial0/0/1', 'R3', 'Serial0/0/0', 'serial')
      .ip('R1', 'Serial0/0/0', '10.0.12.1', 30)
      .ip('R2', 'Serial0/0/0', '10.0.12.2', 30)
      .ip('R2', 'Serial0/0/1', '10.0.23.1', 30)
      .ip('R3', 'Serial0/0/0', '10.0.23.2', 30);
  }
  return d
    .link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1', 'copper-cross')
    .link('R2', 'GigabitEthernet0/2', 'R3', 'GigabitEthernet0/2', 'fiber')
    .link('R1', 'Serial0/0/0', 'R3', 'Serial0/0/0', 'serial')
    .ip('R1', 'GigabitEthernet0/1', '10.0.12.1', 30)
    .ip('R2', 'GigabitEthernet0/1', '10.0.12.2', 30)
    .ip('R2', 'GigabitEthernet0/2', '10.0.23.1', 30)
    .ip('R3', 'GigabitEthernet0/2', '10.0.23.2', 30)
    .ip('R1', 'Serial0/0/0', '10.0.13.1', 30)
    .ip('R3', 'Serial0/0/0', '10.0.13.2', 30);
}

export const EXAMPLES: Example[] = [
  {
    name: 'Hub vs switch',
    level: 'Beginner',
    minutes: 10,
    description: 'Ping PC0 → 10.0.0.2, then PC3 → 10.0.0.5. Watch who receives frames they did not ask for.',
    topics: ['ARP', 'ICMP'],
    exercises: [
      { kind: 'ping', from: 'PC0', to: '10.0.0.2', expect: 'success', why: 'The hub repeats every frame to PC2 as well.' },
      { kind: 'ping', from: 'PC3', to: '10.0.0.5', expect: 'success', why: 'The switch learns MACs and forwards the reply to one port only.' },
      { kind: 'ping', from: 'PC0', to: '10.0.0.5', expect: 'unreachable', why: 'The hub and the switch are not cabled together.' },
    ],
    build: () =>
      new Draft()
        .dev('hub', 'Hub0', 40, 40)
        .dev('pc', 'PC0', 0, 260)
        .dev('pc', 'PC1', 190, 260)
        .dev('pc', 'PC2', 380, 260)
        .dev('switch', 'Switch0', 560, 40)
        .dev('pc', 'PC3', 560, 260)
        .dev('pc', 'PC4', 750, 260)
        .dev('pc', 'PC5', 940, 260)
        .link('PC0', 'FastEthernet0', 'Hub0', 'Port0')
        .link('PC1', 'FastEthernet0', 'Hub0', 'Port1')
        .link('PC2', 'FastEthernet0', 'Hub0', 'Port2')
        .link('PC3', 'FastEthernet0', 'Switch0', 'FastEthernet0/1')
        .link('PC4', 'FastEthernet0', 'Switch0', 'FastEthernet0/2')
        .link('PC5', 'FastEthernet0', 'Switch0', 'FastEthernet0/3')
        .ip('PC0', 'FastEthernet0', '10.0.0.1', 24)
        .ip('PC1', 'FastEthernet0', '10.0.0.2', 24)
        .ip('PC2', 'FastEthernet0', '10.0.0.3', 24)
        .ip('PC3', 'FastEthernet0', '10.0.0.4', 24)
        .ip('PC4', 'FastEthernet0', '10.0.0.5', 24)
        .ip('PC5', 'FastEthernet0', '10.0.0.6', 24)
        .done(),
  },
  {
    name: 'Two LANs, one router',
    level: 'Beginner',
    minutes: 10,
    description: 'Ping PC0 → 192.168.2.10. PC0 ARPs for its gateway, not for PC1.',
    topics: ['ARP', 'ICMP'],
    exercises: [{ kind: 'ping', from: 'PC0', to: '192.168.2.10', expect: 'success', why: 'PC0 sends to its gateway; the router forwards between its two subnets.' }],
    build: () =>
      new Draft()
        .dev('pc', 'PC0', 0, 300)
        .dev('switch', 'Switch0', 0, 80)
        .dev('router', 'Router0', 420, 0)
        .dev('switch', 'Switch1', 760, 80)
        .dev('pc', 'PC1', 860, 300)
        .link('PC0', 'FastEthernet0', 'Switch0', 'FastEthernet0/1')
        .link('Switch0', 'GigabitEthernet0/1', 'Router0', 'GigabitEthernet0/0')
        .link('Router0', 'GigabitEthernet0/1', 'Switch1', 'GigabitEthernet0/1')
        .link('Switch1', 'FastEthernet0/1', 'PC1', 'FastEthernet0')
        .ip('PC0', 'FastEthernet0', '192.168.1.10', 24)
        .ip('Router0', 'GigabitEthernet0/0', '192.168.1.1', 24)
        .ip('Router0', 'GigabitEthernet0/1', '192.168.2.1', 24)
        .ip('PC1', 'FastEthernet0', '192.168.2.10', 24)
        .gw('PC0', '192.168.1.1')
        .gw('PC1', '192.168.2.1')
        .done(),
  },
  {
    name: 'Two routers, static routes',
    level: 'Beginner',
    minutes: 15,
    description: 'Ping PC0 → 10.2.0.10, then try traceroute. Delete R2’s route and ping again.',
    topics: ['ARP', 'ICMP'],
    exercises: [{ kind: 'ping', from: 'PC0', to: '10.2.0.10', expect: 'success', why: 'Each router has a static route to the far LAN.' }],
    build: () =>
      new Draft()
        .dev('pc', 'PC0', 0, 300)
        .dev('switch', 'S1', 0, 80)
        .dev('router', 'R1', 380, 0)
        .dev('router', 'R2', 720, 0)
        .dev('switch', 'S2', 1000, 80)
        .dev('pc', 'PC1', 1100, 300)
        .link('PC0', 'FastEthernet0', 'S1', 'FastEthernet0/1')
        .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
        .link('R1', 'Serial0/0/0', 'R2', 'Serial0/0/0', 'serial')
        .link('R2', 'GigabitEthernet0/0', 'S2', 'GigabitEthernet0/1')
        .link('S2', 'FastEthernet0/1', 'PC1', 'FastEthernet0')
        .ip('PC0', 'FastEthernet0', '10.1.0.10', 24)
        .ip('R1', 'GigabitEthernet0/0', '10.1.0.1', 24)
        .ip('R1', 'Serial0/0/0', '10.0.0.1', 30)
        .ip('R2', 'Serial0/0/0', '10.0.0.2', 30)
        .ip('R2', 'GigabitEthernet0/0', '10.2.0.1', 24)
        .ip('PC1', 'FastEthernet0', '10.2.0.10', 24)
        .gw('PC0', '10.1.0.1')
        .gw('PC1', '10.2.0.1')
        .route('R1', '10.2.0.0', 24, '10.0.0.2')
        .route('R2', '10.1.0.0', 24, '10.0.0.1')
        .done(),
  },
  {
    name: 'VLAN lab: router-on-a-stick',
    level: 'Intermediate',
    minutes: 20,
    description: 'PC1 and PC2 are in VLAN 10, PC3 in VLAN 20, on one switch. R1 routes between the VLANs over a single trunk with 802.1Q subinterfaces. Watch the VLAN tag appear only on the trunk.',
    topics: ['VLAN', 'ARP', 'ICMP'],
    exercises: [
      { kind: 'ping', from: 'PC1', to: '192.168.10.11', expect: 'success', why: 'Same VLAN: the switch forwards directly.' },
      { kind: 'ping', from: 'PC1', to: '192.168.20.10', expect: 'success', why: 'Different VLAN: up the trunk tagged 10, back down tagged 20.' },
    ],
    build: () =>
      new Draft()
        .dev('router', 'R1', 380, 0)
        .dev('switch', 'S1', 380, 200)
        .dev('pc', 'PC1', 80, 380)
        .dev('pc', 'PC2', 380, 400)
        .dev('laptop', 'PC3', 680, 380)
        .link('R1', 'GigabitEthernet0/0', 'S1', 'GigabitEthernet0/1')
        .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
        .link('PC2', 'FastEthernet0', 'S1', 'FastEthernet0/2')
        .link('PC3', 'FastEthernet0', 'S1', 'FastEthernet0/3')
        .access('S1', 'FastEthernet0/1', 10)
        .access('S1', 'FastEthernet0/2', 10)
        .access('S1', 'FastEthernet0/3', 20)
        .trunk('S1', 'GigabitEthernet0/1')
        .sub('R1', 'GigabitEthernet0/0', 10, '192.168.10.1', 24)
        .sub('R1', 'GigabitEthernet0/0', 20, '192.168.20.1', 24)
        .ip('PC1', 'FastEthernet0', '192.168.10.10', 24)
        .ip('PC2', 'FastEthernet0', '192.168.10.11', 24)
        .ip('PC3', 'FastEthernet0', '192.168.20.10', 24)
        .gw('PC1', '192.168.10.1')
        .gw('PC2', '192.168.10.1')
        .gw('PC3', '192.168.20.1')
        .done(),
  },
  {
    name: 'STP: redundant switches',
    level: 'Intermediate',
    minutes: 20,
    description: 'Three switches in a triangle: a loop. Switch on Simulation and press play to watch BPDUs elect S1 (priority 4096) as root and block one port (amber). Then ping across.',
    topics: ['STP', 'ARP', 'ICMP'],
    exercises: [{ kind: 'ping', from: 'PC0', to: '10.0.0.2', expect: 'success', why: 'With one port blocked the loop is gone, so the broadcast ARP does not circle forever.' }],
    build: () =>
      new Draft()
        .dev('switch', 'S1', 380, 0)
        .dev('switch', 'S2', 120, 260)
        .dev('switch', 'S3', 640, 260)
        .dev('pc', 'PC0', 0, 460)
        .dev('pc', 'PC1', 760, 460)
        .link('S1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1', 'copper-cross')
        .link('S1', 'FastEthernet0/1', 'S3', 'FastEthernet0/1', 'copper-cross')
        .link('S2', 'FastEthernet0/2', 'S3', 'FastEthernet0/2', 'copper-cross')
        .link('PC0', 'FastEthernet0', 'S2', 'FastEthernet0/5')
        .link('PC1', 'FastEthernet0', 'S3', 'FastEthernet0/5')
        .ip('PC0', 'FastEthernet0', '10.0.0.1', 24)
        .ip('PC1', 'FastEthernet0', '10.0.0.2', 24)
        .stpPriority('S1', 4096)
        .done(),
  },
  {
    name: 'DHCP with a relay',
    level: 'Intermediate',
    minutes: 20,
    description: 'The PCs have no address. R1 serves the 192.168.1.0/24 LAN itself; LAN 2 gets its addresses from the server through ip helper-address. Watch Discover, Offer, Request, Ack.',
    topics: ['DHCP', 'ARP', 'ICMP'],
    exercises: [
      { kind: 'ping', from: 'PC1', to: '192.168.1.1', expect: 'success', why: 'PC1 leased an address and its gateway from R1.' },
      { kind: 'ping', from: 'PC2', to: '10.0.0.10', expect: 'success', why: 'PC2 leased from the server two subnets away, through the relay.' },
    ],
    build: () =>
      new Draft()
        .dev('pc', 'PC1', 0, 300)
        .dev('switch', 'S1', 120, 120)
        .dev('router', 'R1', 420, 0)
        .dev('switch', 'S2', 720, 120)
        .dev('laptop', 'PC2', 840, 300)
        .dev('switch', 'S3', 420, 240)
        .dev('server', 'DHCP', 420, 440)
        .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
        .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
        .link('R1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1')
        .link('S2', 'FastEthernet0/1', 'PC2', 'FastEthernet0')
        .link('R1', 'GigabitEthernet0/2', 'S3', 'GigabitEthernet0/2', 'fiber')
        .link('S3', 'FastEthernet0/1', 'DHCP', 'GigabitEthernet0')
        .ip('R1', 'GigabitEthernet0/0', '192.168.1.1', 24)
        .ip('R1', 'GigabitEthernet0/1', '192.168.2.1', 24)
        .ip('R1', 'GigabitEthernet0/2', '10.0.0.1', 24)
        .ip('DHCP', 'GigabitEthernet0', '10.0.0.10', 24)
        .gw('DHCP', '10.0.0.1')
        .pools('R1', [{ name: 'LAN1', network: '192.168.1.0', prefixLength: 24, defaultRouter: '192.168.1.1', dnsServer: '10.0.0.10', excluded: ['192.168.1.2', '192.168.1.3'] }])
        .pools('DHCP', [{ name: 'LAN2', network: '192.168.2.0', prefixLength: 24, defaultRouter: '192.168.2.1', dnsServer: '10.0.0.10' }])
        .opts('R1', 'GigabitEthernet0/1', { helperAddress: '10.0.0.10' })
        .opts('PC1', 'FastEthernet0', { dhcp: true })
        .opts('PC2', 'FastEthernet0', { dhcp: true })
        .done(),
  },
  {
    name: 'Office edge: NAT + ACL',
    level: 'Advanced',
    minutes: 30,
    description: 'The office uses private 192.168.1.0/24 and PAT to share one public address. ACL 110 lets staff browse the web server but blocks SSH. Run the TCP tests, then look at the NAT table.',
    topics: ['NAT', 'ACL', 'TCP', 'ARP', 'ICMP'],
    exercises: [
      { kind: 'ping', from: 'PC1', to: '203.0.113.80', expect: 'success', why: 'PAT rewrites 192.168.1.10 to 203.0.113.1 on the way out.' },
      { kind: 'tcp', from: 'PC1', to: '203.0.113.80', port: 80, expect: 'success', why: 'ACL 110 line 1 permits web traffic.' },
      { kind: 'tcp', from: 'PC1', to: '203.0.113.80', port: 22, expect: 'prohibited', why: 'ACL 110 line 2 denies SSH; R1 answers "administratively prohibited".' },
      { kind: 'ping', from: 'ISP-PC', to: '192.168.1.10', expect: 'unreachable', why: 'Private addresses are not routed on the Internet side.' },
    ],
    build: () =>
      new Draft()
        .dev('pc', 'PC1', 0, 120)
        .dev('laptop', 'PC2', 0, 360)
        .dev('switch', 'S1', 220, 240)
        .dev('router', 'R1', 480, 240)
        .dev('switch', 'ISP', 760, 240)
        .dev('server', 'Web', 980, 120)
        .dev('pc', 'ISP-PC', 980, 360)
        .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
        .link('PC2', 'FastEthernet0', 'S1', 'FastEthernet0/2')
        .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
        .link('R1', 'GigabitEthernet0/1', 'ISP', 'GigabitEthernet0/1')
        .link('ISP', 'FastEthernet0/1', 'Web', 'GigabitEthernet0')
        .link('ISP', 'FastEthernet0/2', 'ISP-PC', 'FastEthernet0')
        .ip('PC1', 'FastEthernet0', '192.168.1.10', 24)
        .ip('PC2', 'FastEthernet0', '192.168.1.11', 24)
        .ip('R1', 'GigabitEthernet0/0', '192.168.1.1', 24)
        .ip('R1', 'GigabitEthernet0/1', '203.0.113.1', 24)
        .ip('Web', 'GigabitEthernet0', '203.0.113.80', 24)
        .ip('ISP-PC', 'FastEthernet0', '203.0.113.50', 24)
        .gw('PC1', '192.168.1.1')
        .gw('PC2', '192.168.1.1')
        .gw('Web', '203.0.113.1')
        .acl('R1', '1', 'standard', 'permit 192.168.1.0 0.0.0.255')
        .acl('R1', '110', 'extended', 'permit tcp 192.168.1.0 0.0.0.255 any eq 80', 'deny tcp any any eq 22', 'permit icmp any any')
        .nat('R1', (port) => ({ statics: [], overload: { acl: '1', outsideInterfaceId: port('GigabitEthernet0/1') } }))
        .opts('R1', 'GigabitEthernet0/0', { nat: 'inside', aclIn: '110' })
        .opts('R1', 'GigabitEthernet0/1', { nat: 'outside' })
        .done(),
  },
  {
    name: 'RIP: three routers',
    level: 'Intermediate',
    minutes: 25,
    description: 'No static routes. Each router runs RIPv2 and tells its neighbours what it knows, one hop further each time. Open Tables on R1: routes marked R with metric = hop count.',
    topics: ['RIP', 'ARP', 'ICMP'],
    exercises: [{ kind: 'ping', from: 'PC1', to: '10.3.0.10', expect: 'success', why: 'R1 learned 10.3.0.0/24 from R2 with metric 2.' }],
    build: () => threeRouters().rip('R1', [{ prefix: '10.0.0.0', prefixLength: 8 }]).rip('R2', [{ prefix: '10.0.0.0', prefixLength: 8 }]).rip('R3', [{ prefix: '10.0.0.0', prefixLength: 8 }]).done(),
  },
  {
    name: 'OSPF: cheapest path wins',
    level: 'Advanced',
    minutes: 30,
    description: 'Same three routers plus a slow direct serial link R1–R3 next to a fast Gigabit path through R2. RIP would pick the fewest hops; OSPF picks the lowest total cost. Compare R1’s route to 10.3.0.0/24.',
    topics: ['OSPF', 'ARP', 'ICMP'],
    exercises: [{ kind: 'ping', from: 'PC1', to: '10.3.0.10', expect: 'success', why: 'OSPF sends traffic R1 → R2 → R3 (cost 3) rather than the direct serial link (cost 65).' }],
    build: () => {
      const all = [{ prefix: '10.0.0.0', prefixLength: 8 }];
      return threeRouters('ospf').ospf('R1', '1.1.1.1', all).ospf('R2', '2.2.2.2', all).ospf('R3', '3.3.3.3', all).done();
    },
  },
  {
    name: 'IPv6: SLAAC and NDP',
    level: 'Advanced',
    minutes: 25,
    description: 'No IPv4 at all. PC1 builds its own address from R1’s router advertisement (SLAAC) and finds neighbours with NDP multicast instead of ARP broadcast.',
    topics: ['IPv6', 'ICMP'],
    exercises: [
      { kind: 'ping', from: 'PC1', to: '2001:db8:2::10', expect: 'success', why: 'SLAAC gave PC1 an address and R1’s link-local address as its gateway.' },
      { kind: 'ping', from: 'PC1', to: '2001:db8:9::1', expect: 'unreachable', why: 'R1 has no route to 2001:db8:9::/64 and answers ICMPv6 destination unreachable.' },
    ],
    build: () =>
      new Draft()
        .dev('pc', 'PC1', 0, 300)
        .dev('switch', 'S1', 120, 100)
        .dev('router', 'R1', 420, 0)
        .dev('switch', 'S2', 720, 100)
        .dev('server', 'Server1', 840, 300)
        .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
        .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
        .link('R1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1')
        .link('S2', 'FastEthernet0/1', 'Server1', 'GigabitEthernet0')
        .v6('R1', 'GigabitEthernet0/0', '2001:db8:1::1')
        .v6('R1', 'GigabitEthernet0/1', '2001:db8:2::1')
        .opts('PC1', 'FastEthernet0', { ipv6Auto: true })
        .v6('Server1', 'GigabitEthernet0', '2001:db8:2::10')
        .gw6('Server1', '2001:db8:2::1')
        .done(),
  },
];
