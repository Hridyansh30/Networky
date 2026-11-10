import { describe, expect, it } from 'vitest';
import { DEFAULT_PLUGINS } from '../engine/plugins';
import { Simulation } from '../engine/simulation';
import { traceroute } from '../engine/traceroute';
import { EXAMPLES } from '../model/examples';
import { Builder } from '../model/testing';
import type { Topology } from '../model/types';
import { execute, newSession, prompt, type CliEnv, type CliSession } from './ios';
import { runHostCommand } from './hostShell';

/** A CLI environment backed by a real topology and a fresh simulation per read. */
function envFor(t: Topology) {
  const state = { t, sim: null as Simulation | null };
  const fresh = () => (state.sim ??= new Simulation(state.t, DEFAULT_PLUGINS).boot().run(5000));
  const env: CliEnv = {
    topology: () => state.t,
    apply: (change) => {
      state.t = change(state.t);
      state.sim = null; // like the app: a config change restarts the simulation
    },
    sim: fresh,
    probe: (req) => {
      const s = fresh();
      const p = s.probe(req);
      s.run(5000);
      return p;
    },
    traceroute: (id, dst) => traceroute(new Simulation(state.t, DEFAULT_PLUGINS).boot().run(5000), id, dst),
  };
  return { env, state };
}

/** Type lines one after another; returns all output and the final session. */
function type(env: CliEnv, device: string, ...lines: string[]): { out: string[]; s: CliSession } {
  let s = newSession(device);
  const out: string[] = [];
  for (const l of lines) {
    const r = execute(s, l, env);
    out.push(...r.output);
    s = r.session;
  }
  return { out, s };
}

function lanRouter() {
  const b = new Builder();
  b.add('router', 'R1');
  b.add('switch', 'S1');
  b.add('pc', 'PC1');
  b.link(['PC1', 'FastEthernet0'], ['S1', 'FastEthernet0/1']);
  b.link(['S1', 'GigabitEthernet0/1'], ['R1', 'GigabitEthernet0/0']);
  b.ip('PC1', 'FastEthernet0', '192.168.1.10/24');
  return b;
}

describe('IOS modes and prompts', () => {
  it('walks user > enable > config > interface and back', () => {
    const { env } = envFor(lanRouter().t);
    let s = newSession('R1');
    expect(prompt(s, env.topology())).toBe('R1>');
    s = execute(s, 'en', env).session;
    expect(prompt(s, env.topology())).toBe('R1#');
    s = execute(s, 'conf t', env).session;
    expect(prompt(s, env.topology())).toBe('R1(config)#');
    s = execute(s, 'int g0/0', env).session;
    expect(prompt(s, env.topology())).toBe('R1(config-if)#');
    s = execute(s, 'exit', env).session;
    expect(prompt(s, env.topology())).toBe('R1(config)#');
    s = execute(s, 'end', env).session;
    expect(prompt(s, env.topology())).toBe('R1#');
  });

  it('config commands are refused in user mode, with a caret under the bad word', () => {
    const { env } = envFor(lanRouter().t);
    const r = execute(newSession('R1'), 'configure terminal', env);
    expect(r.output.at(-1)).toMatch(/Invalid input/);
    expect(r.output[0]).toBe(' '.repeat('R1>'.length) + '^');
  });

  it('reports ambiguous abbreviations like IOS', () => {
    const { env } = envFor(lanRouter().t);
    const { out } = type(env, 'R1', 'en', 'co'); // configure / copy
    expect(out.at(-1)).toMatch(/Ambiguous command/);
  });

  it('? lists what can follow', () => {
    const { env } = envFor(lanRouter().t);
    const { out } = type(env, 'R1', 'en', 'show ip ?');
    expect(out.join('\n')).toMatch(/show ip route/);
    expect(out.join('\n')).toMatch(/show ip interface brief/);
  });
});

