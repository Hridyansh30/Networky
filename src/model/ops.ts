// Pure operations on a Topology. Each takes a topology and returns a new one
// (Immer gives us structural sharing, so undo snapshots are cheap).
// They throw TopologyError when an action is impossible, such as a used port.
// Semantic problems that are allowed to exist, like a duplicate IP, are NOT
// errors here: validate.ts reports them, the way a real device lets you
// misconfigure it.

import { produce } from 'immer';
import { nanoid } from 'nanoid';
import { CABLES, CATALOG, cableFits, isHostKind } from './catalog';
import { isValidIPv4, isValidPrefix, networkOf, formatIPv4 } from './ip';
import { isValidIPv6, normalizeIPv6 } from './ip6';
import type {
  Acl,
  CableType,
  Device,
  DeviceKind,
  DhcpPool,
  Interface,
  Ipv4Config,
  NatConfig,
  RoutingNetwork,
  StaticRoute,
  SwitchportConfig,
  Topology,
} from './types';

export class TopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopologyError';
  }
}

export function createTopology(): Topology {
  return { version: 1, devices: {}, interfaces: {}, links: {} };
}

export function randomMac(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  // Set the "locally administered" bit and clear the multicast bit,
  // so a generated MAC can never collide with a real vendor's.
  bytes[0] = (bytes[0] | 0x02) & 0xfe;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(':');
}

function nextHostname(t: Topology, kind: DeviceKind): string {
  const prefix = CATALOG[kind].hostnamePrefix;
  const used = new Set(Object.values(t.devices).map((d) => d.hostname));
  let i = 0;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new TopologyError(`${what} does not exist`);
  return value;
}

export function addDevice(
  t: Topology,
  kind: DeviceKind,
  opts: { id?: string; hostname?: string } = {},
): { topology: Topology; deviceId: string } {
  const template = CATALOG[kind];
  if (!template) throw new TopologyError(`Unknown device kind '${kind}'`);
  const deviceId = opts.id ?? nanoid(10);
  if (t.devices[deviceId]) throw new TopologyError(`Device id '${deviceId}' is already used`);
  const hostname = opts.hostname ?? nextHostname(t, kind);

  const topology = produce(t, (draft) => {
    const interfaceIds: string[] = [];
    for (const port of template.ports) {
      const id = nanoid(10);
      interfaceIds.push(id);
      draft.interfaces[id] = {
        id,
        deviceId,
        name: port.name,
        portType: port.portType,
        mac: randomMac(),
        adminUp: true,
      };
    }
    const device: Device = { id: deviceId, kind, hostname, interfaceIds };
    if (kind === 'router') device.staticRoutes = [];
    draft.devices[deviceId] = device;
  });
  return { topology, deviceId };
}

export function removeDevice(t: Topology, deviceId: string): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  return produce(t, (draft) => {
    for (const ifId of device.interfaceIds) {
      const linkId = draft.interfaces[ifId]?.linkId;
      if (linkId) unlink(draft, linkId);
      delete draft.interfaces[ifId];
    }
    delete draft.devices[deviceId];
  });
}

/** Removes a link and clears linkId on both ends. Works on an Immer draft. */
function unlink(draft: Topology, linkId: string) {
  const link = draft.links[linkId];
  if (!link) return;
  for (const end of [link.a, link.b]) {
    const iface = draft.interfaces[end];
    if (iface) delete iface.linkId;
  }
  delete draft.links[linkId];
}

