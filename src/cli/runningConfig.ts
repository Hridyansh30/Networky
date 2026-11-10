// 'show running-config': the device's configuration written back as the IOS
// commands that would create it. Reading this teaches the commands.

import { formatRule } from '../model/acl';
import { prefixToMask, formatIPv4, parseIPv4 } from '../model/ip';
import { switchportOf } from '../model/ops';
import type { Device, Interface, Topology } from '../model/types';

const wildcard = (prefixLength: number) => formatIPv4((~parseIPv4(prefixToMask(prefixLength))! >>> 0) >>> 0);

function interfaceBlock(d: Device, i: Interface): string[] {
  const lines = [`interface ${i.name}`];
  if (i.vlanTag !== undefined) lines.push(` encapsulation dot1Q ${i.vlanTag}`);
  if (d.kind === 'switch') {
    const sp = switchportOf(i);
    if (sp.mode === 'trunk') {
      if (sp.nativeVlan !== 1) lines.push(` switchport trunk native vlan ${sp.nativeVlan}`);
      if (sp.allowedVlans) lines.push(` switchport trunk allowed vlan ${sp.allowedVlans.join(',')}`);
      lines.push(' switchport mode trunk');
    } else if (sp.accessVlan !== 1) {
      lines.push(` switchport access vlan ${sp.accessVlan}`, ' switchport mode access');
    }
  } else {
    if (i.ipv4) lines.push(` ip address ${i.ipv4.address} ${prefixToMask(i.ipv4.prefixLength)}`);
    else if (!i.parentId) lines.push(' no ip address');
    if (i.helperAddress) lines.push(` ip helper-address ${i.helperAddress}`);
    if (i.aclIn) lines.push(` ip access-group ${i.aclIn} in`);
    if (i.aclOut) lines.push(` ip access-group ${i.aclOut} out`);
    if (i.nat) lines.push(` ip nat ${i.nat}`);
    if (i.ospfCost) lines.push(` ip ospf cost ${i.ospfCost}`);
    if (i.ipv6) lines.push(` ipv6 address ${i.ipv6.address}/${i.ipv6.prefixLength}`);
  }
  if (!i.adminUp) lines.push(' shutdown');
  lines.push('!');
  return lines;
}

export function runningConfig(t: Topology, deviceId: string): string[] {
  const d = t.devices[deviceId];
  const ifs = d.interfaceIds.map((id) => t.interfaces[id]);
  const out = ['Building configuration...', '', 'Current configuration:', '!', `hostname ${d.hostname}`, '!'];

  if (d.kind === 'switch' && d.stpPriority !== undefined && d.stpPriority !== 32768) out.push(`spanning-tree vlan 1 priority ${d.stpPriority}`, '!');

  for (const p of d.dhcpPools ?? []) for (const x of p.excluded ?? []) out.push(`ip dhcp excluded-address ${x}`);
  for (const p of d.dhcpPools ?? []) {
    out.push('!', `ip dhcp pool ${p.name}`, ` network ${p.network} ${prefixToMask(p.prefixLength)}`);
    if (p.defaultRouter) out.push(` default-router ${p.defaultRouter}`);
    if (p.dnsServer) out.push(` dns-server ${p.dnsServer}`);
  }
  if (d.dhcpPools?.length) out.push('!');
  if (ifs.some((i) => i.ipv6)) out.push('ipv6 unicast-routing', '!');

  for (const i of ifs) out.push(...interfaceBlock(d, i));

  if (d.rip) {
    out.push('router rip', ' version 2');
    for (const n of d.rip.networks) out.push(` network ${n.prefix}`);
    out.push(' no auto-summary', '!');
  }
  if (d.ospf) {
    out.push('router ospf 1');
    if (d.ospf.routerId) out.push(` router-id ${d.ospf.routerId}`);
    for (const n of d.ospf.networks) out.push(` network ${n.prefix} ${wildcard(n.prefixLength)} area ${n.area}`);
    out.push('!');
  }
  if (d.nat?.overload) out.push(`ip nat inside source list ${d.nat.overload.acl} interface ${t.interfaces[d.nat.overload.outsideInterfaceId]?.name} overload`);
  for (const s of d.nat?.statics ?? []) out.push(`ip nat inside source static ${s.local} ${s.global}`);
  for (const r of d.staticRoutes ?? []) out.push(`ip route ${r.prefix} ${prefixToMask(r.prefixLength)} ${r.nextHop}`);
  for (const r of d.ipv6StaticRoutes ?? []) out.push(`ipv6 route ${r.prefix}/${r.prefixLength} ${r.nextHop}`);
  if (d.nat || d.staticRoutes?.length || d.ipv6StaticRoutes?.length) out.push('!');

  for (const [name, acl] of Object.entries(d.acls ?? {})) {
    if (/^\d+$/.test(name)) for (const r of acl.rules) out.push(`access-list ${name} ${formatRule(r, acl.type)}`);
    else {
      out.push(`ip access-list ${acl.type} ${name}`);
      for (const r of acl.rules) out.push(` ${formatRule(r, acl.type)}`);
    }
  }
  if (Object.keys(d.acls ?? {}).length) out.push('!');
  out.push('end');
  return out;
}
