// Export: the network as Terraform for an AWS VPC.
//
// This is a TRANSLATION between two different worlds, not a copy, so the
// interesting part is the mapping. Each line below is a lesson:
//
//   your network                         AWS
//   ------------------------------------ ----------------------------------------
//   a LAN (router interface + hosts)     aws_subnet
//   the routers between LANs             the VPC's built-in router: every subnet
//                                        already reaches every other subnet
//   static routes, RIP, OSPF             not needed (that built-in router knows
//                                        every subnet), so not exported
//   router address (192.168.1.1)         the VPC router is ALWAYS the subnet's .1
//   switches, hubs, VLANs, STP           nothing: a VLAN is just a subnet in AWS
//   PAT on a router (ip nat overload)    NAT gateway in a public subnet, plus an
//                                        internet gateway and a default route
//   ACL on a LAN-facing interface        network ACL on that subnet (stateless,
//                                        numbered, first match wins: like IOS)
//   PCs and servers                      aws_instance, OFF by default
//                                        (create_instances = false) because
//                                        instances cost money
//   DHCP pools                           AWS hands out addresses itself; only a
//                                        DNS server carries over (DHCP options)
//
// Anything that does not translate is listed in `notes` and at the top of
// the file. Nothing here talks to AWS: the user runs terraform themselves.

import { isHostKind } from '../model/catalog';
import { formatIPv4, networkOf, parseIPv4, prefixToMaskNum } from '../model/ip';
import { peerInterfaceId, switchportOf } from '../model/ops';
import type { Acl, AclRule, Device, Interface, Topology } from '../model/types';
import { expr, hclName, renderBlock, str, type HclBody } from './hcl';
import type { Exporter } from './types';

// ------------------------------------------------------------ address helpers

const cidr = (net: number, prefix: number) => `${formatIPv4(net)}/${prefix}`;
const size = (prefix: number) => 2 ** (32 - prefix);
const contains = (net: number, prefix: number, ip: number) => networkOf(formatIPv4(ip), prefix) === net;
const overlaps = (a: number, ap: number, b: number, bp: number) => {
  const p = Math.min(ap, bp);
  return networkOf(formatIPv4(a), p) === networkOf(formatIPv4(b), p);
};

/** The smallest prefix that contains every network in the list. */
function supernet(nets: { net: number; prefix: number }[]): { net: number; prefix: number } {
  let prefix = Math.min(...nets.map((n) => n.prefix));
  while (prefix > 0 && new Set(nets.map((n) => networkOf(formatIPv4(n.net), prefix))).size > 1) prefix--;
  return { net: networkOf(formatIPv4(nets[0].net), prefix), prefix };
}

/** A wildcard mask as a CIDR prefix, or null if it is not contiguous (e.g. 0.0.255.0). */
function prefixOfWildcard(wildcard: string): number | null {
  const w = parseIPv4(wildcard);
  if (w === null) return null;
  for (let p = 0; p <= 32; p++) if ((~prefixToMaskNum(p) >>> 0) === w) return p;
  return null;
}

/** RFC 1918 block of an address: AWS cannot mix them in one VPC. */
function privateBlock(ip: number): string {
  if (contains(parseIPv4('10.0.0.0')!, 8, ip)) return '10.0.0.0/8';
  if (contains(parseIPv4('172.16.0.0')!, 12, ip)) return '172.16.0.0/12';
  if (contains(parseIPv4('192.168.0.0')!, 16, ip)) return '192.168.0.0/16';
  return 'public';
}

// ------------------------------------------------------------ topology helpers

/**
 * The router interface a host reaches through switches and hubs, following
 * VLANs. Used for DHCP hosts, whose address is not in the model.
 */
