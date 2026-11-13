// Every problem that is solved on a router or switch must be solvable by
// typing the commands its hints and solution quote into the CLI. This test
// types them into the start network and grades the result: it catches a
// hint that names a command the CLI does not accept, and a problem whose
// tests cannot be passed from the CLI at all.
import { describe, expect, it } from 'vitest';
import { execute, newSession, type CliEnv } from '../../cli/ios';
import { DEFAULT_PLUGINS } from '../../engine/plugins';
import { Simulation } from '../../engine/simulation';
import { traceroute } from '../../engine/traceroute';
import { grade } from '../../grading/grade';
import { setDefaultGateway } from '../../model/ops';
import type { Topology } from '../../model/types';
import { instantiate } from '../params';
import { problemBySlug } from '.';

function typeAll(start: Topology, script: Record<string, string[]>): Topology {
  let t = start;
  const env: CliEnv = {
    topology: () => t,
    apply: (change) => {
      t = change(t);
    },
    sim: () => new Simulation(t, DEFAULT_PLUGINS).boot().run(5000),
    probe: (req) => {
      const s = new Simulation(t, DEFAULT_PLUGINS).boot().run(5000);
      const p = s.probe(req);
      s.run(5000);
      return p;
    },
    traceroute: (id, dst) => traceroute(new Simulation(t, DEFAULT_PLUGINS).boot().run(5000), id, dst),
  };
  for (const [device, lines] of Object.entries(script)) {
    let s = newSession(device);
    for (const line of ['enable', 'configure terminal', ...lines]) {
      const r = execute(s, line, env);
      // IOS prints this one as a notice, not a rejection.
      const errors = r.output.filter((o) => o.startsWith('% ') && !o.includes('Creating vlan'));
      expect(errors, `${device}# ${line}`).toEqual([]);
      s = r.session;
    }
  }
  return t;
}

const NAT = ['access-list 1 permit 192.168.1.0 0.0.0.255', 'ip nat inside source list 1 interface gi0/1 overload', 'interface gi0/0', 'ip nat inside', 'interface gi0/1', 'ip nat outside', 'exit'];
const OSPF = (id: string) => ['router ospf 1', `router-id ${id}`, 'network 10.0.0.0 0.255.255.255 area 0'];

const SCRIPTS: Record<string, Record<string, string[]> | ((v: Record<string, string | number>) => Record<string, string[]>)> = {
  'static-routes': { R1: ['ip route 10.2.0.0 255.255.255.0 10.0.12.2'], R2: ['ip route 10.1.0.0 255.255.255.0 10.0.12.1'] },
  'wrong-vlan': { S1: ['interface FastEthernet0/2', 'switchport access vlan 10'] },
  'first-vlan': { S1: ['interface fa0/1', 'switchport access vlan 20', 'interface fa0/2', 'switchport access vlan 20'] },
  'trunk-between-switches': { S1: ['interface gi0/1', 'switchport mode trunk'], S2: ['interface gi0/1', 'switchport mode trunk'] },
  'stp-root': { S1: ['spanning-tree vlan 1 priority 4096'] },
  'router-on-a-stick': {
    S1: ['interface gi0/1', 'switchport mode trunk'],
    R1: ['interface gi0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0', 'interface gi0/0.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0'],
  },
  'inter-vlan-from-scratch': (v) => ({
    S1: ['interface gi0/1', 'switchport mode trunk'],
    R1: [`interface gi0/0.${v.vA}`, `encapsulation dot1Q ${v.vA}`, `ip address 10.${v.octA}.${v.vA}.1 255.255.255.0`, `interface gi0/0.${v.vB}`, `encapsulation dot1Q ${v.vB}`, `ip address 10.${v.octB}.${v.vB}.1 255.255.255.0`],
  }),
  'port-shut-down': { R1: ['interface gi0/1', 'no shutdown'] },
  'default-route': { R1: ['ip route 0.0.0.0 0.0.0.0 100.64.0.1'] },
  'rip-silent-router': { R2: ['router rip', 'version 2', 'network 10.0.0.0'] },
  'ospf-three-routers': { R1: OSPF('1.1.1.1'), R2: OSPF('2.2.2.2'), R3: OSPF('3.3.3.3') },
  'ospf-slow-path': { R1: ['interface gi0/1', 'no ip ospf cost'], R3: ['interface gi0/1', 'no ip ospf cost'] },
  'dhcp-pool': { R1: ['ip dhcp pool STAFF', 'network 10.0.1.0 255.255.255.0', 'default-router 10.0.1.1', 'dns-server 10.0.2.10'] },
  'dhcp-relay': { R1: ['interface gi0/0', 'ip helper-address 10.0.2.10'] },
  'acl-block-ssh': {
    R1: ['access-list 110 deny tcp 10.0.1.0 0.0.0.255 any eq 22', 'access-list 110 permit tcp 10.0.1.0 0.0.0.255 any eq 80', 'access-list 110 permit icmp any any', 'interface gi0/0', 'ip access-group 110 in'],
  },
  'pat-overload': { R1: NAT },
  'secure-the-edge': { R1: [...NAT, 'access-list 110 permit tcp 192.168.1.0 0.0.0.255 any eq 80', 'access-list 110 permit icmp any any', 'interface gi0/0', 'ip access-group 110 in'] },
  'ipv6-static-routes': { R1: ['ipv6 route 2001:db8:b::/64 2001:db8:12::2'], R2: ['ipv6 route 2001:db8:a::/64 2001:db8:12::1'] },
  'three-faults': { R2: ['ip route 10.3.0.0 255.255.255.0 10.0.23.2'], R3: ['no ip route 10.1.0.0 255.255.255.0 10.0.23.3', 'ip route 10.1.0.0 255.255.255.0 10.0.23.1'] },
};

/** Fixes that happen on a PC's Config tab rather than in IOS. */
const HOST_FIX: Record<string, (t: Topology) => Topology> = {
  'three-faults': (t) => setDefaultGateway(t, 'PC3', '10.3.0.1'),
};

describe('problems are solvable from the CLI with the commands the hints quote', () => {
  it.each(Object.keys(SCRIPTS))('%s', (slug) => {
    const spec = problemBySlug(slug)!;
    expect(spec, slug).toBeDefined();
    const v = instantiate(spec, spec.params ? 20261112 : undefined);
    const script = SCRIPTS[slug];
    let t = typeAll(v.start(v.values), typeof script === 'function' ? script(v.values) : script);
    t = HOST_FIX[slug]?.(t) ?? t;
    const report = grade(t, v, { seed: v.seed });
    expect(report.tests.filter((x) => !x.pass).map((x) => `${x.id}: ${x.detail}`)).toEqual([]);
  });
});
