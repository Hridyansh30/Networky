// Validation rules. Each rule looks at the whole topology and returns issues.
// None of them throw: a misconfigured network is a legal network, it just
// won't work. Telling the user WHY is half of what this app teaches.

import { CABLES, CATALOG, expectedCopperCable, isHostKind } from './catalog';
import { inSubnet, isUsableHost, subnetsOverlap } from './ip';
import { switchportOf } from './ops';
import type { Interface, Topology } from './types';

export type Severity = 'error' | 'warning';

export interface Issue {
  rule: string;
  severity: Severity;
  message: string;
  deviceIds: string[];
}

type Rule = (t: Topology) => Issue[];

const hostname = (t: Topology, id: string) => t.devices[id]?.hostname ?? id;

export const duplicateIp: Rule = (t) => {
  const byIp = new Map<string, string[]>();
  for (const i of Object.values(t.interfaces)) {
    if (!i.ipv4) continue;
    byIp.set(i.ipv4.address, [...(byIp.get(i.ipv4.address) ?? []), i.id]);
  }
  const issues: Issue[] = [];
  for (const [ip, ifIds] of byIp) {
    if (ifIds.length < 2) continue;
    const owners = ifIds.map((id) => `${hostname(t, t.interfaces[id].deviceId)} ${t.interfaces[id].name}`);
    issues.push({
      rule: 'duplicate-ip',
      severity: 'error',
      message: `${ip} is used ${ifIds.length} times: ${owners.join(', ')}`,
      deviceIds: [...new Set(ifIds.map((id) => t.interfaces[id].deviceId))],
    });
  }
  return issues;
};

export const unusableHostAddress: Rule = (t) =>
  Object.values(t.interfaces)
    .filter((i) => i.ipv4 && !isUsableHost(i.ipv4.address, i.ipv4.prefixLength))
    .map((i) => ({
      rule: 'unusable-address',
      severity: 'error' as const,
      message: `${hostname(t, i.deviceId)} ${i.name}: ${i.ipv4!.address}/${i.ipv4!.prefixLength} is the network or broadcast address of its subnet`,
      deviceIds: [i.deviceId],
    }));

export const gatewayOutsideSubnet: Rule = (t) => {
  const issues: Issue[] = [];
  for (const d of Object.values(t.devices)) {
    if (!d.defaultGateway) continue;
    const ips = d.interfaceIds.map((id) => t.interfaces[id]?.ipv4).filter((x) => x !== undefined);
    if (ips.some((ip) => ip.address === d.defaultGateway)) {
      issues.push({
        rule: 'gateway-is-self',
        severity: 'error',
        message: `${d.hostname}'s default gateway ${d.defaultGateway} is its own address`,
        deviceIds: [d.id],
      });
    } else if (ips.length > 0 && !ips.some((ip) => inSubnet(d.defaultGateway!, ip.address, ip.prefixLength))) {
      issues.push({
        rule: 'gateway-outside-subnet',
        severity: 'error',
        message: `${d.hostname}'s default gateway ${d.defaultGateway} is not in its subnet (${ips
          .map((ip) => `${ip.address}/${ip.prefixLength}`)
          .join(', ')}), so it can never reach it`,
        deviceIds: [d.id],
      });
    }
  }
  return issues;
};

export const routerOverlappingSubnets: Rule = (t) => {
  const issues: Issue[] = [];
  for (const d of Object.values(t.devices)) {
    if (d.kind !== 'router') continue;
    const ifs = d.interfaceIds.map((id) => t.interfaces[id]).filter((i) => i?.ipv4);
    for (let x = 0; x < ifs.length; x++) {
      for (let y = x + 1; y < ifs.length; y++) {
        const a = ifs[x].ipv4!;
        const b = ifs[y].ipv4!;
        if (subnetsOverlap(a.address, a.prefixLength, b.address, b.prefixLength)) {
          issues.push({
            rule: 'router-overlapping-subnets',
            severity: 'error',
            message: `${d.hostname}: ${ifs[x].name} and ${ifs[y].name} are in overlapping subnets. Each router interface must be its own network`,
            deviceIds: [d.id],
          });
        }
      }
    }
  }
  return issues;
};