function gatewayInterfaceOf(t: Topology, hostIfaceId: string): Interface | undefined {
  const first = peerInterfaceId(t, hostIfaceId);
  if (!first) return undefined;
  const queue: [string, number][] = [[first, 1]];
  const seen = new Set<string>();
  while (queue.length) {
    const [id, vlanIn] = queue.shift()!;
    if (seen.has(`${id}:${vlanIn}`)) continue;
    seen.add(`${id}:${vlanIn}`);
    const i = t.interfaces[id];
    const d = t.devices[i.deviceId];
    if (d.kind === 'router') {
      const subs = d.interfaceIds.map((x) => t.interfaces[x]).filter((s) => s.parentId === i.id);
      return subs.find((s) => s.vlanTag === vlanIn) ?? (i.ipv4 ? i : undefined);
    }
    if (d.kind !== 'switch' && d.kind !== 'hub') continue;
    let vlan = vlanIn;
    if (d.kind === 'switch') {
      const sp = switchportOf(i);
      if (sp.mode === 'access') vlan = sp.accessVlan;
    }
    for (const oid of d.interfaceIds) {
      const o = t.interfaces[oid];
      if (oid === id || !o.linkId) continue;
      if (d.kind === 'switch') {
        const sp = switchportOf(o);
        if (sp.mode === 'access' && sp.accessVlan !== vlan) continue;
        if (sp.mode === 'trunk' && sp.allowedVlans && !sp.allowedVlans.includes(vlan)) continue;
      }
      const p = peerInterfaceId(t, oid);
      if (p) queue.push([p, vlan]);
    }
  }
  return undefined;
}

interface HostOnLan {
  device: Device;
  iface: Interface;
  /** Static address; undefined for DHCP hosts. */
  ip?: number;
}

interface Lan {
  net: number;
  prefix: number;
  routerIfaces: { router: Device; iface: Interface }[];
  hosts: HostOnLan[];
}

// ------------------------------------------------------------ ACL -> network ACL

interface NaclRule {
  egress: boolean;
  action: 'allow' | 'deny';
  protocol: string;
  cidr: string;
  port?: number;
  icmp: boolean;
  source: string;
}

const PROTOCOL_NUMBER: Record<AclRule['protocol'], string> = { ip: '-1', icmp: '1', tcp: '6', udp: '17' };

/**
 * One IOS rule as a network ACL rule, or the reason it cannot be one.
 *
 * Direction is the trick. An ACL applied IN on the router's LAN interface
 * filters packets LEAVING the LAN, so it becomes the subnet's EGRESS rules.
 * An ACL applied OUT filters packets ENTERING the LAN: INGRESS rules. A
 * network ACL rule has one address, the far end: the destination for
 * egress, the source for ingress. The LAN end is implied by the subnet.
 */
function toNaclRule(rule: AclRule, type: Acl['type'], egress: boolean, lan: Lan, source: string): NaclRule | string {
  const local = type === 'standard' ? (egress ? { a: rule.src, w: rule.srcWildcard } : null) : egress ? { a: rule.src, w: rule.srcWildcard } : { a: rule.dst ?? '0.0.0.0', w: rule.dstWildcard ?? '255.255.255.255' };
  const remote = type === 'standard' ? (egress ? { a: '0.0.0.0', w: '255.255.255.255' } : { a: rule.src, w: rule.srcWildcard }) : egress ? { a: rule.dst ?? '0.0.0.0', w: rule.dstWildcard ?? '255.255.255.255' } : { a: rule.src, w: rule.srcWildcard };

  if (local) {
    const lp = prefixOfWildcard(local.w);
    const la = parseIPv4(local.a)!;
    if (lp === null) return `${source}: the wildcard ${local.w} is not a prefix, so it has no CIDR form.`;
    if (!overlaps(la, lp, lan.net, lan.prefix)) return `${source}: never matches traffic of ${cidr(lan.net, lan.prefix)}, so it is left out.`;
    if (lp > lan.prefix) return `${source}: matches only part of ${cidr(lan.net, lan.prefix)}. A network ACL covers a whole subnet; use a security group per instance for that.`;
  }
  const rp = prefixOfWildcard(remote.w);
  if (rp === null) return `${source}: the wildcard ${remote.w} is not a prefix, so it has no CIDR form.`;
  return {
    egress,
    action: rule.action === 'permit' ? 'allow' : 'deny',
    protocol: PROTOCOL_NUMBER[rule.protocol],
    cidr: cidr(networkOf(remote.a, rp), rp),
    port: rule.dstPort,
    icmp: rule.protocol === 'icmp',
    source,
  };
}

// ------------------------------------------------------------ the exporter