/** Why a cable can't go between two ports, or null if it can. */
export function connectionProblem(t: Topology, ifA: string, ifB: string, cable: CableType): string | null {
  const a = t.interfaces[ifA];
  const b = t.interfaces[ifB];
  if (!a || !b) return 'Port does not exist';
  if (a.parentId || b.parentId) return 'A subinterface is logical; cable its physical port instead';
  if (ifA === ifB) return 'Cannot connect a port to itself';
  if (a.deviceId === b.deviceId) return 'Cannot connect a device to itself';
  const da = t.devices[a.deviceId];
  const db = t.devices[b.deviceId];
  if (a.linkId) return `${da.hostname} ${a.name} is already connected`;
  if (b.linkId) return `${db.hostname} ${b.name} is already connected`;
  for (const [iface, dev] of [[a, da], [b, db]] as const) {
    if (!cableFits(cable, iface.portType)) {
      return `A ${CABLES[cable].label.toLowerCase()} cable does not fit ${dev.hostname} ${iface.name} (${iface.portType})`;
    }
  }
  return null;
}

export function connect(
  t: Topology,
  ifA: string,
  ifB: string,
  cable: CableType,
  opts: { id?: string } = {},
): { topology: Topology; linkId: string } {
  const problem = connectionProblem(t, ifA, ifB, cable);
  if (problem) throw new TopologyError(problem);
  const linkId = opts.id ?? nanoid(10);
  // The link is stored on three records. Updating them in one produce()
  // keeps them consistent; checkIntegrity() in the tests guards this.
  const topology = produce(t, (draft) => {
    draft.links[linkId] = { id: linkId, a: ifA, b: ifB, cable };
    draft.interfaces[ifA].linkId = linkId;
    draft.interfaces[ifB].linkId = linkId;
  });
  return { topology, linkId };
}

export function disconnect(t: Topology, linkId: string): Topology {
  need(t.links[linkId], `Link '${linkId}'`);
  return produce(t, (draft) => unlink(draft, linkId));
}

export function setHostname(t: Topology, deviceId: string, hostname: string): Topology {
  need(t.devices[deviceId], `Device '${deviceId}'`);
  const name = hostname.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(name)) {
    throw new TopologyError('Hostname must start with a letter and use only letters, digits, - and _');
  }
  return produce(t, (draft) => {
    draft.devices[deviceId].hostname = name;
  });
}

export function setInterfaceIp(t: Topology, interfaceId: string, ipv4: Ipv4Config | undefined): Topology {
  const iface = need(t.interfaces[interfaceId], `Interface '${interfaceId}'`);
  const device = t.devices[iface.deviceId];
  if (ipv4 !== undefined) {
    if (!CATALOG[device.kind].l3) {
      throw new TopologyError(`A ${device.kind} works at layer ${CATALOG[device.kind].layer}; its ports have no IP address`);
    }
    if (!isValidIPv4(ipv4.address)) throw new TopologyError(`'${ipv4.address}' is not a valid IPv4 address`);
    if (!isValidPrefix(ipv4.prefixLength)) throw new TopologyError(`/${ipv4.prefixLength} is not a valid prefix length`);
  }
  return produce(t, (draft) => {
    if (ipv4) draft.interfaces[interfaceId].ipv4 = { ...ipv4 };
    else delete draft.interfaces[interfaceId].ipv4;
  });
}

export function setInterfaceAdmin(t: Topology, interfaceId: string, adminUp: boolean): Topology {
  need(t.interfaces[interfaceId], `Interface '${interfaceId}'`);
  return produce(t, (draft) => {
    draft.interfaces[interfaceId].adminUp = adminUp;
  });
}

export function setDefaultGateway(t: Topology, deviceId: string, gateway: string | undefined): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (!isHostKind(device.kind)) {
    throw new TopologyError('Only PCs and servers have a default gateway; routers use routes');
  }
  if (gateway !== undefined && !isValidIPv4(gateway)) throw new TopologyError(`'${gateway}' is not a valid IPv4 address`);
  return produce(t, (draft) => {
    if (gateway) draft.devices[deviceId].defaultGateway = gateway.trim();
    else delete draft.devices[deviceId].defaultGateway;
  });
}