export const hostWithoutIp: Rule = (t) =>
  Object.values(t.devices)
    .filter((d) => isHostKind(d.kind))
    .filter((d) => d.interfaceIds.some((id) => t.interfaces[id]?.linkId))
    .filter((d) => !d.interfaceIds.some((id) => hasAddress(t.interfaces[id])))
    .map((d) => ({
      rule: 'host-without-ip',
      severity: 'warning' as const,
      message: `${d.hostname} is cabled but has no IP address`,
      deviceIds: [d.id],
    }));

export const cableMismatch: Rule = (t) => {
  const issues: Issue[] = [];
  for (const l of Object.values(t.links)) {
    if (l.cable !== 'copper-straight' && l.cable !== 'copper-cross') continue;
    const da = t.devices[t.interfaces[l.a]?.deviceId];
    const db = t.devices[t.interfaces[l.b]?.deviceId];
    if (!da || !db) continue;
    const expected = expectedCopperCable(da.kind, db.kind);
    if (l.cable !== expected) {
      issues.push({
        rule: 'cable-mismatch',
        severity: 'warning',
        message: `${da.hostname} to ${db.hostname} classically needs a ${CABLES[expected].label.toLowerCase()} cable. Modern ports fix this with Auto-MDIX`,
        deviceIds: [da.id, db.id],
      });
    }
  }
  return issues;
};

export const isolatedDevice: Rule = (t) =>
  Object.values(t.devices)
    .filter((d) => !d.interfaceIds.some((id) => t.interfaces[id]?.linkId))
    .map((d) => ({
      rule: 'isolated-device',
      severity: 'warning' as const,
      message: `${d.hostname} (${CATALOG[d.kind].label}) is not connected to anything`,
      deviceIds: [d.id],
    }));

// ------------------------------------------------------------------ phase 3

/** A host is addressed by a static IP, DHCP, a static IPv6 address or SLAAC. */
const hasAddress = (i: Interface | undefined) => !!i && !!(i.ipv4 || i.dhcp || i.ipv6 || i.ipv6Auto);

/** Each cable whose two ends are both switch ports. */
function switchLinks(t: Topology) {
  return Object.values(t.links)
    .map((l) => [t.interfaces[l.a], t.interfaces[l.b]] as const)
    .filter(([a, b]) => a && b && t.devices[a.deviceId]?.kind === 'switch' && t.devices[b.deviceId]?.kind === 'switch');
}

const portLabel = (t: Topology, i: Interface) => `${hostname(t, i.deviceId)} ${i.name}`;

export const trunkMismatch: Rule = (t) => {
  const issues: Issue[] = [];
  for (const [a, b] of switchLinks(t)) {
    const sa = switchportOf(a);
    const sb = switchportOf(b);
    if (sa.mode !== sb.mode) {
      issues.push({
        rule: 'trunk-mode-mismatch',
        severity: 'warning',
        message: `${portLabel(t, a)} is ${sa.mode} but ${portLabel(t, b)} is ${sb.mode}. Tagged frames from the trunk side will be dropped; set both ends to trunk`,
        deviceIds: [a.deviceId, b.deviceId],
      });
    } else if (sa.mode === 'trunk' && sa.nativeVlan !== sb.nativeVlan) {
      issues.push({
        rule: 'native-vlan-mismatch',
        severity: 'warning',
        message: `Native VLAN mismatch: ${portLabel(t, a)} uses ${sa.nativeVlan}, ${portLabel(t, b)} uses ${sb.nativeVlan}. Untagged traffic leaks between the two VLANs (CDP would log %NATIVE_VLAN_MISMATCH)`,
        deviceIds: [a.deviceId, b.deviceId],
      });
    } else if (sa.mode === 'access' && sa.accessVlan !== sb.accessVlan) {
      issues.push({
        rule: 'access-vlan-mismatch',
        severity: 'warning',
        message: `${portLabel(t, a)} (VLAN ${sa.accessVlan}) and ${portLabel(t, b)} (VLAN ${sb.accessVlan}) join two VLANs into one. Use a trunk between switches`,
        deviceIds: [a.deviceId, b.deviceId],
      });
    }
  }
  return issues;
};

