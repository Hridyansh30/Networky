// Runtime tables of one device, as plain data: the single source for both the
// inspector's Tables tab (rendered as HTML) and the CLI's show commands
// (rendered as IOS-style text). One function per table; tablesFor() picks the
// ones that make sense for a device.

import { isHostKind } from '../model/catalog';
import { formatIPv4, prefixToMask } from '../model/ip';
import { switchportOf } from '../model/ops';
import type { Device, Interface } from '../model/types';
import { aclHits } from '../engine/plugins/acl';
import { bindingsOf, leasesOf } from '../engine/plugins/dhcp';
import { globalOf, ipv6Enabled, linkLocalOf, neighborsOf, routesV6 } from '../engine/plugins/ipv6';
import { translationsOf } from '../engine/plugins/nat';
import { ospfOf, routerIdOf } from '../engine/plugins/ospf';
import { formatBridge, portCost, stpOf } from '../engine/plugins/stp';
import { formatRule } from '../model/acl';
import type { Simulation } from '../engine/simulation';

export interface DataTable {
  id: string;
  title: string;
  /** The IOS command that shows the same thing. */
  command: string;
  headers: string[];
  rows: string[][];
  empty: string;
  /** Extra lines shown above the table (e.g. STP root info). */
  notes?: string[];
}

const ifName = (sim: Simulation, id: string | undefined) => (id ? (sim.topology.interfaces[id]?.name ?? '?') : '');
const ifsOf = (sim: Simulation, d: Device) => d.interfaceIds.map((id) => sim.topology.interfaces[id]).filter(Boolean);
const has = (sim: Simulation, name: string) => !!sim.plugin(name);

/** Cisco writes MACs as 0001.4296.a21b */
export const ciscoMac = (mac: string) => mac.replace(/:/g, '').replace(/(.{4})(?=.)/g, '$1.');

export function interfaceStatus(sim: Simulation, i: Interface): { status: string; protocol: string } {
  const phys = i.parentId ? sim.topology.interfaces[i.parentId] : i;
  if (!i.adminUp || !phys.adminUp) return { status: 'administratively down', protocol: 'down' };
  if (!phys.linkId) return { status: 'down', protocol: 'down' };
  return sim.isUp(i) ? { status: 'up', protocol: 'up' } : { status: 'up', protocol: 'down' };
}

export function interfacesBrief(sim: Simulation, d: Device): DataTable {
  return {
    id: 'interfaces',
    title: 'Interfaces',
    command: 'show ip interface brief',
    headers: ['Interface', 'IP-Address', 'Method', 'Status', 'Protocol'],
    rows: ifsOf(sim, d).map((i) => {
      const ip = sim.ipv4Of(i);
      const st = interfaceStatus(sim, i);
      return [i.name, ip ? ip.address : 'unassigned', i.dhcp ? 'DHCP' : ip ? 'manual' : 'unset', st.status, st.protocol];
    }),
    empty: 'No interfaces',
  };
}

export function routeTable(sim: Simulation, d: Device): DataTable {
  return {
    id: 'routes',
    title: 'IPv4 routing table',
    command: 'show ip route',
    headers: ['Code', 'Network', 'AD/Metric', 'Next hop', 'Interface'],
    rows: sim.routes(d.id).map((r) => [r.code, `${r.network}/${r.prefixLength}`, r.code === 'C' ? '—' : `${r.ad}/${r.metric}`, r.nextHop ?? 'directly connected', ifName(sim, r.interfaceId)]),
    empty: 'No routes: give the interfaces IP addresses',
  };
}

export function arpTable(sim: Simulation, d: Device): DataTable {
  return {
    id: 'arp',
    title: 'ARP table',
    command: isHostKind(d.kind) ? 'arp -a' : 'show arp',
    headers: ['IP address', 'MAC address', 'Interface', 'Learned at'],
    rows: Object.entries(sim.arp[d.id] ?? {}).map(([ip, e]) => [ip, e.mac, ifName(sim, e.interfaceId), `t=${e.learnedAt}`]),
    empty: 'Empty: ARP fills up as the device talks to neighbours',
  };
}

export function macTable(sim: Simulation, d: Device): DataTable {
  return {
    id: 'mac',
    title: 'MAC address table',
    command: 'show mac address-table',
    headers: ['VLAN', 'MAC address', 'Port', 'Learned at'],
    rows: Object.values(sim.mac[d.id] ?? {})
      .sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac))
      .map((e) => [String(e.vlan), e.mac, ifName(sim, e.interfaceId), `t=${e.learnedAt}`]),
    empty: 'Empty: the switch learns source MACs as frames arrive',
  };
}

