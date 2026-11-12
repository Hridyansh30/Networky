import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../model/examples';
import { setAcl, setInterfaceOptions } from '../model/ops';
import type { Topology } from '../model/types';
import { terraformExporter, __test } from './terraform';

const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const tf = (topology: Topology, name = 'lab') => terraformExporter.export({ topology, layout: {}, name });
const iface = (t: Topology, host: string, port: string) => {
  const d = Object.values(t.devices).find((x) => x.hostname === host)!;
  return d.interfaceIds.map((id) => t.interfaces[id]).find((i) => i.name === port)!;
};
/** The body of one resource block, e.g. block(text, 'aws_network_acl', 'r1_gigabitethernet0_0'). */
/** The file without comment lines: comments are never evaluated by Terraform. */
const code = (text: string) => text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const block = (text: string, type: string, name: string) => {
  const start = text.indexOf(`resource "${type}" "${name}" {`);
  if (start < 0) return '';
  return text.slice(start, text.indexOf('\n}\n', start) + 2);
};

/**
 * Structural checks that stand in for `terraform validate` in unit tests:
 * balanced braces, unique resource names, and every reference to a resource,
 * data source or variable points at something declared in the file.
 */
function checkHcl(text: string) {
  const code = text
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
    .replace(/"(?:[^"\\]|\\.)*"/g, (s) => (s.includes('${var.') ? s.replace(/[^$]*\$\{(var\.\w+)\}[^"]*/g, ' $1 ') : '""'));
  let depth = 0;
  for (const ch of code) {
    depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
    expect(depth).toBeGreaterThanOrEqual(0);
  }
  expect(depth).toBe(0);

  const declared = [...text.matchAll(/^resource "(\w+)" "(\w+)"/gm)].map((m) => `${m[1]}.${m[2]}`);
  expect(new Set(declared).size).toBe(declared.length);
  const data = [...text.matchAll(/^data "(\w+)" "(\w+)"/gm)].map((m) => `data.${m[1]}.${m[2]}`);
  const vars = [...text.matchAll(/^variable "(\w+)"/gm)].map((m) => `var.${m[1]}`);
  for (const [ref] of code.matchAll(/\b(?:data\.)?aws_\w+\.\w+/g)) {
    if (ref.startsWith('data.')) expect(data).toContain(ref);
    else expect(declared).toContain(ref);
  }
  for (const [ref] of code.matchAll(/\bvar\.\w+/g)) expect(vars).toContain(ref);
}

describe('every lab exports to well-formed Terraform', () => {
  for (const e of EXAMPLES)
    it(e.name, () => {
      const r = tf(e.build().topology, e.id);
      checkHcl(r.text);
      // every note is also in the file's header, so it travels with the file
      for (const n of r.notes) expect(r.text).toContain(n);
    });
});

