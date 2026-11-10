// 'show' commands. Each one formats a DataTable from inspect/tables.ts as
// IOS-style text, so the CLI and the Tables tab can never disagree.

import { prefixToMask } from '../model/ip';
import { ciscoMac, interfaceStatus, type DataTable, aclTable, arpTable, dhcpBindings, interfacesBrief, ipv6Neighbors, ipv6Routes, ipv6Table, macTable, natTable, ospfNeighbors, stpTable, vlanTable } from '../inspect/tables';
import { switchportOf } from '../model/ops';
import type { Command, RunContext } from './ios';
import { table } from './parse';

const EXEC = ['user', 'exec'] as const;

const asText = (d: DataTable) => [...(d.notes ?? []), ...(d.rows.length ? table(d.headers, d.rows) : [d.empty])];

function show(words: string[], help: string, kinds: Command['kinds'], render: (c: RunContext) => string[]): Command {
  return { modes: [...EXEC], words: ['show', ...words], help, kinds, run: (c) => void c.out.push(...render(c)) };
}

const sim = (c: RunContext) => c.env.sim();

function ipRoute(c: RunContext): string[] {
  const routes = sim(c).routes(c.device.id);
  const def = routes.find((r) => r.prefixLength === 0);
  const lines = [
    'Codes: C - connected, S - static, R - RIP, O - OSPF, * - candidate default',
    '',
    def ? `Gateway of last resort is ${def.nextHop ?? '0.0.0.0'} to network 0.0.0.0` : 'Gateway of last resort is not set',
    '',
  ];
  const ifn = (id: string) => c.env.topology().interfaces[id]?.name ?? '?';
  for (const r of routes) {
    const code = (r.code + (r.prefixLength === 0 ? '*' : '')).padEnd(5);
    const net = `${r.network}/${r.prefixLength}`;
    if (r.code === 'C') lines.push(`${code}${net} is directly connected, ${ifn(r.interfaceId)}`);
    else lines.push(`${code}${net} [${r.ad}/${r.metric}] via ${r.nextHop}${r.code === 'S' ? '' : `, ${ifn(r.interfaceId)}`}`);
  }
  return lines;
}

function arp(c: RunContext): string[] {
  const t = c.env.topology();
  const rows: string[][] = [];
  // a router lists its own addresses too, with age '-'
  for (const id of c.device.interfaceIds) {
    const i = t.interfaces[id];
    const ip = sim(c).ipv4Of(i);
    if (ip && i.linkId !== undefined) rows.push(['Internet', ip.address, '-', ciscoMac(i.mac), 'ARPA', i.name]);
  }
  for (const [ip, e] of Object.entries(sim(c).arp[c.device.id] ?? {})) {
    rows.push(['Internet', ip, String(Math.max(0, Math.floor((sim(c).tick - e.learnedAt) / 60))), ciscoMac(e.mac), 'ARPA', t.interfaces[e.interfaceId]?.name ?? '']);
  }
  return table(['Protocol', 'Address', 'Age (min)', 'Hardware Addr', 'Type', 'Interface'], rows);
}

function macAddressTable(c: RunContext): string[] {
  const d = macTable(sim(c), c.device);
  return ['          Mac Address Table', '-------------------------------------------', '', ...table(['Vlan', 'Mac Address', 'Type', 'Ports'], d.rows.map((r) => [r[0], ciscoMac(r[1]), 'DYNAMIC', r[2]]))];
}

function trunks(c: RunContext): string[] {
  const t = c.env.topology();
  const tr = c.device.interfaceIds.map((id) => t.interfaces[id]).filter((i) => switchportOf(i).mode === 'trunk');
  if (!tr.length) return ['No trunk ports'];
  return table(['Port', 'Mode', 'Encapsulation', 'Status', 'Native vlan', 'Vlans allowed'], tr.map((i) => {
    const sp = switchportOf(i);
    return [i.name, 'on', '802.1q', interfaceStatus(sim(c), i).protocol === 'up' ? 'trunking' : 'not-trunking', String(sp.nativeVlan), sp.allowedVlans?.join(',') ?? '1-4094'];
  }));
}

function accessLists(c: RunContext): string[] {
  const d = aclTable(sim(c), c.device);
  const out: string[] = [];
  for (const [name, acl] of Object.entries(c.device.acls ?? {})) {
    const kind = acl.type === 'standard' ? 'Standard' : 'Extended';
    out.push(`${kind} IP access list ${name}`);
    for (const r of d.rows.filter((x) => x[0] === name && x[1] !== '—')) out.push(`    ${r[1]} ${r[2]}${r[3] !== '0' ? ` (${r[3]} match(es))` : ''}`);
  }
  return out.length ? out : [];
}