export function addStaticRoute(t: Topology, deviceId: string, route: StaticRoute): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (device.kind !== 'router') throw new TopologyError('Only routers have static routes');
  if (!isValidIPv4(route.prefix)) throw new TopologyError(`'${route.prefix}' is not a valid network address`);
  if (!isValidPrefix(route.prefixLength)) throw new TopologyError(`/${route.prefixLength} is not a valid prefix length`);
  if (!isValidIPv4(route.nextHop)) throw new TopologyError(`'${route.nextHop}' is not a valid next hop`);
  // Store the canonical network address: '10.0.2.7/24' becomes '10.0.2.0/24',
  // which is what 'ip route' on a real router would show.
  const prefix = formatIPv4(networkOf(route.prefix, route.prefixLength));
  if ((device.staticRoutes ?? []).some((r) => r.prefix === prefix && r.prefixLength === route.prefixLength)) {
    throw new TopologyError(`A route to ${prefix}/${route.prefixLength} already exists`);
  }
  return produce(t, (draft) => {
    const d = draft.devices[deviceId];
    (d.staticRoutes ??= []).push({ prefix, prefixLength: route.prefixLength, nextHop: route.nextHop });
  });
}

export function removeStaticRoute(t: Topology, deviceId: string, index: number): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (!device.staticRoutes?.[index]) throw new TopologyError('Route does not exist');
  return produce(t, (draft) => {
    draft.devices[deviceId].staticRoutes!.splice(index, 1);
  });
}

/** Lists every broken invariant. An empty list means the topology is internally consistent. */
export function checkIntegrity(t: Topology): string[] {
  const problems: string[] = [];
  for (const d of Object.values(t.devices)) {
    for (const ifId of d.interfaceIds) {
      const i = t.interfaces[ifId];
      if (!i) problems.push(`${d.hostname} lists missing interface ${ifId}`);
      else if (i.deviceId !== d.id) problems.push(`${ifId} is listed on ${d.id} but belongs to ${i.deviceId}`);
    }
  }
  for (const i of Object.values(t.interfaces)) {
    if (!t.devices[i.deviceId]) problems.push(`Interface ${i.id} belongs to missing device ${i.deviceId}`);
    if (i.parentId) {
      const parent = t.interfaces[i.parentId];
      if (!parent || parent.deviceId !== i.deviceId) problems.push(`Subinterface ${i.id} has no parent ${i.parentId} on its device`);
      if (i.linkId) problems.push(`Subinterface ${i.id} has a cable`);
    }
    if (i.linkId) {
      const l = t.links[i.linkId];
      if (!l) problems.push(`Interface ${i.id} points at missing link ${i.linkId}`);
      else if (l.a !== i.id && l.b !== i.id) problems.push(`Interface ${i.id} points at link ${l.id}, which does not use it`);
    }
  }
  for (const l of Object.values(t.links)) {
    for (const end of [l.a, l.b]) {
      const i = t.interfaces[end];
      if (!i) problems.push(`Link ${l.id} uses missing interface ${end}`);
      else if (i.linkId !== l.id) problems.push(`Link ${l.id} uses ${end}, but that interface says linkId=${i.linkId}`);
    }
  }
  return problems;
}

/** Small read helpers shared by the UI and validate.ts */
export function deviceOfInterface(t: Topology, interfaceId: string): Device | undefined {
  const i = t.interfaces[interfaceId];
  return i ? t.devices[i.deviceId] : undefined;
}

export function peerInterfaceId(t: Topology, interfaceId: string): string | undefined {
  const i = t.interfaces[interfaceId];
  const l = i?.linkId ? t.links[i.linkId] : undefined;
  if (!l) return undefined;
  return l.a === interfaceId ? l.b : l.a;
}

// ============================================================== phase 3 ops

const VLAN_MIN = 1;
const VLAN_MAX = 4094;
const isVlan = (v: number) => Number.isInteger(v) && v >= VLAN_MIN && v <= VLAN_MAX;

export const DEFAULT_SWITCHPORT: SwitchportConfig = { mode: 'access', accessVlan: 1, nativeVlan: 1 };

