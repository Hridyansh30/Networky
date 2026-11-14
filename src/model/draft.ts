// A fluent builder for networks written in code: the sample labs and the
// built-in problems. It uses the same model ops as the UI, so whatever it
// builds is a topology the model accepts.
//
// Two id modes:
//  - default: random ids, like devices dragged onto the canvas (the labs).
//  - { stableIds: true }: a device's id is its hostname, and interface ids,
//    link ids and MACs come from a seeded IdSource (model/ids.ts). Problems
//    use this, so every build of a problem is byte-identical (the browser and
//    the phase 6 judge build the same network) and one static layout
//    (ProblemSpec.layout) fits every variant.

import { parseRule } from './acl';
import {
  addDevice,
  addIpv6StaticRoute,
  addSubinterface,
  addStaticRoute,
  connect,
  createTopology,
  setAcl,
  setDefaultGateway,
  setDefaultGatewayV6,
  setDhcpPools,
  setInterfaceAdmin,
  setInterfaceIp,
  setInterfaceOptions,
  setNat,
  setOspf,
  setRip,
  setStpPriority,
  setSwitchport,
  type InterfacePatch,
} from './ops';
import { randomIds, seededIds, type IdSource } from './ids';
import { servicesOf, setDnsServer, setServices, type ServicesConfig } from './services';
import type { Acl, CableType, DeviceKind, DhcpPool, Layout, NatConfig, RoutingNetwork } from './types';

export class Draft {
  t = createTopology();
  layout: Layout = {};
  private byName: Record<string, string> = {};
  /** Seeded for stable builds, random otherwise. */
  private readonly source: IdSource;
  constructor(private readonly ids: { stableIds?: boolean; seed?: string } = {}) {
    this.source = ids.stableIds ? seededIds(ids.seed ?? 'networky') : randomIds;
  }

  dev(kind: DeviceKind, name: string, x: number, y: number) {
    const r = addDevice(this.t, kind, { hostname: name, id: this.ids.stableIds ? name : undefined, ids: this.source });
    this.t = r.topology;
    this.byName[name] = r.deviceId;
    // Lab coordinates are written on a compact grid; spread them out so
    // cables are long enough to show port labels and moving packets.
    this.layout[r.deviceId] = { x: Math.round(x * 1.2), y: Math.round(y * 1.5) };
    return this;
  }
  private port(name: string, port: string) {
    const d = this.t.devices[this.byName[name]];
    return d.interfaceIds.find((i) => this.t.interfaces[i].name === port)!;
  }
  link(a: string, ap: string, b: string, bp: string, cable: CableType = 'copper-straight') {
    this.t = connect(this.t, this.port(a, ap), this.port(b, bp), cable, { ids: this.source }).topology;
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
    const r = addSubinterface(this.t, this.port(router, port), vlan, vlan, this.source);
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
  /** `no shutdown` / `shutdown` on a port. */
  admin(name: string, port: string, up: boolean) {
    this.t = setInterfaceAdmin(this.t, this.port(name, port), up);
    return this;
  }
  route6(name: string, prefix: string, prefixLength: number, nextHop: string) {
    this.t = addIpv6StaticRoute(this.t, this.byName[name], { prefix, prefixLength, nextHop });
    return this;
  }
  /** The DNS server a host asks. */
  dns(name: string, server: string) {
    this.t = setDnsServer(this.t, this.byName[name], server);
    return this;
  }
  /** Change a host's services, starting from what it runs now (a server's defaults included). */
  services(name: string, change: (now: ServicesConfig) => ServicesConfig) {
    const id = this.byName[name];
    this.t = setServices(this.t, id, change(structuredClone(servicesOf(this.t.devices[id]))));
    return this;
  }
  done() {
    return { topology: this.t, layout: this.layout };
  }
}