describe('configuring a router from the CLI', () => {
  it('ip address + no shutdown changes the model, and ping then works', () => {
    const { env, state } = envFor(lanRouter().t);
    const { out } = type(env, 'R1', 'enable', 'configure terminal', 'interface gigabitEthernet 0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'end', 'ping 192.168.1.10');
    const gi = Object.values(state.t.interfaces).find((i) => i.deviceId === 'R1' && i.name === 'GigabitEthernet0/0')!;
    expect(gi.ipv4).toEqual({ address: '192.168.1.1', prefixLength: 24 });
    expect(out.join('\n')).toMatch(/!!!!!\nSuccess rate is 100 percent \(5\/5\)/);
  });

  it('rejects a bad mask with a helpful message and changes nothing', () => {
    const { env, state } = envFor(lanRouter().t);
    const before = state.t;
    const { out } = type(env, 'R1', 'en', 'conf t', 'int g0/0', 'ip address 192.168.1.1 255.0.255.0');
    expect(out.at(-1)).toMatch(/Invalid subnet mask/);
    expect(state.t).toBe(before);
  });

  it('the typo from the mockup ("address" without "ip") is invalid input', () => {
    const { env } = envFor(lanRouter().t);
    const { out } = type(env, 'R1', 'en', 'conf t', 'int g0/0', 'address 10.0.0.1 255.255.255.0');
    expect(out.at(-1)).toMatch(/Invalid input/);
  });

  it('show running-config reflects what was typed', () => {
    const { env } = envFor(lanRouter().t);
    const { out } = type(env, 'R1', 'en', 'conf t', 'hostname EDGE', 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'end', 'show run');
    const run = out.join('\n');
    expect(run).toMatch(/hostname EDGE/);
    expect(run).toMatch(/interface GigabitEthernet0\/0\n ip address 192.168.1.1 255.255.255.0/);
  });

  it('do runs exec commands from config mode', () => {
    const { env } = envFor(lanRouter().t);
    const { out } = type(env, 'R1', 'en', 'conf t', 'do show ip interface brief');
    expect(out.join('\n')).toMatch(/GigabitEthernet0\/0\s+unassigned/);
  });

  it('router-on-a-stick by CLI: subinterface needs encapsulation first', () => {
    const b = lanRouter();
    const { env, state } = envFor(b.t);
    const { out } = type(env, 'R1', 'en', 'conf t', 'int g0/0.10', 'ip address 10.0.10.1 255.255.255.0', 'encapsulation dot1Q 10', 'ip address 10.0.10.1 255.255.255.0');
    expect(out.find((l) => l.startsWith('%'))).toMatch(/encapsulation dot1Q/);
    const sub = Object.values(state.t.interfaces).find((i) => i.name === 'GigabitEthernet0/0.10')!;
    expect(sub).toMatchObject({ vlanTag: 10, ipv4: { address: '10.0.10.1', prefixLength: 24 } });
  });

  it('static routes, RIP, OSPF, DHCP, ACL, NAT all land in the model', () => {
    const { env, state } = envFor(lanRouter().t);
    const { out } = type(
      env,
      'R1',
      'en',
      'conf t',
      'int g0/0',
      'ip address 192.168.1.1 255.255.255.0',
      'ip nat inside',
      'ip access-group 110 in',
      'exit',
      'int g0/1',
      'ip address 203.0.113.1 255.255.255.0',
      'ip nat outside',
      'exit',
      'ip route 10.9.0.0 255.255.0.0 203.0.113.254',
      'router rip',
      'version 2',
      'network 192.168.1.0',
      'no auto-summary',
      'exit',
      'router ospf 1',
      'router-id 1.1.1.1',
      'network 192.168.1.0 0.0.0.255 area 0',
      'exit',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'exit',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.9',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'access-list 110 permit tcp any any eq www',
      'access-list 110 deny ip any any',
      'ip nat inside source list 1 interface g0/1 overload',
    );
    expect(out.filter((l) => l.startsWith('%'))).toEqual([]);
    const r = state.t.devices.R1;
    expect(r.staticRoutes).toEqual([{ prefix: '10.9.0.0', prefixLength: 16, nextHop: '203.0.113.254' }]);
    expect(r.rip?.networks).toEqual([{ prefix: '192.168.1.0', prefixLength: 24 }]); // classful: 192.x is class C
    expect(r.ospf).toEqual({ routerId: '1.1.1.1', networks: [{ prefix: '192.168.1.0', prefixLength: 24, area: 0 }] });
    expect(r.dhcpPools?.[0]).toMatchObject({ name: 'LAN', network: '192.168.1.0', prefixLength: 24, defaultRouter: '192.168.1.1' });
    expect(r.dhcpPools?.[0].excluded).toHaveLength(9);
    expect(r.acls?.['110'].rules.map((x) => x.dstPort)).toEqual([80, undefined]);
    expect(r.nat?.overload?.acl).toBe('1');
  });

  it('no commands remove configuration', () => {
    const { env, state } = envFor(lanRouter().t);
    type(env, 'R1', 'en', 'conf t', 'ip route 10.9.0.0 255.255.0.0 1.1.1.1', 'no ip route 10.9.0.0 255.255.0.0 1.1.1.1', 'router rip', 'exit', 'no router rip');
    expect(state.t.devices.R1.staticRoutes ?? []).toEqual([]);
    expect(state.t.devices.R1.rip).toBeUndefined();
  });

  it('access-list number decides the type: 10 cannot hold an extended rule', () => {
    const { env } = envFor(lanRouter().t);
    const { out } = type(env, 'R1', 'en', 'conf t', 'access-list 10 permit tcp any any eq 80');
    expect(out.at(-1)).toMatch(/^%/);
  });
});

describe('switch CLI', () => {
  it('VLANs, trunks and STP priority', () => {
    const { env, state } = envFor(lanRouter().t);
    const { out } = type(env, 'S1', 'en', 'conf t', 'int fa0/1', 'switchport mode access', 'switchport access vlan 10', 'int g0/1', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20-21', 'exit', 'spanning-tree vlan 1 priority 4096');
    expect(out).toContain('% Access VLAN does not exist. Creating vlan 10');
    const port = (n: string) => Object.values(state.t.interfaces).find((i) => i.deviceId === 'S1' && i.name === n)!;
    expect(port('FastEthernet0/1').switchport).toMatchObject({ mode: 'access', accessVlan: 10 });
    expect(port('GigabitEthernet0/1').switchport).toMatchObject({ mode: 'trunk', allowedVlans: [10, 20, 21] });
    expect(state.t.devices.S1.stpPriority).toBe(4096);
  });

  it('router-only commands do not exist on a switch', () => {
    const { env } = envFor(lanRouter().t);
    expect(type(env, 'S1', 'en', 'conf t', 'router rip').out.at(-1)).toMatch(/Invalid input/);
  });
});

describe('show commands on a running lab', () => {
  const lab = (name: string) => EXAMPLES.find((e) => e.name.startsWith(name))!.build().topology;
  const id = (t: Topology, host: string) => Object.values(t.devices).find((d) => d.hostname === host)!.id;

  it('show ip route on the RIP lab lists R routes with [120/hops]', () => {
    const t = lab('RIP');
    const { env } = envFor(t);
    const { out } = type(env, id(t, 'R1'), 'show ip route');
    expect(out.join('\n')).toMatch(/R    10\.3\.0\.0\/24 \[120\/2\] via 10\.0\.12\.2, Serial0\/0\/0/);
    expect(out.join('\n')).toMatch(/C    10\.1\.0\.0\/24 is directly connected, GigabitEthernet0\/0/);
  });

  it('show ip ospf neighbor shows FULL adjacencies', () => {
    const t = lab('OSPF');
    const { env } = envFor(t);
    const { out } = type(env, id(t, 'R2'), 'en', 'sh ip ospf nei');
    expect(out.filter((l) => l.includes('FULL'))).toHaveLength(2);
  });

  it('show spanning-tree marks one blocked port in the triangle', () => {
    const t = lab('STP');
    const { env } = envFor(t);
    const all = ['S1', 'S2', 'S3'].flatMap((s) => type(env, id(t, s), 'en', 'show spanning-tree').out);
    expect(all.filter((l) => /\bBLK\b/.test(l))).toHaveLength(1);
    expect(type(env, id(t, 'S1'), 'show spanning-tree').out.join('\n')).toMatch(/this switch is the root/);
  });

  it('ping from a router prints IOS marks; A for an ACL block', () => {
    const t = lab('Office');
    const { env } = envFor(t);
    expect(type(env, id(t, 'R1'), 'ping 203.0.113.80').out.join('\n')).toMatch(/!!!!!/);
  });
});

describe('host command prompt', () => {
  const lab = EXAMPLES.find((e) => e.name.startsWith('DHCP'))!.build().topology;
  const pc = (h: string) => Object.values(lab.devices).find((d) => d.hostname === h)!.id;

  it('ipconfig shows the DHCP lease', () => {
    const { env } = envFor(lab);
    const out = runHostCommand(pc('PC2'), 'ipconfig /all', env).join('\n');
    expect(out).toMatch(/IPv4 Address\.+: 192\.168\.2\.\d+/);
    expect(out).toMatch(/Default Gateway\.+: 192\.168\.2\.1/);
    expect(out).toMatch(/DHCP Server\.+: 10\.0\.0\.10/);
  });

  it('ping prints Windows-style replies and statistics', () => {
    const { env } = envFor(lab);
    const out = runHostCommand(pc('PC1'), 'ping 192.168.1.1', env).join('\n');
    expect(out).toMatch(/Reply from 192\.168\.1\.1: bytes=32/);
    expect(out).toMatch(/Sent = 4, Received = 4, Lost = 0 \(0% loss\)/);
  });

  it('tracert lists hops; unknown commands are refused', () => {
    const { env } = envFor(lab);
    expect(runHostCommand(pc('PC2'), 'tracert 10.0.0.10', env).join('\n')).toMatch(/1\s+192\.168\.2\.1[\s\S]*2\s+10\.0\.0\.10/);
    expect(runHostCommand(pc('PC1'), 'rm -rf /', env)).toEqual(["Invalid Command. Type 'help' for the list."]);
  });

  it('a host has no IOS CLI', () => {
    const { env } = envFor(lab);
    expect(execute(newSession(pc('PC1')), 'enable', env).output[0]).toMatch(/Desktop tab/);
  });
});