export function switchportOf(i: Interface): SwitchportConfig {
  return i.switchport ?? DEFAULT_SWITCHPORT;
}

export function setSwitchport(t: Topology, interfaceId: string, sp: SwitchportConfig): Topology {
  const iface = need(t.interfaces[interfaceId], `Interface '${interfaceId}'`);
  if (t.devices[iface.deviceId].kind !== 'switch') throw new TopologyError('Only switch ports have a switchport mode');
  if (!isVlan(sp.accessVlan) || !isVlan(sp.nativeVlan)) throw new TopologyError(`VLAN ids run from ${VLAN_MIN} to ${VLAN_MAX}`);
  if (sp.allowedVlans && !sp.allowedVlans.every(isVlan)) throw new TopologyError(`VLAN ids run from ${VLAN_MIN} to ${VLAN_MAX}`);
  return produce(t, (draft) => {
    const clean: SwitchportConfig = { mode: sp.mode, accessVlan: sp.accessVlan, nativeVlan: sp.nativeVlan };
    if (sp.mode === 'trunk' && sp.allowedVlans) clean.allowedVlans = [...new Set(sp.allowedVlans)].sort((a, b) => a - b);
    draft.interfaces[interfaceId].switchport = clean;
  });
}

/**
 * 'interface Gi0/0.10' + 'encapsulation dot1Q 10'. The subinterface NUMBER
 * (after the dot) is only a name; the VLAN comes from the encapsulation.
 * They are usually equal by convention, so `number` defaults to `vlan`.
 */
export function addSubinterface(t: Topology, parentId: string, vlan: number, number: number = vlan): { topology: Topology; interfaceId: string } {
  const parent = need(t.interfaces[parentId], `Interface '${parentId}'`);
  const device = t.devices[parent.deviceId];
  if (device.kind !== 'router') throw new TopologyError('Only routers have subinterfaces');
  if (parent.parentId) throw new TopologyError('A subinterface cannot have subinterfaces');
  if (parent.portType === 'serial') throw new TopologyError('802.1Q subinterfaces need an Ethernet port');
  if (!isVlan(vlan)) throw new TopologyError(`VLAN ids run from ${VLAN_MIN} to ${VLAN_MAX}`);
  if (device.interfaceIds.some((id) => t.interfaces[id].parentId === parentId && t.interfaces[id].vlanTag === vlan)) {
    throw new TopologyError(`${parent.name} already has a subinterface for VLAN ${vlan}`);
  }
  if (!Number.isInteger(number) || number < 1 || number > 4294967295) throw new TopologyError('Subinterface numbers are 1 to 4294967295');
  const name = `${parent.name}.${number}`;
  if (device.interfaceIds.some((id) => t.interfaces[id].name === name)) throw new TopologyError(`${name} already exists`);
  const interfaceId = nanoid(10);
  const topology = produce(t, (draft) => {
    draft.interfaces[interfaceId] = {
      id: interfaceId,
      deviceId: device.id,
      name,
      portType: parent.portType,
      mac: parent.mac, // subinterfaces share the physical MAC, as on real routers
      adminUp: true,
      parentId,
      vlanTag: vlan,
    };
    draft.devices[device.id].interfaceIds.push(interfaceId);
  });
  return { topology, interfaceId };
}

export function removeSubinterface(t: Topology, interfaceId: string): Topology {
  const iface = need(t.interfaces[interfaceId], `Interface '${interfaceId}'`);
  if (!iface.parentId) throw new TopologyError('Only subinterfaces can be removed; physical ports are part of the device');
  return produce(t, (draft) => {
    const d = draft.devices[iface.deviceId];
    d.interfaceIds = d.interfaceIds.filter((id) => id !== interfaceId);
    delete draft.interfaces[interfaceId];
  });
}

/** The physical port a (sub)interface sends through. */
export function physicalOf(t: Topology, interfaceId: string): Interface {
  const i = t.interfaces[interfaceId];
  return i.parentId ? t.interfaces[i.parentId] : i;
}