describe('Office edge: NAT and ACL become AWS resources', () => {
  const { topology } = lab('office-edge-nat-acl');
  const r = tf(topology);

  it('PAT becomes a NAT gateway in a new public subnet, with the inside LAN routed through it', () => {
    expect(r.text).toContain('resource "aws_nat_gateway" "main"');
    expect(r.text).toContain('resource "aws_internet_gateway" "main"');
    expect(block(r.text, 'aws_subnet', 'public')).toContain('cidr_block        = "192.168.0.0/24"');
    expect(block(r.text, 'aws_vpc', 'main')).toContain('"192.168.0.0/23"'); // widened to make room
    expect(block(r.text, 'aws_route_table_association', 'r1_gigabitethernet0_0')).toContain('aws_route_table.private.id');
  });

  it('ACL 110 IN on the LAN interface becomes the subnet’s EGRESS rules, in order', () => {
    const nacl = block(r.text, 'aws_network_acl', 'r1_gigabitethernet0_0');
    const egress = nacl.slice(nacl.indexOf('egress {'));
    const rules = [...egress.matchAll(/rule_no += (\d+)\n\s+action += "(\w+)"\n\s+protocol += "(-?\d+)"[\s\S]*?from_port += (\d+)/g)].map((m) => m.slice(1).join(' '));
    expect(rules).toEqual(['100 allow 6 80', '110 deny 6 22', '120 allow 1 0']);
    expect(nacl.slice(0, nacl.indexOf('egress {'))).toMatch(/ingress \{\n\s+rule_no += 100\n\s+action += "allow"\n\s+protocol += "-1"/);
  });

  it('explains the internet side instead of exporting it', () => {
    expect(r.notes.join('\n')).toMatch(/203\.0\.113\.0\/24 is the outside of R1's NAT/);
    expect(r.notes.join('\n')).toMatch(/Web sits on the internet side/);
    expect(code(r.text)).not.toContain('203.0.113');
  });

  it('instances are off unless asked for, and keep their addresses', () => {
    expect(r.text).toMatch(/variable "create_instances" \{[\s\S]*?default += false/);
    expect(block(r.text, 'aws_instance', 'pc1')).toContain('count                  = var.create_instances ? 1 : 0');
    expect(block(r.text, 'aws_instance', 'pc1')).toContain('private_ip             = "192.168.1.10"');
  });

  it('an ACL applied OUT becomes INGRESS rules, with the source as the CIDR', () => {
    let t = setAcl(topology, Object.values(topology.devices).find((d) => d.hostname === 'R1')!.id, '120', {
      type: 'extended',
      rules: [{ action: 'deny', protocol: 'tcp', src: '198.51.100.0', srcWildcard: '0.0.0.255', dst: '192.168.1.0', dstWildcard: '0.0.0.255', dstPort: 3389 }],
    });
    t = setInterfaceOptions(t, iface(t, 'R1', 'GigabitEthernet0/0').id, { aclIn: null, aclOut: '120' });
    const nacl = block(tf(t).text, 'aws_network_acl', 'r1_gigabitethernet0_0');
    expect(nacl).toMatch(/ingress \{\n\s+# ACL 120 line 1[\s\S]*?action += "deny"[\s\S]*?cidr_block += "198\.51\.100\.0\/24"[\s\S]*?from_port += 3389/);
    expect(nacl).toMatch(/No IOS ACL filtered this direction[\s\S]*?egress \{\n\s+rule_no += 100/);
  });

  it('rules a network ACL cannot express are reported, not guessed', () => {
    const r1 = Object.values(topology.devices).find((d) => d.hostname === 'R1')!;
    const t = setAcl(topology, r1.id, '110', {
      type: 'extended',
      rules: [
        { action: 'deny', protocol: 'tcp', src: '192.168.1.10', srcWildcard: '0.0.0.0', dst: '0.0.0.0', dstWildcard: '255.255.255.255', dstPort: 25 },
        { action: 'permit', protocol: 'ip', src: '172.16.0.0', srcWildcard: '0.0.255.255', dst: '0.0.0.0', dstWildcard: '255.255.255.255' },
      ],
    });
    const notes = tf(t).notes.join('\n');
    expect(notes).toMatch(/line 1 .*matches only part of 192\.168\.1\.0\/24.*security group/);
    expect(notes).toMatch(/line 2 .*never matches traffic of 192\.168\.1\.0\/24/);
  });
});

describe('the AWS rules the export enforces', () => {
  it('router-to-router links disappear and separate /16s become secondary CIDR blocks', () => {
    const r = tf(lab('ospf-cheapest-path').topology);
    expect(r.notes.filter((n) => /only links routers together/.test(n))).toHaveLength(3);
    expect(r.text).toContain('resource "aws_vpc_ipv4_cidr_block_association" "extra_1"');
    expect(r.text).toMatch(/depends_on += \[aws_vpc_ipv4_cidr_block_association\.extra_1\]/);
    expect(r.text).not.toContain('router ospf');
  });

  it('refuses to mix RFC 1918 blocks in one VPC', () => {
    const r = tf(lab('dhcp-relay').topology);
    expect(r.notes.join('\n')).toMatch(/10\.0\.0\.0\/24 is in 10\.0\.0\.0\/8, but the VPC uses 192\.168\.0\.0\/16/);
  });

  it('flags host addresses AWS reserves and does not pin them', () => {
    const r = tf(lab('hub-vs-switch').topology);
    expect(r.notes.join('\n')).toMatch(/PC0 uses 10\.0\.0\.1, which AWS reserves/);
    expect(block(r.text, 'aws_instance', 'pc0')).not.toContain('private_ip');
    expect(block(r.text, 'aws_instance', 'pc3')).toContain('"10.0.0.4"');
  });

  it('puts each VLAN in its own subnet and finds DHCP hosts through switches and VLANs', () => {
    const t = lab('vlans-router-on-a-stick').topology;
    const r = tf(t);
    expect(r.text).toContain('resource "aws_subnet" "r1_gigabitethernet0_0_10"');
    expect(r.text).toContain('resource "aws_subnet" "r1_gigabitethernet0_0_20"');
    const dhcp = tf(lab('dhcp-relay').topology);
    expect(block(dhcp.text, 'aws_instance', 'pc2')).toContain('aws_subnet.r1_gigabitethernet0_1.id');
    expect(block(dhcp.text, 'aws_instance', 'pc2')).toContain('DHCP: AWS picks the address');
  });

  it('a project name cannot inject Terraform expressions', () => {
    const r = tf(lab('two-lans-one-router').topology, 'x"}${file("~/.aws/credentials")}');
    checkHcl(r.text);
    expect(code(r.text)).not.toMatch(/(?<!\$)\$\{file/);
    expect(code(r.text)).toContain('"x-file-aws-credentials"'); // the variable default is sanitised too
  });

  it('helpers: supernet and wildcard prefixes', () => {
    expect(__test.prefixOfWildcard('0.0.0.255')).toBe(24);
    expect(__test.prefixOfWildcard('0.0.255.0')).toBeNull();
    expect(__test.prefixOfWildcard('255.255.255.255')).toBe(0);
  });
});