export const terraformExporter: Exporter = {
  id: 'terraform-aws',
  title: 'Terraform for an AWS VPC',
  description: 'Your LANs as subnets of one VPC, with NAT, network ACLs and (optional) instances. Review it, then run terraform yourself.',
  language: 'Terraform (HCL)',
  export({ topology: t, name }) {
    const notes: string[] = [];
    const note = (s: string) => notes.includes(s) || notes.push(s);
    const devices = Object.values(t.devices);

    // 1. Group every IPv4 interface into subnets.
    const lans = new Map<string, Lan>();
    const lanOf = (net: number, prefix: number) => {
      const key = cidr(net, prefix);
      if (!lans.has(key)) lans.set(key, { net, prefix, routerIfaces: [], hosts: [] });
      return lans.get(key)!;
    };
    for (const d of devices.filter((x) => x.kind === 'router'))
      for (const id of d.interfaceIds) {
        const i = t.interfaces[id];
        if (i.ipv4) lanOf(networkOf(i.ipv4.address, i.ipv4.prefixLength), i.ipv4.prefixLength).routerIfaces.push({ router: d, iface: i });
      }
    for (const d of devices.filter((x) => isHostKind(x.kind)))
      for (const id of d.interfaceIds) {
        const i = t.interfaces[id];
        if (i.ipv4 && !i.dhcp) {
          lanOf(networkOf(i.ipv4.address, i.ipv4.prefixLength), i.ipv4.prefixLength).hosts.push({ device: d, iface: i, ip: parseIPv4(i.ipv4.address)! });
        } else if (i.dhcp) {
          const gw = gatewayInterfaceOf(t, i.id);
          if (gw?.ipv4) lanOf(networkOf(gw.ipv4.address, gw.ipv4.prefixLength), gw.ipv4.prefixLength).hosts.push({ device: d, iface: i });
          else note(`${d.hostname} uses DHCP but no router interface was found for it, so it is left out.`);
        }
      }

    // 2. Decide what each subnet is.
    const translated: Lan[] = [];
    for (const lan of lans.values()) {
      const where = cidr(lan.net, lan.prefix);
      const outside = lan.routerIfaces.find((r) => r.iface.nat === 'outside');
      if (outside) {
        note(`${where} is the outside of ${outside.router.hostname}'s NAT, the internet side. In AWS that is the internet gateway, not a subnet you create.`);
        for (const h of lan.hosts) note(`${h.device.hostname} sits on the internet side (${where}), so it is not part of the VPC.`);
        continue;
      }
      if (!lan.hosts.length && lan.routerIfaces.length > 1) {
        note(`${where} only links routers together (${lan.routerIfaces.map((r) => r.router.hostname).join(', ')}). Inside a VPC there is one built-in router, so these links disappear.`);
        continue;
      }
      if (lan.prefix < 16 || lan.prefix > 28) {
        note(`${where} cannot be an AWS subnet: subnets must be between /16 and /28.`);
        continue;
      }
      translated.push(lan);
    }
    if (devices.some((d) => d.rip || d.ospf || d.staticRoutes?.length))
      note('Static routes, RIP and OSPF are not exported: the VPC router already knows every subnet. (Routes to on-premises networks would need a VPN or Direct Connect.)');
    if (devices.some((d) => d.kind === 'switch' || d.kind === 'hub'))
      note('Switches, hubs, VLANs and STP have no AWS resource: AWS runs layer 2 for you, and each VLAN is simply its own subnet.');
    if (Object.values(t.interfaces).some((i) => i.ipv6))
      note('IPv6 addresses are not exported. (An AWS VPC can add an Amazon-provided /56; addresses are not chosen by hand.)');
    if (devices.some((d) => d.services))
      note('Application services (web, DNS, mail, FTP) are not exported: on AWS they are software on the instances, or managed services such as Route 53.');

    // 3. One VPC. AWS refuses to mix RFC 1918 blocks (10/8, 172.16/12, 192.168/16) in one VPC.
    const byBlock = new Map<string, Lan[]>();
    for (const lan of translated) byBlock.set(privateBlock(lan.net), [...(byBlock.get(privateBlock(lan.net)) ?? []), lan]);
    const [block, chosen] = [...byBlock.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? ['', []];
    for (const [other, list] of byBlock) if (other !== block) for (const lan of list) note(`${cidr(lan.net, lan.prefix)} is in ${other}, but the VPC uses ${block}. AWS does not allow both in one VPC, so it is left out.`);
    if (block === 'public') note('These subnets use public addresses. AWS allows that, but private (RFC 1918) addresses are the norm inside a VPC.');

    // Group by /16: the first group is the VPC's CIDR, the others are secondary CIDRs (AWS allows 5 in all).
    const groups = new Map<number, Lan[]>();
    for (const lan of chosen) {
      const key = networkOf(formatIPv4(lan.net), 16);
      groups.set(key, [...(groups.get(key) ?? []), lan]);
    }
    const cidrBlocks = [...groups.values()]
      .sort((a, b) => b.length - a.length)
      .map((list) => ({ ...supernet(list), lans: list }))
      .slice(0, 5);
    if (groups.size > 5) note('More than five /16 ranges are in use; a VPC has at most five CIDR blocks, so the rest are left out.');
    const lansInVpc = cidrBlocks.flatMap((b) => b.lans);

    // 4. NAT: a router doing PAT becomes a NAT gateway in a new public subnet.
    const natRouters = devices.filter((d) => d.kind === 'router' && (d.nat?.overload || d.nat?.statics.length));
    const natInside = (lan: Lan) => lan.routerIfaces.some((r) => r.iface.nat === 'inside' && natRouters.includes(r.router));
    for (const r of natRouters)
      for (const s of r.nat?.statics ?? [])
        note(`Static NAT ${s.local} -> ${s.global} on ${r.hostname}: in AWS, publish a server with an Elastic IP in a public subnet or behind a load balancer. Not exported.`);
    let publicSubnet: { net: number; prefix: number } | undefined;
    if (natRouters.length && lansInVpc.some(natInside)) {
      // Find a free /24 (or smaller) inside the VPC's first CIDR; widen the VPC if needed.
      const main = cidrBlocks[0];
      for (let vpcPrefix = main.prefix; vpcPrefix >= 16 && !publicSubnet; vpcPrefix--) {
        const vpcNet = networkOf(formatIPv4(main.net), vpcPrefix);
        for (let p = 24; p <= 28 && !publicSubnet; p++) {
          if (p < vpcPrefix) continue;
          for (let n = vpcNet; n < vpcNet + size(vpcPrefix); n += size(p)) {
            if (lansInVpc.every((l) => !overlaps(n, p, l.net, l.prefix))) {
              publicSubnet = { net: n, prefix: p };
              main.net = vpcNet;
              main.prefix = vpcPrefix;
              break;
            }
          }
        }
      }
      if (!publicSubnet) note('No free range was left in the VPC for the public subnet a NAT gateway needs, so NAT is not exported.');
      if (natRouters.length > 1) note(`${natRouters.length} routers do NAT; the export uses one NAT gateway for the whole VPC.`);
    }

    // ---------------------------------------------------------------- render
    const used = new Set<string>(['main', 'public', 'private', 'lan', 'available']);
    const lanName = new Map<Lan, string>();
    for (const lan of lansInVpc) {
      const r = lan.routerIfaces[0];
      lanName.set(lan, hclName(r ? `${r.router.hostname}_${r.iface.name}` : `lan_${cidr(lan.net, lan.prefix)}`, used));
    }

    const out: string[] = [];
    const add = (lines: string[]) => out.push(...lines, '');
    const tags = (n: string) => ({ Name: expr(`"\${var.name}-${n.replace(/[^A-Za-z0-9_.-]/g, '-')}"`) });

    add(renderBlock('terraform', [
      ['required_version', str('>= 1.5')],
      { block: 'required_providers', body: [['aws', { source: str('hashicorp/aws'), version: str('~> 5.0') }]] },
    ]));
    add(renderBlock('provider "aws"', [['region', expr('var.region')]]));
    add(renderBlock('variable "region"', [['type', expr('string')], ['default', str('us-east-1')]]));
    add(renderBlock('variable "name"', [['description', str('Prefix for the Name tag of every resource')], ['type', expr('string')], ['default', str(hclName(name, new Set()).replace(/_/g, '-'))]]));
    add(renderBlock('variable "create_instances"', [
      ['description', str('Create an EC2 instance for every PC, laptop and server. Off by default: instances cost money.')],
      ['type', expr('bool')],
      ['default', expr('false')],
    ]));
    add(renderBlock('variable "ami_id"', [['description', str('AMI for the instances (needed only when create_instances = true)')], ['type', expr('string')], ['default', str('')]]));
    add(renderBlock('variable "instance_type"', [['type', expr('string')], ['default', str('t3.micro')]]));
    add(renderBlock('data "aws_availability_zones" "available"', [['state', str('available')]]));

    const finish = () => {
      // The header is written last so it lists every note, including those found while rendering.
      const oneLine = (x: string) => x.replace(/[\r\n]/g, ' ');
      const header = [
        `# Networky export: ${oneLine(name)}`,
        '#',
        '# Your network as an AWS VPC. Review it before you apply it: instances,',
        '# NAT gateways and Elastic IPs cost money while they exist.',
        '#',
        '#   terraform init',
        '#   terraform plan',
        '#   terraform apply      # and "terraform destroy" when you are done',
        '#',
        ...(notes.length ? ['# What did not translate:', ...notes.map((n) => `#  - ${oneLine(n)}`)] : []),
        '',
      ];
      return { fileName: `${name}-aws.tf`, mime: 'text/plain', text: [...header, ...out].join('\n').replace(/\n+$/, '\n'), notes };
    };

    if (!cidrBlocks.length) {
      note('No LAN could be translated, so the file only sets up the provider.');
      return finish();
    }

    add(renderBlock('resource "aws_vpc" "main"', [
      ['cidr_block', str(cidr(cidrBlocks[0].net, cidrBlocks[0].prefix))],
      ['enable_dns_support', expr('true')],
      ['enable_dns_hostnames', expr('true')],
      ['tags', tags('vpc')],
    ]));
    cidrBlocks.slice(1).forEach((b, k) =>
      add(renderBlock(`resource "aws_vpc_ipv4_cidr_block_association" "extra_${k + 1}"`, [
        { comment: 'A secondary CIDR block: your LANs span more than one /16.' },
        ['vpc_id', expr('aws_vpc.main.id')],
        ['cidr_block', str(cidr(b.net, b.prefix))],
      ])),
    );

    for (const lan of lansInVpc) {
      const n = lanName.get(lan)!;
      const gw = lan.routerIfaces[0];
      const body: HclBody = [];
      if (gw) body.push({ comment: `${gw.router.hostname} ${gw.iface.name} (${gw.iface.ipv4!.address}). In AWS the subnet's router is always ${formatIPv4(lan.net + 1)}.` });
      body.push(['vpc_id', expr('aws_vpc.main.id')], ['cidr_block', str(cidr(lan.net, lan.prefix))], ['availability_zone', expr('data.aws_availability_zones.available.names[0]')], ['tags', tags(n)]);
      const k = cidrBlocks.findIndex((b) => b.lans.includes(lan));
      if (k > 0) body.push(['depends_on', [expr(`aws_vpc_ipv4_cidr_block_association.extra_${k}`)]]);
      add(renderBlock(`resource "aws_subnet" "${n}"`, body));
      if (gw && gw.iface.ipv4!.address !== formatIPv4(lan.net + 1))
        note(`${gw.router.hostname} uses ${gw.iface.ipv4!.address} as the gateway of ${cidr(lan.net, lan.prefix)}; in AWS it becomes ${formatIPv4(lan.net + 1)}, so the hosts' gateway changes.`);
    }

    if (publicSubnet) {
      add(renderBlock('resource "aws_subnet" "public"', [
        { comment: 'New: a NAT gateway must live in a public subnet (one whose route to 0.0.0.0/0 is the internet gateway).' },
        ['vpc_id', expr('aws_vpc.main.id')],
        ['cidr_block', str(cidr(publicSubnet.net, publicSubnet.prefix))],
        ['availability_zone', expr('data.aws_availability_zones.available.names[0]')],
        ['tags', tags('public')],
      ]));
      add(renderBlock('resource "aws_internet_gateway" "main"', [['vpc_id', expr('aws_vpc.main.id')], ['tags', tags('igw')]]));
      add(renderBlock('resource "aws_eip" "nat"', [{ comment: `The one public address PAT shares, like ${natRouters[0].hostname}'s outside interface.` }, ['domain', str('vpc')], ['tags', tags('nat')]]));
      add(renderBlock('resource "aws_nat_gateway" "main"', [
        { comment: `Replaces "ip nat inside source list ... overload" on ${natRouters.map((r) => r.hostname).join(', ')}.` },
        ['allocation_id', expr('aws_eip.nat.id')],
        ['subnet_id', expr('aws_subnet.public.id')],
        ['tags', tags('nat')],
        ['depends_on', [expr('aws_internet_gateway.main')]],
      ]));
      add(renderBlock('resource "aws_route_table" "public"', [
        ['vpc_id', expr('aws_vpc.main.id')],
        { block: 'route', body: [['cidr_block', str('0.0.0.0/0')], ['gateway_id', expr('aws_internet_gateway.main.id')]] },
        ['tags', tags('public')],
      ]));
      add(renderBlock('resource "aws_route_table_association" "public"', [['subnet_id', expr('aws_subnet.public.id')], ['route_table_id', expr('aws_route_table.public.id')]]));
      add(renderBlock('resource "aws_route_table" "private"', [
        { comment: 'The default route your NAT router gave its inside LANs.' },
        ['vpc_id', expr('aws_vpc.main.id')],
        { block: 'route', body: [['cidr_block', str('0.0.0.0/0')], ['nat_gateway_id', expr('aws_nat_gateway.main.id')]] },
        ['tags', tags('private')],
      ]));
      for (const lan of lansInVpc.filter(natInside))
        add(renderBlock(`resource "aws_route_table_association" "${lanName.get(lan)}"`, [['subnet_id', expr(`aws_subnet.${lanName.get(lan)}.id`)], ['route_table_id', expr('aws_route_table.private.id')]]));
    }

    // Network ACLs from IOS ACLs on LAN-facing interfaces.
    for (const lan of lansInVpc) {
      const rules: NaclRule[] = [];
      for (const { router, iface } of lan.routerIfaces)
        for (const [dir, aclName] of [['in', iface.aclIn], ['out', iface.aclOut]] as const) {
          if (!aclName) continue;
          const acl = router.acls?.[aclName];
          if (!acl) {
            note(`ACL ${aclName} is applied on ${router.hostname} ${iface.name} but not defined. IOS then permits everything, so no network ACL is exported.`);
            continue;
          }
          acl.rules.forEach((rule, k) => {
            const r = toNaclRule(rule, acl.type, dir === 'in', lan, `ACL ${aclName} line ${k + 1} on ${router.hostname} ${iface.name} ${dir}`);
            if (typeof r === 'string') note(r);
            else rules.push(r);
          });
        }
      if (!rules.length) continue;
      const n = lanName.get(lan)!;
      const body: HclBody = [
        { comment: 'Stateless and evaluated in rule-number order, first match wins, with an implicit deny at the end: the same as an IOS ACL.' },
        ['vpc_id', expr('aws_vpc.main.id')],
        ['subnet_ids', [expr(`aws_subnet.${n}.id`)]],
      ];
      for (const egress of [false, true]) {
        const mine = rules.filter((r) => r.egress === egress);
        const kind = egress ? 'egress' : 'ingress';
        if (!mine.length) {
          body.push({ comment: `No IOS ACL filtered this direction, so it allows everything.` });
          body.push({ block: kind, body: [['rule_no', expr('100')], ['action', str('allow')], ['protocol', str('-1')], ['cidr_block', str('0.0.0.0/0')], ['from_port', expr('0')], ['to_port', expr('0')]] });
          continue;
        }
        if (mine.length > 20) note(`${n}: ${mine.length} ${kind} rules; AWS allows 20 per direction by default.`);
        mine.forEach((r, k) => {
          const b: HclBody = [{ comment: r.source }, ['rule_no', expr(String(100 + k * 10))], ['action', str(r.action)], ['protocol', str(r.protocol)], ['cidr_block', str(r.cidr)]];
          if (r.icmp) b.push(['icmp_type', expr('-1')], ['icmp_code', expr('-1')], ['from_port', expr('0')], ['to_port', expr('0')]);
          else if (r.protocol === '-1') b.push(['from_port', expr('0')], ['to_port', expr('0')]);
          else b.push(['from_port', expr(String(r.port ?? 0))], ['to_port', expr(String(r.port ?? 65535))]);
          body.push({ block: kind, body: b });
        });
      }
      body.push(['tags', tags(n)]);
      add(renderBlock(`resource "aws_network_acl" "${n}"`, body));
    }

    // DHCP: AWS assigns addresses; only the DNS server carries over.
    const dns = [...new Set(devices.flatMap((d) => (d.dhcpPools ?? []).map((p) => p.dnsServer).filter((x): x is string => !!x)))];
    if (devices.some((d) => d.dhcpPools?.length)) note('DHCP pools are not exported: AWS gives every instance its address. Excluded ranges do not apply.');
    if (dns.length) {
      add(renderBlock('resource "aws_vpc_dhcp_options" "main"', [{ comment: 'The dns-server from your DHCP pools.' }, ['domain_name_servers', dns.map(str)], ['tags', tags('dhcp')]]));
      add(renderBlock('resource "aws_vpc_dhcp_options_association" "main"', [['vpc_id', expr('aws_vpc.main.id')], ['dhcp_options_id', expr('aws_vpc_dhcp_options.main.id')]]));
    }

    // Instances for end devices, off unless asked for.
    const hosts = lansInVpc.flatMap((lan) => lan.hosts.map((h) => ({ lan, h })));
    if (hosts.length) {
      add(renderBlock('resource "aws_security_group" "lan"', [
        { comment: 'Security groups are STATEFUL (replies are allowed automatically), unlike network ACLs and IOS ACLs.' },
        ['name_prefix', expr('"${var.name}-lan-"')],
        ['vpc_id', expr('aws_vpc.main.id')],
        { block: 'ingress', body: [['description', str('Anything from inside the VPC')], ['from_port', expr('0')], ['to_port', expr('0')], ['protocol', str('-1')], ['cidr_blocks', cidrBlocks.map((b) => str(cidr(b.net, b.prefix)))]] },
        { block: 'egress', body: [['from_port', expr('0')], ['to_port', expr('0')], ['protocol', str('-1')], ['cidr_blocks', [str('0.0.0.0/0')]]] },
        ['tags', tags('lan')],
      ]));
      for (const { lan, h } of hosts) {
        const n = hclName(h.device.hostname, used);
        const body: HclBody = [
          { comment: `${h.device.kind} ${h.device.hostname}${h.ip === undefined ? ' (DHCP: AWS picks the address)' : ''}` },
          ['count', expr('var.create_instances ? 1 : 0')],
          ['ami', expr('var.ami_id')],
          ['instance_type', expr('var.instance_type')],
          ['subnet_id', expr(`aws_subnet.${lanName.get(lan)}.id`)],
          ['vpc_security_group_ids', [expr('aws_security_group.lan.id')]],
        ];
        if (h.ip !== undefined) {
          const offset = h.ip - lan.net;
          if (offset <= 3 || offset === size(lan.prefix) - 1)
            note(`${h.device.hostname} uses ${formatIPv4(h.ip)}, which AWS reserves (the first four addresses and the last one of every subnet). AWS will pick its address instead.`);
          else body.push(['private_ip', str(formatIPv4(h.ip))]);
        }
        body.push(['tags', tags(h.device.hostname)]);
        add(renderBlock(`resource "aws_instance" "${n}"`, body));
      }
    }

    add(renderBlock('output "vpc_id"', [['value', expr('aws_vpc.main.id')]]));
    add(renderBlock('output "subnet_ids"', [['value', { ...Object.fromEntries(lansInVpc.map((l) => [lanName.get(l)!, expr(`aws_subnet.${lanName.get(l)}.id`)])) }]]));

    return finish();
  },
};

/** Exposed for tests. */
export const __test = { supernet, prefixOfWildcard, gatewayInterfaceOf };