export interface InterfacePatch {
  dhcp?: boolean;
  ipv6?: { address: string; prefixLength: number } | null;
  ipv6Auto?: boolean;
  aclIn?: string | null;
  aclOut?: string | null;
  nat?: 'inside' | 'outside' | null;
  helperAddress?: string | null;
  ospfCost?: number | null;
}

/** Sets phase 3 interface options. `null` clears a field. */
export function setInterfaceOptions(t: Topology, interfaceId: string, patch: InterfacePatch): Topology {
  const iface = need(t.interfaces[interfaceId], `Interface '${interfaceId}'`);
  const kind = t.devices[iface.deviceId].kind;
  const isHost = isHostKind(kind);
  const isRouter = kind === 'router';
  if ((patch.dhcp !== undefined || patch.ipv6Auto !== undefined) && !isHost) throw new TopologyError('Only end devices (PC, laptop, server) are DHCP or SLAAC clients');
  if ((patch.aclIn || patch.aclOut || patch.nat || patch.helperAddress || patch.ospfCost) && !isRouter) {
    throw new TopologyError('ACLs, NAT, DHCP relay and OSPF cost are router interface settings');
  }
  if (patch.ipv6 && !CATALOG[kind].l3) throw new TopologyError(`A ${kind} has no IPv6 address`);
  let ipv6: { address: string; prefixLength: number } | null | undefined = patch.ipv6;
  if (ipv6) {
    const address = normalizeIPv6(ipv6.address);
    if (!address) throw new TopologyError(`'${ipv6.address}' is not a valid IPv6 address`);
    if (!Number.isInteger(ipv6.prefixLength) || ipv6.prefixLength < 1 || ipv6.prefixLength > 128) throw new TopologyError('IPv6 prefix length must be 1 to 128');
    ipv6 = { address, prefixLength: ipv6.prefixLength };
  }
  if (patch.helperAddress && !isValidIPv4(patch.helperAddress)) throw new TopologyError(`'${patch.helperAddress}' is not a valid helper address`);
  if (patch.ospfCost != null && (!Number.isInteger(patch.ospfCost) || patch.ospfCost < 1 || patch.ospfCost > 65535)) {
    throw new TopologyError('OSPF cost must be 1 to 65535');
  }
  return produce(t, (draft) => {
    const d = draft.interfaces[interfaceId] as unknown as Record<string, unknown>;
    const p = { ...patch, ipv6 } as Record<string, unknown>;
    for (const [key, value] of Object.entries(p)) {
      if (value === undefined) continue;
      if (value === null || value === false || value === '') delete d[key];
      else d[key] = value;
    }
    if (patch.dhcp) delete d.ipv4; // a DHCP client's address comes from the server
    if (patch.ipv6Auto) delete d.ipv6;
  });
}

function checkWildcard(w: string) {
  const n = parseIPv4Strict(w);
  // A wildcard is an inverted mask: its 1 bits must be contiguous at the right.
  if (n === null || ((n + 1) & n) !== 0) throw new TopologyError(`'${w}' is not a valid wildcard mask`);
}

function parseIPv4Strict(s: string): number | null {
  if (!isValidIPv4(s)) return null;
  return s.split('.').reduce((acc, o) => acc * 256 + Number(o), 0) >>> 0;
}