export function vlanTable(sim: Simulation, d: Device): DataTable {
  const byVlan = new Map<number, string[]>([[1, []]]);
  const trunks: string[] = [];
  for (const i of ifsOf(sim, d)) {
    const sp = switchportOf(i);
    if (sp.mode === 'trunk') trunks.push(i.name);
    else byVlan.set(sp.accessVlan, [...(byVlan.get(sp.accessVlan) ?? []), i.name]);
  }
  return {
    id: 'vlans',
    title: 'VLANs',
    command: 'show vlan brief',
    headers: ['VLAN', 'Name', 'Access ports'],
    rows: [...byVlan].sort((a, b) => a[0] - b[0]).map(([v, ports]) => [String(v), v === 1 ? 'default' : `VLAN${String(v).padStart(4, '0')}`, ports.join(', ') || '—']),
    notes: trunks.length ? [`Trunks (carry many VLANs, tagged): ${trunks.join(', ')}`] : undefined,
    empty: '',
  };
}

export function stpTable(sim: Simulation, d: Device): DataTable {
  const s = stpOf(sim, d);
  const isRoot = s.root.mac === s.bridge.mac && s.root.priority === s.bridge.priority;
  const role = { root: 'Root', designated: 'Desg', alternate: 'Altn', disabled: 'Disabled' } as const;
  return {
    id: 'stp',
    title: 'Spanning tree',
    command: 'show spanning-tree',
    notes: [
      `Root bridge: ${formatBridge(s.root)}${isRoot ? '  (this switch is the root)' : `, cost ${s.rootCost} via ${ifName(sim, s.rootPortId)}`}`,
      `This bridge: ${formatBridge(s.bridge)}`,
    ],
    headers: ['Interface', 'Role', 'State', 'Cost'],
    rows: ifsOf(sim, d)
      .filter((i) => i.linkId)
      .map((i) => {
        const r = s.roles[i.id] ?? 'designated';
        return [i.name, role[r], r === 'alternate' ? 'BLK' : r === 'disabled' ? '—' : 'FWD', String(portCost(i))];
      }),
    empty: 'No cabled ports',
  };
}

export function natTable(sim: Simulation, d: Device): DataTable {
  return {
    id: 'nat',
    title: 'NAT translations',
    command: 'show ip nat translations',
    headers: ['Proto', 'Inside global', 'Inside local', 'Outside', 'Hits'],
    rows: translationsOf(sim, d.id).map((x) => [
      x.kind === 'static' ? '---' : x.protocol,
      x.insideGlobal + (x.globalPort !== undefined ? `:${x.globalPort}` : ''),
      x.insideLocal + (x.localPort !== undefined ? `:${x.localPort}` : ''),
      x.outside ?? '---',
      String(x.hits),
    ]),
    empty: 'No translations yet: send traffic from an inside host',
  };
}

export function aclTable(sim: Simulation, d: Device): DataTable {
  const rows: string[][] = [];
  for (const [name, acl] of Object.entries(d.acls ?? {})) {
    const hits = aclHits(sim, d.id, name);
    acl.rules.forEach((r, k) => rows.push([name, String((k + 1) * 10), formatRule(r, acl.type), String(hits[k] ?? 0)]));
    rows.push([name, '—', 'deny any (implicit)', String(hits[acl.rules.length] ?? 0)]);
  }
  return { id: 'acl', title: 'Access lists', command: 'show access-lists', headers: ['ACL', 'Seq', 'Rule', 'Matches'], rows, empty: 'No access lists' };
}

export function ospfNeighbors(sim: Simulation, d: Device): DataTable {
  const s = ospfOf(sim, d);
  const rows = Object.values(s.neighbors).flatMap((byId) => Object.values(byId).map((n) => [n.routerId, n.state === 'full' ? 'FULL' : 'INIT', n.ip, ifName(sim, n.interfaceId)]));
  return {
    id: 'ospf',
    title: 'OSPF neighbours',
    command: 'show ip ospf neighbor',
    notes: [`Router ID ${routerIdOf(sim, d)}; ${Object.keys(s.lsdb).length} router LSA(s) in the link-state database`],
    headers: ['Neighbor ID', 'State', 'Address', 'Interface'],
    rows,
    empty: 'No neighbours: OSPF must run on both ends of a link, in the same area and subnet',
  };
}