function ipv6Brief(c: RunContext): string[] {
  const t = c.env.topology();
  const d = ipv6Table(sim(c), c.device);
  const out: string[] = [];
  for (const r of d.rows) {
    const i = Object.values(t.interfaces).find((x) => x.deviceId === c.device.id && x.name === r[0])!;
    out.push(`${r[0].padEnd(24)}[${interfaceStatus(sim(c), i).status}/${interfaceStatus(sim(c), i).protocol}]`, `    ${r[2].toUpperCase()}`);
    if (r[1] !== '—') out.push(`    ${r[1].split('/')[0].toUpperCase()}`);
  }
  return out.length ? out : ['No IPv6 addresses configured'];
}

function version(c: RunContext): string[] {
  return [
    'Networky simulated IOS, an educational model of Cisco IOS behaviour.',
    'It is not Cisco software: command coverage is partial (type ? for the list).',
    '',
    `${c.device.hostname} uptime is ${sim(c).tick} ticks`,
    `${c.device.interfaceIds.length} interfaces`,
  ];
}

export const SHOW_COMMANDS: Command[] = [
  show(['ip', 'route'], 'IPv4 routing table', ['router'], ipRoute),
  show(['ip', 'interface', 'brief'], 'Interface status and addresses', ['router', 'switch'], (c) => asText(interfacesBrief(sim(c), c.device))),
  show(['interfaces', 'trunk'], 'Trunk ports', ['switch'], trunks),
  show(['arp'], 'ARP cache', ['router'], arp),
  show(['ip', 'arp'], 'ARP cache', ['router'], arp),
  show(['mac', 'address-table'], 'Learned MAC addresses', ['switch'], macAddressTable),
  show(['vlan', 'brief'], 'VLANs and their ports', ['switch'], (c) => asText(vlanTable(sim(c), c.device))),
  show(['spanning-tree'], 'STP root and port roles', ['switch'], (c) => (c.env.sim().plugin('stp') ? asText(stpTable(sim(c), c.device)) : ['% Spanning tree is not running'])),
  show(['ip', 'nat', 'translations'], 'NAT table', ['router'], (c) => table(['Pro', 'Inside global', 'Inside local', 'Outside', 'Hits'], natTable(sim(c), c.device).rows)),
  show(['access-lists'], 'ACLs with match counters', ['router'], accessLists),
  show(['ip', 'ospf', 'neighbor'], 'OSPF adjacencies', ['router'], (c) => table(['Neighbor ID', 'Pri', 'State', 'Address', 'Interface'], ospfNeighbors(sim(c), c.device).rows.map((r) => [r[0], '1', `${r[1]}/  -`, r[2], r[3]]))),
  show(['ip', 'dhcp', 'binding'], 'DHCP leases handed out', ['router'], (c) => table(['IP address', 'Hardware address', 'Lease expiration', 'Type'], dhcpBindings(sim(c), c.device).rows.map((r) => [r[0], ciscoMac(r[1]), 'Infinite', 'Automatic']))),
  show(['ip', 'protocols'], 'Routing protocols running', ['router'], (c) => {
    const d = c.device;
    const out: string[] = [];
    if (d.rip) out.push('Routing Protocol is "rip"', '  Sending updates: triggered only (timers not simulated)', '  Routing for Networks:', ...d.rip.networks.map((n) => `    ${n.prefix}`), '  Distance: (default is 120)');
    if (d.ospf) out.push('Routing Protocol is "ospf 1"', `  Router ID ${ospfNeighbors(sim(c), d).notes![0].split(';')[0].replace('Router ID ', '')}`, '  Routing for Networks:', ...d.ospf.networks.map((n) => `    ${n.prefix} ${prefixToMask(n.prefixLength)} area ${n.area}`), '  Distance: (default is 110)');
    return out.length ? out : ['No dynamic routing protocol is configured'];
  }),
  show(['ipv6', 'interface', 'brief'], 'IPv6 addresses', ['router'], ipv6Brief),
  show(['ipv6', 'route'], 'IPv6 routing table', ['router'], (c) => asText(ipv6Routes(sim(c), c.device))),
  show(['ipv6', 'neighbors'], 'IPv6 neighbour cache (NDP)', ['router'], (c) => asText(ipv6Neighbors(sim(c), c.device))),
  show(['version'], 'About this device', ['router', 'switch'], version),
];

// keep the mask helper reachable for callers formatting routes
export { prefixToMask };
// arpTable is used by the host prompt too
export { arpTable };