export const subinterfaceOnAccessPort: Rule = (t) => {
  const issues: Issue[] = [];
  for (const sub of Object.values(t.interfaces)) {
    if (!sub.parentId) continue;
    const parent = t.interfaces[sub.parentId];
    const link = parent?.linkId ? t.links[parent.linkId] : undefined;
    if (!link) continue;
    const peer = t.interfaces[link.a === parent.id ? link.b : link.a];
    if (peer && t.devices[peer.deviceId]?.kind === 'switch' && switchportOf(peer).mode !== 'trunk') {
      issues.push({
        rule: 'subinterface-needs-trunk',
        severity: 'warning',
        message: `${portLabel(t, sub)} sends 802.1Q tags, but ${portLabel(t, peer)} is an access port. Make it 'switchport mode trunk'`,
        deviceIds: [sub.deviceId, peer.deviceId],
      });
      break;
    }
  }
  return issues;
};

export const undefinedAcl: Rule = (t) => {
  const issues: Issue[] = [];
  for (const i of Object.values(t.interfaces)) {
    const d = t.devices[i.deviceId];
    for (const [dir, name] of [['in', i.aclIn], ['out', i.aclOut]] as const) {
      if (name && !d.acls?.[name]) {
        issues.push({
          rule: 'undefined-acl',
          severity: 'warning',
          message: `${d.hostname} ${i.name} applies ACL ${name} ${dir}, but ACL ${name} does not exist. IOS then permits everything`,
          deviceIds: [d.id],
        });
      }
    }
  }
  return issues;
};

export const incompleteNat: Rule = (t) => {
  const issues: Issue[] = [];
  for (const d of Object.values(t.devices)) {
    if (!d.nat) continue;
    const ifs = d.interfaceIds.map((id) => t.interfaces[id]);
    const missing = (['inside', 'outside'] as const).filter((role) => !ifs.some((i) => i?.nat === role));
    if (missing.length) {
      issues.push({
        rule: 'nat-incomplete',
        severity: 'warning',
        message: `${d.hostname} has NAT rules but no 'ip nat ${missing.join("' / 'ip nat ")}' interface, so nothing is translated`,
        deviceIds: [d.id],
      });
    }
    if (d.nat.overload && !d.acls?.[d.nat.overload.acl]) {
      issues.push({
        rule: 'nat-acl-missing',
        severity: 'warning',
        message: `${d.hostname}: PAT uses ACL ${d.nat.overload.acl}, which does not exist, so no inside address matches`,
        deviceIds: [d.id],
      });
    }
  }
  return issues;
};

export const ospfMultiArea: Rule = (t) =>
  Object.values(t.devices)
    .filter((d) => d.ospf && new Set(d.ospf.networks.map((n) => n.area)).size > 1)
    .map((d) => ({
      rule: 'ospf-multi-area',
      severity: 'warning' as const,
      message: `${d.hostname} puts interfaces in several OSPF areas. This simulator runs single-area OSPF, so it will not act as an area border router`,
      deviceIds: [d.id],
    }));

export const duplicateIpv6: Rule = (t) => {
  const byIp = new Map<string, string[]>();
  for (const i of Object.values(t.interfaces)) if (i.ipv6) byIp.set(i.ipv6.address, [...(byIp.get(i.ipv6.address) ?? []), i.id]);
  return [...byIp]
    .filter(([, ids]) => ids.length > 1)
    .map(([ip, ids]) => ({
      rule: 'duplicate-ipv6',
      severity: 'error' as const,
      message: `${ip} is used ${ids.length} times: ${ids.map((id) => portLabel(t, t.interfaces[id])).join(', ')}`,
      deviceIds: [...new Set(ids.map((id) => t.interfaces[id].deviceId))],
    }));
};

export const RULES: Rule[] = [
  trunkMismatch,
  subinterfaceOnAccessPort,
  undefinedAcl,
  incompleteNat,
  ospfMultiArea,
  duplicateIpv6,
  duplicateIp,
  unusableHostAddress,
  gatewayOutsideSubnet,
  routerOverlappingSubnets,
  hostWithoutIp,
  cableMismatch,
  isolatedDevice,
];

export function validate(t: Topology): Issue[] {
  const issues = RULES.flatMap((rule) => rule(t));
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