export function dhcpBindings(sim: Simulation, d: Device): DataTable {
  return {
    id: 'dhcp',
    title: 'DHCP bindings',
    command: 'show ip dhcp binding',
    headers: ['IP address', 'Client MAC', 'Pool', 'State'],
    rows: bindingsOf(sim, d.id).map((b) => [b.ip, b.mac, b.pool, b.state]),
    empty: 'No leases handed out',
  };
}

export function hostIpConfig(sim: Simulation, d: Device): DataTable {
  const rows: string[][] = [];
  for (const i of ifsOf(sim, d)) {
    const ip = sim.ipv4Of(i);
    const lease = leasesOf(sim)[i.id];
    rows.push([i.name, ip ? `${ip.address}/${ip.prefixLength}` : i.dhcp ? 'waiting for DHCP' : '—', (lease?.router ?? d.defaultGateway) || '—', i.dhcp ? (lease ? `DHCP from ${lease.server}` : 'DHCP (no lease)') : 'static']);
  }
  return { id: 'ipconfig', title: 'IP configuration', command: 'ipconfig', headers: ['Interface', 'IPv4', 'Gateway', 'Source'], rows, empty: '' };
}

export function ipv6Table(sim: Simulation, d: Device): DataTable {
  const rows = ifsOf(sim, d)
    .filter((i) => ipv6Enabled(sim, i))
    .map((i) => {
      const g = globalOf(sim, i);
      return [i.name, g ? `${g.address}/${g.prefixLength}` : '—', linkLocalOf(i), i.ipv6Auto ? 'SLAAC' : 'manual'];
    });
  return { id: 'ipv6', title: 'IPv6 addresses', command: 'show ipv6 interface brief', headers: ['Interface', 'Global', 'Link-local', 'Method'], rows, empty: 'No IPv6 addresses' };
}

export function ipv6Routes(sim: Simulation, d: Device): DataTable {
  return {
    id: 'ipv6routes',
    title: 'IPv6 routing table',
    command: 'show ipv6 route',
    headers: ['Code', 'Prefix', 'Next hop', 'Interface'],
    rows: routesV6(sim, d).map((r) => [r.code, `${r.network}/${r.prefixLength}`, r.nextHop ?? 'directly connected', ifName(sim, r.interfaceId)]),
    empty: 'No IPv6 routes',
  };
}

export function ipv6Neighbors(sim: Simulation, d: Device): DataTable {
  return {
    id: 'ndp',
    title: 'IPv6 neighbours (NDP)',
    command: 'show ipv6 neighbors',
    headers: ['IPv6 address', 'MAC address', 'Interface'],
    rows: Object.entries(neighborsOf(sim, d.id)).map(([ip, n]) => [ip, n.mac, ifName(sim, n.interfaceId)]),
    empty: 'Empty: NDP fills this as the device talks IPv6',
  };
}

/** The tables that apply to this device, in display order. */
export function tablesFor(sim: Simulation, d: Device): DataTable[] {
  const v6 = has(sim, 'ipv6') && ifsOf(sim, d).some((i) => ipv6Enabled(sim, i));
  switch (d.kind) {
    case 'hub':
      return [];
    case 'switch':
      return [macTable(sim, d), vlanTable(sim, d), ...(has(sim, 'stp') ? [stpTable(sim, d)] : [])];
    case 'router':
      return [
        routeTable(sim, d),
        arpTable(sim, d),
        interfacesBrief(sim, d),
        ...(has(sim, 'ospf') && d.ospf ? [ospfNeighbors(sim, d)] : []),
        ...(has(sim, 'nat') && d.nat ? [natTable(sim, d)] : []),
        ...(has(sim, 'acl') && Object.keys(d.acls ?? {}).length ? [aclTable(sim, d)] : []),
        ...(has(sim, 'dhcp') && d.dhcpPools?.length ? [dhcpBindings(sim, d)] : []),
        ...(v6 ? [ipv6Table(sim, d), ipv6Routes(sim, d), ipv6Neighbors(sim, d)] : []),
      ];
    default:
      return [
        hostIpConfig(sim, d),
        arpTable(sim, d),
        ...(has(sim, 'dhcp') && d.dhcpPools?.length ? [dhcpBindings(sim, d)] : []),
        ...(v6 ? [ipv6Table(sim, d), ipv6Neighbors(sim, d)] : []),
      ];
  }
}

export { prefixToMask, formatIPv4 };