export function setAcl(t: Topology, deviceId: string, name: string, acl: Acl | null): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (device.kind !== 'router') throw new TopologyError('Only routers have access lists');
  const n = name.trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(n)) throw new TopologyError('ACL names use letters, digits, - and _');
  if (acl) {
    if (/^\d+$/.test(n)) {
      const num = Number(n);
      const expected = num >= 1 && num <= 99 ? 'standard' : num >= 100 && num <= 199 ? 'extended' : null;
      if (!expected) throw new TopologyError('Numbered ACLs are 1-99 (standard) or 100-199 (extended)');
      if (expected !== acl.type) throw new TopologyError(`ACL ${n} is a${expected === 'extended' ? 'n' : ''} ${expected} ACL by its number`);
    }
    for (const r of acl.rules) {
      if (!isValidIPv4(r.src)) throw new TopologyError(`'${r.src}' is not a valid source address`);
      checkWildcard(r.srcWildcard);
      if (acl.type === 'standard' && (r.dst || r.protocol !== 'ip')) throw new TopologyError('A standard ACL matches the source address only');
      if (acl.type === 'extended') {
        if (!r.dst || !isValidIPv4(r.dst)) throw new TopologyError('An extended rule needs a destination');
        checkWildcard(r.dstWildcard ?? '');
        if (r.dstPort !== undefined && (r.protocol === 'ip' || r.protocol === 'icmp')) throw new TopologyError('Only tcp and udp rules can match a port');
        if (r.dstPort !== undefined && (!Number.isInteger(r.dstPort) || r.dstPort < 1 || r.dstPort > 65535)) throw new TopologyError('Port must be 1-65535');
      }
    }
  }
  return produce(t, (draft) => {
    const d = draft.devices[deviceId];
    d.acls ??= {};
    if (acl) d.acls[n] = { type: acl.type, rules: acl.rules.map((r) => ({ ...r })) };
    else delete d.acls[n];
  });
}

export function setDhcpPools(t: Topology, deviceId: string, pools: DhcpPool[]): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (device.kind !== 'router' && device.kind !== 'server') throw new TopologyError('Only routers and servers run a DHCP server');
  const names = new Set<string>();
  for (const p of pools) {
    if (!p.name.trim()) throw new TopologyError('A DHCP pool needs a name');
    if (names.has(p.name)) throw new TopologyError(`Two pools are named '${p.name}'`);
    names.add(p.name);
    if (!isValidIPv4(p.network) || !isValidPrefix(p.prefixLength) || p.prefixLength > 30) throw new TopologyError(`Pool ${p.name}: network must be like 192.168.10.0/24 (at most /30)`);
    if (p.defaultRouter && !isValidIPv4(p.defaultRouter)) throw new TopologyError(`Pool ${p.name}: bad default router`);
    if (p.dnsServer && !isValidIPv4(p.dnsServer)) throw new TopologyError(`Pool ${p.name}: bad DNS server`);
    for (const x of p.excluded ?? []) if (!isValidIPv4(x)) throw new TopologyError(`Pool ${p.name}: bad excluded address '${x}'`);
  }
  return produce(t, (draft) => {
    const d = draft.devices[deviceId];
    if (pools.length) d.dhcpPools = pools.map((p) => ({ ...p, network: formatIPv4(networkOf(p.network, p.prefixLength)) }));
    else delete d.dhcpPools;
  });
}

export function setNat(t: Topology, deviceId: string, nat: NatConfig | null): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (device.kind !== 'router') throw new TopologyError('Only routers do NAT');
  if (nat) {
    for (const s of nat.statics) if (!isValidIPv4(s.local) || !isValidIPv4(s.global)) throw new TopologyError('Static NAT needs a valid inside local and inside global address');
    if (nat.overload) {
      const out = t.interfaces[nat.overload.outsideInterfaceId];
      if (!out || out.deviceId !== deviceId) throw new TopologyError('PAT needs an outside interface on this router');
      if (!nat.overload.acl.trim()) throw new TopologyError('PAT needs an ACL that selects the inside addresses');
    }
  }
  return produce(t, (draft) => {
    if (nat && (nat.statics.length || nat.overload)) draft.devices[deviceId].nat = { statics: nat.statics.map((x) => ({ ...x })), ...(nat.overload ? { overload: { ...nat.overload } } : {}) };
    else delete draft.devices[deviceId].nat;
  });
}

function checkNetworks(networks: RoutingNetwork[]) {
  for (const n of networks) {
    if (!isValidIPv4(n.prefix) || !isValidPrefix(n.prefixLength)) throw new TopologyError(`'${n.prefix}/${n.prefixLength}' is not a valid network`);
  }
}

export function setRip(t: Topology, deviceId: string, networks: RoutingNetwork[] | null): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (device.kind !== 'router') throw new TopologyError('Only routers run RIP');
  if (networks) checkNetworks(networks);
  return produce(t, (draft) => {
    if (networks) draft.devices[deviceId].rip = { networks: networks.map((n) => ({ prefix: formatIPv4(networkOf(n.prefix, n.prefixLength)), prefixLength: n.prefixLength })) };
    else delete draft.devices[deviceId].rip;
  });
}

export function setOspf(
  t: Topology,
  deviceId: string,
  ospf: { routerId?: string; networks: (RoutingNetwork & { area: number })[] } | null,
): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (device.kind !== 'router') throw new TopologyError('Only routers run OSPF');
  if (ospf) {
    checkNetworks(ospf.networks);
    if (ospf.routerId && !isValidIPv4(ospf.routerId)) throw new TopologyError('A router ID looks like an IPv4 address, e.g. 1.1.1.1');
    for (const n of ospf.networks) if (!Number.isInteger(n.area) || n.area < 0) throw new TopologyError('OSPF area must be a whole number');
  }
  return produce(t, (draft) => {
    if (ospf) {
      draft.devices[deviceId].ospf = {
        ...(ospf.routerId ? { routerId: ospf.routerId } : {}),
        networks: ospf.networks.map((n) => ({ prefix: formatIPv4(networkOf(n.prefix, n.prefixLength)), prefixLength: n.prefixLength, area: n.area })),
      };
    } else delete draft.devices[deviceId].ospf;
  });
}

export function setStpPriority(t: Topology, deviceId: string, priority: number): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (device.kind !== 'switch') throw new TopologyError('Only switches run STP');
  if (!Number.isInteger(priority) || priority < 0 || priority > 61440 || priority % 4096 !== 0) {
    throw new TopologyError('STP priority must be a multiple of 4096 from 0 to 61440');
  }
  return produce(t, (draft) => {
    draft.devices[deviceId].stpPriority = priority;
  });
}

export function setDefaultGatewayV6(t: Topology, deviceId: string, gateway: string | undefined): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (!isHostKind(device.kind)) throw new TopologyError('Only end devices have a default gateway');
  if (gateway && !isValidIPv6(gateway)) throw new TopologyError(`'${gateway}' is not a valid IPv6 address`);
  return produce(t, (draft) => {
    if (gateway) draft.devices[deviceId].defaultGatewayV6 = normalizeIPv6(gateway)!;
    else delete draft.devices[deviceId].defaultGatewayV6;
  });
}

export function addIpv6StaticRoute(t: Topology, deviceId: string, route: StaticRoute): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (device.kind !== 'router') throw new TopologyError('Only routers have static routes');
  const prefix = normalizeIPv6(route.prefix);
  const nextHop = normalizeIPv6(route.nextHop);
  if (!prefix) throw new TopologyError(`'${route.prefix}' is not a valid IPv6 prefix`);
  if (!nextHop) throw new TopologyError(`'${route.nextHop}' is not a valid IPv6 next hop`);
  if (!Number.isInteger(route.prefixLength) || route.prefixLength < 0 || route.prefixLength > 128) throw new TopologyError('Prefix length must be 0-128');
  return produce(t, (draft) => {
    (draft.devices[deviceId].ipv6StaticRoutes ??= []).push({ prefix, prefixLength: route.prefixLength, nextHop });
  });
}

export function removeIpv6StaticRoute(t: Topology, deviceId: string, index: number): Topology {
  const device = need(t.devices[deviceId], `Device '${deviceId}'`);
  if (!device.ipv6StaticRoutes?.[index]) throw new TopologyError('Route does not exist');
  return produce(t, (draft) => {
    draft.devices[deviceId].ipv6StaticRoutes!.splice(index, 1);
  });
}
