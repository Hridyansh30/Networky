// A Cisco IOS-style command line for routers and switches.
//
// It is a thin translator: every configuration command calls the same model
// op the Config tab uses (ops.ts), and every show command reads the same
// simulation state the Tables tab shows. So the CLI can never put a device
// into a state the GUI couldn't, and both always agree.
//
// Structure:
//   - MODES: user (R1>), privileged exec (R1#), global config, interface,
//     router, DHCP pool and named ACL sub-modes, each with its own prompt.
//   - COMMANDS: a registry. Each entry lists the modes it works in, its
//     keyword path ('show ip route'), and a run() function. IOS-style
//     abbreviations ('sh ip int br') are resolved against the registry.
//   - 'no <command>' and 'do <exec command>' are handled once, here.
//
// Adding a command = adding one registry entry (see the end of this file
// and show.ts for show commands).

import { parseRule } from '../model/acl';
import { isHostKind } from '../model/catalog';
import { isValidIPv4, maskToPrefix, networkOf, formatIPv4, parseIPv4 } from '../model/ip';
import { parseCidr6 } from '../model/ip6';
import * as ops from '../model/ops';
import type { Acl, Device, DeviceKind, DhcpPool, Interface, Topology } from '../model/types';
import type { Probe, ProbeRequest } from '../engine/plugin';
import type { Simulation } from '../engine/simulation';
import type { TraceHop } from '../engine/traceroute';
import { classfulPrefix, expandInterfaceName, findInterface, matchKeyword, parseVlanList, tokenize } from './parse';
import { runningConfig } from './runningConfig';
import { SHOW_COMMANDS } from './show';

export type Mode = 'user' | 'exec' | 'config' | 'if' | 'router-rip' | 'router-ospf' | 'dhcp' | 'nacl';

export interface CliSession {
  deviceId: string;
  mode: Mode;
  /** interface mode: the interface being configured */
  ifId?: string;
  /** a subinterface typed but not created yet (needs 'encapsulation dot1Q') */
  pendingSub?: { parentId: string; number: number };
  /** dhcp mode: the pool being edited (created once it has a network) */
  pool?: Partial<DhcpPool> & { name: string };
  /** named ACL mode */
  acl?: { name: string; type: Acl['type'] };
}

/** What the CLI needs from the app. The store provides it; tests provide a fake. */
export interface CliEnv {
  topology(): Topology;
  /** Run a model op. Throws (TopologyError) with a message if the op refuses. */
  apply(change: (t: Topology) => Topology): void;
  sim(): Simulation;
  /** Send one ping / TCP probe and run until it finishes. */
  probe(request: ProbeRequest): Probe;
  traceroute(deviceId: string, destination: string): TraceHop[];
}

export interface CliResult {
  session: CliSession;
  output: string[];
}

export function newSession(deviceId: string): CliSession {
  return { deviceId, mode: 'user' };
}

export function prompt(s: CliSession, t: Topology): string {
  const host = t.devices[s.deviceId]?.hostname ?? '?';
  const sub = s.ifId ? !!t.interfaces[s.ifId]?.parentId : !!s.pendingSub;
  const suffix: Record<Mode, string> = {
    user: '>',
    exec: '#',
    config: '(config)#',
    if: sub ? '(config-subif)#' : '(config-if)#',
    'router-rip': '(config-router)#',
    'router-ospf': '(config-router)#',
    dhcp: '(dhcp-config)#',
    nacl: s.acl?.type === 'extended' ? '(config-ext-nacl)#' : '(config-std-nacl)#',
  };
  return host + suffix[s.mode];
}

// ================================================================ registry

export interface RunContext {
  session: CliSession;
  env: CliEnv;
  device: Device;
  args: string[];
  negate: boolean;
  out: string[];
  /** Replace session fields (mode changes). */
  set(patch: Partial<CliSession>): void;
  /** Run a model op; errors become '% ...' lines. Returns success. */
  apply(change: (t: Topology) => Topology): boolean;
}

export interface Command {
  modes: Mode[];
  words: string[];
  /** Arguments, for '?' help: 'A.B.C.D A.B.C.D' */
  syntax?: string;
  help: string;
  /** Only on these device kinds (default: router and switch). */
  kinds?: DeviceKind[];
  /** Accepts a leading 'no'. */
  negatable?: boolean;
  run(c: RunContext): void;
}

const EXEC: Mode[] = ['user', 'exec'];
const PRIV: Mode[] = ['exec'];
const CONFIG: Mode[] = ['config'];
const IF: Mode[] = ['if'];
const ROUTER: DeviceKind[] = ['router'];
const SWITCH: DeviceKind[] = ['switch'];
const SUBMODES: Mode[] = ['if', 'router-rip', 'router-ospf', 'dhcp', 'nacl'];

const fail = (c: RunContext, msg: string) => c.out.push(`% ${msg}`);

function need(c: RunContext, n: number, syntax: string): boolean {
  if (c.args.length >= n) return true;
  fail(c, `Incomplete command. Usage: ${syntax}`);
  return false;
}

function ipMask(c: RunContext, ip: string | undefined, mask: string | undefined): { address: string; prefixLength: number } | null {
  if (!ip || !isValidIPv4(ip)) return fail(c, `Invalid address '${ip ?? ''}'`), null;
  const prefixLength = mask ? maskToPrefix(mask) : null;
  if (prefixLength === null) return fail(c, `Invalid subnet mask '${mask ?? ''}' (expected e.g. 255.255.255.0)`), null;
  return { address: ip, prefixLength };
}

/** Wildcard mask -> prefix length (0.0.0.255 -> 24). */
function wildcardPrefix(w: string): number | null {
  const n = parseIPv4(w);
  if (n === null || ((n + 1) & n) !== 0) return null;
  return 32 - Math.log2(n + 1);
}

function currentIf(c: RunContext): Interface | null {
  const i = c.session.ifId ? c.env.topology().interfaces[c.session.ifId] : undefined;
  if (!i) {
    if (c.session.pendingSub) fail(c, "Configure 'encapsulation dot1Q <vlan>' first: the subinterface needs its VLAN before anything else");
    else fail(c, 'No interface selected');
    return null;
  }
  return i;
}

/** Commit the DHCP pool being edited (once it has a network). */
function savePool(c: RunContext, pool: CliSession['pool']) {
  c.set({ pool });
  if (!pool?.network || pool.prefixLength === undefined) return;
  const others = (c.device.dhcpPools ?? []).filter((p) => p.name !== pool.name);
  const existing = c.device.dhcpPools?.find((p) => p.name === pool.name);
  const full: DhcpPool = { ...existing, ...pool, network: pool.network, prefixLength: pool.prefixLength };
  c.apply((t) => ops.setDhcpPools(t, c.device.id, [...others, full]));
}

function aclAppend(c: RunContext, name: string, type: Acl['type'], ruleText: string) {
  let rule;
  try {
    rule = parseRule(ruleText, type);
  } catch (e) {
    return fail(c, (e as Error).message);
  }
  const existing = c.device.acls?.[name];
  if (existing && existing.type !== type) return fail(c, `ACL ${name} is a ${existing.type} ACL`);
  c.apply((t) => ops.setAcl(t, c.device.id, name, { type, rules: [...(existing?.rules ?? []), rule] }));
}

const COMMANDS: Command[] = [
  // --------------------------------------------------------------- modes
  { modes: ['user'], words: ['enable'], help: 'Enter privileged EXEC mode', run: (c) => c.set({ mode: 'exec' }) },
  { modes: PRIV, words: ['disable'], help: 'Return to user EXEC mode', run: (c) => c.set({ mode: 'user' }) },
  {
    modes: PRIV,
    words: ['configure', 'terminal'],
    help: 'Enter global configuration mode',
    run: (c) => {
      c.out.push('Enter configuration commands, one per line.  End with CNTL/Z.');
      c.set({ mode: 'config' });
    },
  },
  {
    modes: ['user', 'exec', 'config', ...SUBMODES],
    words: ['exit'],
    help: 'Exit the current mode',
    run: (c) => {
      const m = c.session.mode;
      if (m === 'user' || m === 'exec') c.set({ mode: 'user' });
      else if (m === 'config') c.set({ mode: 'exec' });
      else c.set({ mode: 'config', ifId: undefined, pendingSub: undefined, pool: undefined, acl: undefined });
    },
  },
  {
    modes: ['config', ...SUBMODES],
    words: ['end'],
    help: 'Return to privileged EXEC mode',
    run: (c) => c.set({ mode: 'exec', ifId: undefined, pendingSub: undefined, pool: undefined, acl: undefined }),
  },

  // ---------------------------------------------------------- exec tools
  {
    modes: EXEC,
    words: ['ping'],
    syntax: '<ip or ipv6 address>',
    help: 'Send ICMP echo requests (5)',
    run: (c) => {
      const dst = c.args[0] === 'ipv6' || c.args[0] === 'ip' ? c.args[1] : c.args[0];
      if (!dst) return fail(c, 'Incomplete command. Usage: ping <address>');
      c.out.push('Type escape sequence to abort.', `Sending 5, 100-byte ICMP Echos to ${dst}, timeout is 2 seconds:`);
      const marks: string[] = [];
      const rtts: number[] = [];
      for (let seq = 1; seq <= 5; seq++) {
        const p = c.env.probe({ kind: 'ping', sourceDeviceId: c.device.id, destination: dst, seq });
        marks.push(PING_MARK[p.status] ?? '.');
        if (p.status === 'success' && p.rttTicks !== undefined) rtts.push(p.rttTicks);
        if (seq === 1 && p.status === 'unreachable' && !p.respondent) {
          // nothing was sent at all (no route / bad address): IOS prints the reason once
          c.out.push(`% ${p.detail}`);
          return;
        }
      }
      c.out.push(marks.join(''));
      const ok = rtts.length;
      const stats = ok ? `, round-trip min/avg/max = ${Math.min(...rtts)}/${Math.round(rtts.reduce((a, b) => a + b, 0) / ok)}/${Math.max(...rtts)} ms` : '';
      c.out.push(`Success rate is ${ok * 20} percent (${ok}/5)${stats}`);
    },
  },
  {
    modes: EXEC,
    words: ['traceroute'],
    syntax: '<ip or ipv6 address>',
    help: 'Trace the route to a destination',
    run: (c) => {
      if (!need(c, 1, 'traceroute <address>')) return;
      c.out.push('Type escape sequence to abort.', `Tracing the route to ${c.args[0]}`, '');
      for (const h of c.env.traceroute(c.device.id, c.args[0])) {
        const n = String(h.ttl).padStart(3);
        if (h.status === 'no-answer') c.out.push(`${n}  *  *  *`);
        else c.out.push(`${n} ${h.address ?? '?'}${h.status === 'unreachable' ? ' !H' : ''}`);
      }
    },
  },
  {
    modes: PRIV,
    words: ['copy', 'running-config', 'startup-config'],
    help: 'Save the configuration',
    run: (c) => c.out.push('Destination filename [startup-config]?', 'Building configuration...', '[OK]', '(Networky saves the whole project with Save in the top bar.)'),
  },
  {
    modes: PRIV,
    words: ['write', 'memory'],
    help: 'Save the configuration',
    run: (c) => c.out.push('Building configuration...', '[OK]', '(Networky saves the whole project with Save in the top bar.)'),
  },

  // ------------------------------------------------------- global config
  {
    modes: CONFIG,
    words: ['hostname'],
    syntax: '<name>',
    help: 'Set the device name',
    kinds: ['router', 'switch'],
    run: (c) => {
      if (need(c, 1, 'hostname <name>')) c.apply((t) => ops.setHostname(t, c.device.id, c.args[0]));
    },
  },
  {
    modes: ['config', 'if', 'router-rip', 'router-ospf', 'dhcp', 'nacl'],
    words: ['interface'],
    syntax: '<type><number>  e.g. g0/0, fa0/1, g0/0.10',
    help: 'Select an interface to configure',
    run: (c) => {
      const exp = expandInterfaceName(c.args);
      if (!exp) return fail(c, `Invalid interface '${c.args.join(' ')}'. Examples: g0/0, fa0/1, s0/0/0`);
      const t = c.env.topology();
      const found = findInterface(t, c.device.id, exp.name);
      if (found) return c.set({ mode: 'if', ifId: found.id, pendingSub: undefined, pool: undefined, acl: undefined });
      const sub = exp.name.match(/^(.+)\.(\d+)$/);
      const parent = sub ? findInterface(t, c.device.id, sub[1]) : undefined;
      if (sub && parent && c.device.kind === 'router') {
        return c.set({ mode: 'if', ifId: undefined, pendingSub: { parentId: parent.id, number: Number(sub[2]) }, pool: undefined, acl: undefined });
      }
      fail(c, `${c.device.hostname} has no interface ${exp.name}`);
    },
  },
  {
    modes: CONFIG,
    words: ['ip', 'route'],
    syntax: '<network> <mask> <next-hop>',
    help: 'Add a static route',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      if (!need(c, 3, 'ip route <network> <mask> <next-hop>')) return;
      const net = ipMask(c, c.args[0], c.args[1]);
      if (!net) return;
      if (!isValidIPv4(c.args[2])) return fail(c, `Invalid next hop '${c.args[2]}'. (Exit-interface routes are not supported; use the next-hop address.)`);
      const prefix = formatIPv4(networkOf(net.address, net.prefixLength));
      if (c.negate) {
        const idx = (c.device.staticRoutes ?? []).findIndex((r) => r.prefix === prefix && r.prefixLength === net.prefixLength && r.nextHop === c.args[2]);
        if (idx < 0) return fail(c, 'No matching route to delete');
        c.apply((t) => ops.removeStaticRoute(t, c.device.id, idx));
      } else c.apply((t) => ops.addStaticRoute(t, c.device.id, { prefix, prefixLength: net.prefixLength, nextHop: c.args[2] }));
    },
  },
  {
    modes: CONFIG,
    words: ['ipv6', 'route'],
    syntax: '<prefix/length> <next-hop>',
    help: 'Add an IPv6 static route',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      if (!need(c, 2, 'ipv6 route <prefix/length> <next-hop>')) return;
      const p = parseCidr6(c.args[0]);
      if (!p) return fail(c, `Invalid prefix '${c.args[0]}' (expected e.g. 2001:db8:3::/64)`);
      if (c.negate) {
        const idx = (c.device.ipv6StaticRoutes ?? []).findIndex((r) => r.prefixLength === p.prefixLength && r.prefix === p.address);
        if (idx < 0) return fail(c, 'No matching route to delete');
        c.apply((t) => ops.removeIpv6StaticRoute(t, c.device.id, idx));
      } else c.apply((t) => ops.addIpv6StaticRoute(t, c.device.id, { prefix: p.address, prefixLength: p.prefixLength, nextHop: c.args[1] }));
    },
  },
  {
    modes: CONFIG,
    words: ['ipv6', 'unicast-routing'],
    help: 'Enable IPv6 routing',
    kinds: ROUTER,
    run: () => {
      /* routers here always forward IPv6 once an interface has an address */
    },
  },
  {
    modes: CONFIG,
    words: ['router', 'rip'],
    help: 'Configure RIP',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      if (c.negate) return void c.apply((t) => ops.setRip(t, c.device.id, null));
      if (!c.device.rip) c.apply((t) => ops.setRip(t, c.device.id, []));
      c.set({ mode: 'router-rip' });
    },
  },
  {
    modes: CONFIG,
    words: ['router', 'ospf'],
    syntax: '<process-id>',
    help: 'Configure OSPF',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      if (!need(c, 1, 'router ospf <process-id>')) return;
      if (c.negate) return void c.apply((t) => ops.setOspf(t, c.device.id, null));
      if (!c.device.ospf) c.apply((t) => ops.setOspf(t, c.device.id, { networks: [] }));
      c.set({ mode: 'router-ospf' });
    },
  },
  {
    modes: CONFIG,
    words: ['ip', 'dhcp', 'pool'],
    syntax: '<name>',
    help: 'Configure a DHCP address pool',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      if (!need(c, 1, 'ip dhcp pool <name>')) return;
      const name = c.args[0];
      if (c.negate) return void c.apply((t) => ops.setDhcpPools(t, c.device.id, (c.device.dhcpPools ?? []).filter((p) => p.name !== name)));
      c.set({ mode: 'dhcp', pool: { ...(c.device.dhcpPools?.find((p) => p.name === name) ?? {}), name } });
    },
  },
  {
    modes: CONFIG,
    words: ['ip', 'dhcp', 'excluded-address'],
    syntax: '<low> [<high>]',
    help: 'Addresses the DHCP server must not assign',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      if (!need(c, 1, 'ip dhcp excluded-address <low> [<high>]')) return;
      const lo = parseIPv4(c.args[0]);
      const hi = parseIPv4(c.args[1] ?? c.args[0]);
      if (lo === null || hi === null || hi < lo || hi - lo > 255) return fail(c, 'Invalid range (at most 256 addresses)');
      const range = Array.from({ length: hi - lo + 1 }, (_, k) => formatIPv4(lo + k));
      const pools = c.device.dhcpPools ?? [];
      const covering = pools.filter((p) => range.some((a) => networkOf(a, p.prefixLength) === parseIPv4(p.network)));
      if (!covering.length) return fail(c, 'No DHCP pool covers that range yet. Create the pool first (in this simulator exclusions are stored per pool)');
      const next = pools.map((p) => {
        if (!covering.includes(p)) return p;
        const set = new Set(p.excluded ?? []);
        for (const a of range) c.negate ? set.delete(a) : set.add(a);
        return { ...p, excluded: [...set] };
      });
      c.apply((t) => ops.setDhcpPools(t, c.device.id, next));
    },
  },
  {
    modes: CONFIG,
    words: ['access-list'],
    syntax: '<1-99|100-199> permit|deny ...',
    help: 'Add a numbered access list rule',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      if (!need(c, 1, 'access-list <number> permit|deny ...')) return;
      const num = Number(c.args[0]);
      if (c.negate) return void c.apply((t) => ops.setAcl(t, c.device.id, c.args[0], null));
      const type = num >= 1 && num <= 99 ? 'standard' : num >= 100 && num <= 199 ? 'extended' : null;
      if (!type) return fail(c, 'Access list numbers are 1-99 (standard) or 100-199 (extended)');
      aclAppend(c, c.args[0], type, c.args.slice(1).join(' '));
    },
  },
  {
    modes: CONFIG,
    words: ['ip', 'access-list'],
    syntax: 'standard|extended <name>',
    help: 'Create or edit a named access list',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      if (!need(c, 2, 'ip access-list standard|extended <name>')) return;
      const type = matchKeyword(c.args[0], ['standard', 'extended']);
      if (type !== 'standard' && type !== 'extended') return fail(c, "Expected 'standard' or 'extended'");
      if (c.negate) return void c.apply((t) => ops.setAcl(t, c.device.id, c.args[1], null));
      const existing = c.device.acls?.[c.args[1]];
      if (existing && existing.type !== type) return fail(c, `ACL ${c.args[1]} already exists as a ${existing.type} ACL`);
      c.set({ mode: 'nacl', acl: { name: c.args[1], type } });
    },
  },
  {
    modes: CONFIG,
    words: ['ip', 'nat', 'inside', 'source', 'static'],
    syntax: '<inside-local> <inside-global>',
    help: 'Static NAT: publish an inside host',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      if (!need(c, 2, 'ip nat inside source static <local> <global>')) return;
      const nat = c.device.nat ?? { statics: [] };
      const statics = nat.statics.filter((s) => s.local !== c.args[0]);
      if (!c.negate) statics.push({ local: c.args[0], global: c.args[1] });
      c.apply((t) => ops.setNat(t, c.device.id, { ...nat, statics }));
    },
  },
  {
    modes: CONFIG,
    words: ['ip', 'nat', 'inside', 'source', 'list'],
    syntax: '<acl> interface <outside-if> overload',
    help: 'PAT: share the outside interface address',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      const nat = c.device.nat ?? { statics: [] };
      if (c.negate) return void c.apply((t) => ops.setNat(t, c.device.id, { statics: nat.statics }));
      // <acl> interface <type> <num> overload   or  <acl> interface <type><num> overload
      if (!need(c, 4, 'ip nat inside source list <acl> interface <interface> overload')) return;
      if (matchKeyword(c.args[1], ['interface']) !== 'interface') return fail(c, "Expected 'interface' (address pools are not supported; use PAT with the outside interface)");
      const exp = expandInterfaceName(c.args.slice(2));
      const out = exp && findInterface(c.env.topology(), c.device.id, exp.name);
      if (!out) return fail(c, `No interface '${c.args.slice(2).join(' ')}'`);
      if (matchKeyword(c.args[2 + exp!.used] ?? '', ['overload']) !== 'overload') return fail(c, "PAT needs 'overload' at the end");
      c.apply((t) => ops.setNat(t, c.device.id, { ...nat, overload: { acl: c.args[0], outsideInterfaceId: out.id } }));
    },
  },
  {
    modes: CONFIG,
    words: ['spanning-tree', 'vlan'],
    syntax: '<vlan> priority <0-61440>',
    help: 'Set the STP bridge priority',
    kinds: SWITCH,
    negatable: true,
    run: (c) => {
      if (c.negate) return void c.apply((t) => ops.setStpPriority(t, c.device.id, 32768));
      if (!need(c, 3, 'spanning-tree vlan <vlan> priority <value>')) return;
      if (matchKeyword(c.args[1], ['priority']) !== 'priority') return fail(c, "Expected 'priority'");
      if (c.args[0] !== '1') c.out.push('% Note: this simulator runs one spanning tree for all VLANs (802.1D), so the priority applies to every VLAN.');
      c.apply((t) => ops.setStpPriority(t, c.device.id, Number(c.args[2])));
    },
  },
  {
    modes: CONFIG,
    words: ['vlan'],
    syntax: '<1-4094>',
    help: 'Create a VLAN',
    kinds: SWITCH,
    run: (c) => {
      if (!need(c, 1, 'vlan <id>')) return;
      c.out.push('% VLANs exist here as soon as a port uses them (switchport access vlan N), so there is nothing to create.');
    },
  },

  // ----------------------------------------------------------- interface
  {
    modes: IF,
    words: ['ip', 'address'],
    syntax: '<address> <mask>',
    help: 'Set the IPv4 address',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      const i = currentIf(c);
      if (!i) return;
      if (c.negate) return void c.apply((t) => ops.setInterfaceIp(t, i.id, undefined));
      const ip = ipMask(c, c.args[0], c.args[1]);
      if (ip) c.apply((t) => ops.setInterfaceIp(t, i.id, ip));
    },
  },
  {
    modes: IF,
    words: ['shutdown'],
    help: 'Disable the interface',
    negatable: true,
    run: (c) => {
      const i = currentIf(c);
      if (!i) return;
      c.apply((t) => ops.setInterfaceAdmin(t, i.id, c.negate));
      if (c.negate) c.out.push(`%LINK-5-CHANGED: Interface ${i.name}, changed state to up`);
      else c.out.push(`%LINK-5-CHANGED: Interface ${i.name}, changed state to administratively down`);
    },
  },
  {
    modes: IF,
    words: ['encapsulation', 'dot1q'],
    syntax: '<vlan>',
    help: '802.1Q VLAN of this subinterface',
    kinds: ROUTER,
    run: (c) => {
      if (!need(c, 1, 'encapsulation dot1Q <vlan>')) return;
      const vlan = Number(c.args[0]);
      const pend = c.session.pendingSub;
      if (!pend) return fail(c, 'encapsulation dot1Q is for subinterfaces (e.g. interface g0/0.10)');
      let id = '';
      if (c.apply((t) => {
        const r = ops.addSubinterface(t, pend.parentId, vlan, pend.number);
        id = r.interfaceId;
        return r.topology;
      })) c.set({ ifId: id, pendingSub: undefined });
    },
  },
  {
    modes: IF,
    words: ['ip', 'access-group'],
    syntax: '<acl> in|out',
    help: 'Filter traffic with an access list',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      const i = currentIf(c);
      if (!i || !need(c, 2, 'ip access-group <acl> in|out')) return;
      const dir = matchKeyword(c.args[1], ['in', 'out']);
      if (dir !== 'in' && dir !== 'out') return fail(c, "Expected 'in' or 'out'");
      c.apply((t) => ops.setInterfaceOptions(t, i.id, dir === 'in' ? { aclIn: c.negate ? null : c.args[0] } : { aclOut: c.negate ? null : c.args[0] }));
    },
  },
  {
    modes: IF,
    words: ['ip', 'nat'],
    syntax: 'inside|outside',
    help: 'Mark the interface as NAT inside or outside',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      const i = currentIf(c);
      if (!i || !need(c, 1, 'ip nat inside|outside')) return;
      const role = matchKeyword(c.args[0], ['inside', 'outside']);
      if (role !== 'inside' && role !== 'outside') return fail(c, "Expected 'inside' or 'outside'");
      c.apply((t) => ops.setInterfaceOptions(t, i.id, { nat: c.negate ? null : role }));
    },
  },
  {
    modes: IF,
    words: ['ip', 'helper-address'],
    syntax: '<dhcp server address>',
    help: 'Relay DHCP broadcasts to a server',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      const i = currentIf(c);
      if (!i) return;
      if (!c.negate && !need(c, 1, 'ip helper-address <address>')) return;
      c.apply((t) => ops.setInterfaceOptions(t, i.id, { helperAddress: c.negate ? null : c.args[0] }));
    },
  },
  {
    modes: IF,
    words: ['ip', 'ospf', 'cost'],
    syntax: '<1-65535>',
    help: 'Set the OSPF cost of this interface',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      const i = currentIf(c);
      if (!i) return;
      if (!c.negate && !need(c, 1, 'ip ospf cost <1-65535>')) return;
      c.apply((t) => ops.setInterfaceOptions(t, i.id, { ospfCost: c.negate ? null : Number(c.args[0]) }));
    },
  },
  {
    modes: IF,
    words: ['ipv6', 'address'],
    syntax: '<address/prefix-length>',
    help: 'Set the IPv6 address',
    kinds: ROUTER,
    negatable: true,
    run: (c) => {
      const i = currentIf(c);
      if (!i) return;
      if (c.negate) return void c.apply((t) => ops.setInterfaceOptions(t, i.id, { ipv6: null }));
      const p = parseCidr6(c.args[0] ?? '');
      if (!p) return fail(c, `Invalid IPv6 address '${c.args[0] ?? ''}' (expected e.g. 2001:db8:1::1/64)`);
      c.apply((t) => ops.setInterfaceOptions(t, i.id, { ipv6: p }));
    },
  },
  {
    modes: IF,
    words: ['switchport', 'mode'],
    syntax: 'access|trunk',
    help: 'Access port (one VLAN) or trunk (many, tagged)',
    kinds: SWITCH,
    run: (c) => {
      const i = currentIf(c);
      if (!i || !need(c, 1, 'switchport mode access|trunk')) return;
      const mode = matchKeyword(c.args[0], ['access', 'trunk']);
      if (mode !== 'access' && mode !== 'trunk') return fail(c, "Expected 'access' or 'trunk' (DTP 'dynamic' modes are not simulated)");
      c.apply((t) => ops.setSwitchport(t, i.id, { ...ops.switchportOf(i), mode }));
    },
  },
  {
    modes: IF,
    words: ['switchport', 'access', 'vlan'],
    syntax: '<1-4094>',
    help: 'VLAN of this access port',
    kinds: SWITCH,
    negatable: true,
    run: (c) => {
      const i = currentIf(c);
      if (!i) return;
      const vlan = c.negate ? 1 : Number(c.args[0]);
      if (!c.negate && !need(c, 1, 'switchport access vlan <id>')) return;
      const known = Object.values(c.env.topology().interfaces).some((x) => x.deviceId === c.device.id && x.switchport?.accessVlan === vlan);
      if (c.apply((t) => ops.setSwitchport(t, i.id, { ...ops.switchportOf(i), accessVlan: vlan })) && !known && vlan !== 1) {
        c.out.push(`% Access VLAN does not exist. Creating vlan ${vlan}`);
      }
    },
  },
  {
    modes: IF,
    words: ['switchport', 'trunk', 'native', 'vlan'],
    syntax: '<1-4094>',
    help: 'Untagged VLAN on this trunk',
    kinds: SWITCH,
    negatable: true,
    run: (c) => {
      const i = currentIf(c);
      if (!i) return;
      if (!c.negate && !need(c, 1, 'switchport trunk native vlan <id>')) return;
      c.apply((t) => ops.setSwitchport(t, i.id, { ...ops.switchportOf(i), nativeVlan: c.negate ? 1 : Number(c.args[0]) }));
    },
  },
  {
    modes: IF,
    words: ['switchport', 'trunk', 'allowed', 'vlan'],
    syntax: '<list>|all   e.g. 10,20,30-32',
    help: 'VLANs allowed on this trunk',
    kinds: SWITCH,
    negatable: true,
    run: (c) => {
      const i = currentIf(c);
      if (!i) return;
      const sp = ops.switchportOf(i);
      if (c.negate || c.args[0] === 'all') {
        const { allowedVlans: _all, ...rest } = sp;
        return void c.apply((t) => ops.setSwitchport(t, i.id, rest));
      }
      if (!need(c, 1, 'switchport trunk allowed vlan <list>')) return;
      const list = parseVlanList(c.args[0]);
      if (!list) return fail(c, `Invalid VLAN list '${c.args[0]}' (e.g. 10,20,30-32)`);
      c.apply((t) => ops.setSwitchport(t, i.id, { ...sp, allowedVlans: list }));
    },
  },

  // ---------------------------------------------------------- router rip
  {
    modes: ['router-rip'],
    words: ['version'],
    syntax: '2',
    help: 'RIP version (only 2 is simulated)',
    run: (c) => {
      if (c.args[0] !== '2') fail(c, 'Only RIP version 2 is simulated');
    },
  },
  {
    modes: ['router-rip'],
    words: ['no', 'auto-summary'],
    help: 'Do not summarise at classful boundaries',
    run: () => {
      /* this simulator never auto-summarises */
    },
  },
  {
    modes: ['router-rip'],
    words: ['network'],
    syntax: '<classful network>',
    help: 'Run RIP on interfaces in this network',
    negatable: true,
    run: (c) => {
      if (!need(c, 1, 'network <address>') || !isValidIPv4(c.args[0])) return void (c.args[0] && fail(c, `Invalid address '${c.args[0]}'`));
      // RIP 'network' is classful: 'network 10.1.2.0' enables every 10.x.x.x interface.
      const len = classfulPrefix(c.args[0]);
      const prefix = formatIPv4(networkOf(c.args[0], len));
      const nets = (c.device.rip?.networks ?? []).filter((n) => !(n.prefix === prefix && n.prefixLength === len));
      if (!c.negate) nets.push({ prefix, prefixLength: len });
      c.apply((t) => ops.setRip(t, c.device.id, nets));
    },
  },

  // --------------------------------------------------------- router ospf
  {
    modes: ['router-ospf'],
    words: ['network'],
    syntax: '<address> <wildcard> area <id>',
    help: 'Run OSPF on interfaces in this range',
    negatable: true,
    run: (c) => {
      if (!need(c, 4, 'network <address> <wildcard> area <area-id>')) return;
      const len = wildcardPrefix(c.args[1]);
      if (!isValidIPv4(c.args[0]) || len === null) return fail(c, `Invalid network/wildcard '${c.args[0]} ${c.args[1]}' (wildcard like 0.0.0.255)`);
      if (matchKeyword(c.args[2], ['area']) !== 'area') return fail(c, "Expected 'area'");
      const area = Number(c.args[3]);
      const prefix = formatIPv4(networkOf(c.args[0], len));
      const cur = c.device.ospf ?? { networks: [] };
      const nets = cur.networks.filter((n) => !(n.prefix === prefix && n.prefixLength === len));
      if (!c.negate) nets.push({ prefix, prefixLength: len, area });
      c.apply((t) => ops.setOspf(t, c.device.id, { ...cur, networks: nets }));
    },
  },
  {
    modes: ['router-ospf'],
    words: ['router-id'],
    syntax: '<A.B.C.D>',
    help: 'Set the OSPF router ID',
    negatable: true,
    run: (c) => {
      const cur = c.device.ospf ?? { networks: [] };
      if (c.negate) {
        const { routerId: _r, ...rest } = cur;
        return void c.apply((t) => ops.setOspf(t, c.device.id, rest));
      }
      if (need(c, 1, 'router-id <A.B.C.D>')) c.apply((t) => ops.setOspf(t, c.device.id, { ...cur, routerId: c.args[0] }));
    },
  },

  // ---------------------------------------------------------- dhcp pool
  {
    modes: ['dhcp'],
    words: ['network'],
    syntax: '<network> <mask>',
    help: 'Addresses this pool hands out',
    run: (c) => {
      const net = ipMask(c, c.args[0], c.args[1]);
      if (net) savePool(c, { ...c.session.pool!, network: net.address, prefixLength: net.prefixLength });
    },
  },
  {
    modes: ['dhcp'],
    words: ['default-router'],
    syntax: '<address>',
    help: 'Gateway given to clients',
    run: (c) => {
      if (need(c, 1, 'default-router <address>')) savePool(c, { ...c.session.pool!, defaultRouter: c.args[0] });
    },
  },
  {
    modes: ['dhcp'],
    words: ['dns-server'],
    syntax: '<address>',
    help: 'DNS server given to clients',
    run: (c) => {
      if (need(c, 1, 'dns-server <address>')) savePool(c, { ...c.session.pool!, dnsServer: c.args[0] });
    },
  },

  // ------------------------------------------------------------ named ACL
  ...(['permit', 'deny'] as const).map(
    (action): Command => ({
      modes: ['nacl'],
      words: [action],
      syntax: 'a rule, e.g. tcp any host 10.0.0.5 eq 80',
      help: `Add a ${action} rule`,
      run: (c) => aclAppend(c, c.session.acl!.name, c.session.acl!.type, [action, ...c.args].join(' ')),
    }),
  ),

  // ----------------------------------------------------------------- show
  ...SHOW_COMMANDS,
  {
    modes: PRIV,
    words: ['show', 'running-config'],
    help: 'The current configuration',
    run: (c) => c.out.push(...runningConfig(c.env.topology(), c.device.id)),
  },
];

const PING_MARK: Record<string, string> = {
  success: '!',
  lost: '.',
  unreachable: 'U',
  prohibited: 'A',
  'ttl-exceeded': '&',
  refused: 'U',
  pending: '.',
};

// =============================================================== execute

function available(device: Device, mode: Mode, negate: boolean): Command[] {
  return COMMANDS.filter((cmd) => cmd.modes.includes(mode) && (cmd.kinds ?? ['router', 'switch']).includes(device.kind) && (!negate || cmd.negatable || cmd.words[0] === 'no'));
}

type Resolution = { cmd: Command; args: string[] } | { error: string; at: number };

/** Match tokens against keyword paths with IOS-style abbreviations; the longest full match wins. */
export function resolve(tokens: string[], commands: Command[]): Resolution {
  let candidates = commands;
  let best: { cmd: Command; used: number } | undefined;
  for (let i = 0; ; i++) {
    const complete = candidates.find((c) => c.words.length === i);
    if (complete) best = { cmd: complete, used: i };
    const longer = candidates.filter((c) => c.words.length > i);
    if (i >= tokens.length || !longer.length) break;
    const word = matchKeyword(tokens[i], [...new Set(longer.map((c) => c.words[i]))]);
    if (word === 'ambiguous') return { error: `Ambiguous command:  "${tokens.slice(0, i + 1).join(' ')}"`, at: i };
    if (word === null) {
      if (best) break;
      return { error: 'Invalid input detected at \'^\' marker.', at: i };
    }
    candidates = longer.filter((c) => c.words[i] === word);
  }
  if (!best) return { error: 'Incomplete command.', at: tokens.length };
  return { cmd: best.cmd, args: tokens.slice(best.used) };
}

/** '?' help: what can follow the typed words in this mode. */
function help(device: Device, mode: Mode, tokens: string[]): string[] {
  const cmds = available(device, mode, false);
  if (!tokens.length) {
    const firsts = [...new Map(cmds.map((c) => [c.words[0], c])).values()];
    return firsts.map((c) => `  ${c.words[0].padEnd(18)}${c.words.length > 1 ? `${c.words.slice(1).join(' ')} ...` : c.help}`).sort();
  }
  const matching = cmds.filter((c) => tokens.every((t, k) => k < c.words.length && c.words[k].startsWith(t.toLowerCase())));
  if (!matching.length) return ['% Unrecognized command'];
  return matching.map((c) => `  ${c.words.join(' ')}${c.syntax ? ` ${c.syntax}` : ''}`.padEnd(48) + c.help);
}

/** Run one line typed at the prompt. Pure apart from env.apply / env.probe. */
export function execute(session: CliSession, line: string, env: CliEnv): CliResult {
  const out: string[] = [];
  let s = { ...session };
  const t0 = env.topology();
  const device = t0.devices[s.deviceId];
  if (!device) return { session: s, output: ['% This device no longer exists'] };
  if (device.kind === 'hub' || isHostKind(device.kind)) return { session: s, output: ['% This device has no IOS command line. Use the Desktop tab.'] };

  let tokens = tokenize(line);
  if (!tokens.length) return { session: s, output: [] };

  // '?' help, at the end of a line or alone
  if (tokens[tokens.length - 1].endsWith('?')) {
    const last = tokens[tokens.length - 1].slice(0, -1);
    const words = last ? [...tokens.slice(0, -1), last] : tokens.slice(0, -1);
    return { session: s, output: help(device, s.mode, words) };
  }

  // 'do <exec command>' from any config mode
  let mode = s.mode;
  if (mode !== 'user' && mode !== 'exec' && matchKeyword(tokens[0], ['do']) === 'do') {
    tokens = tokens.slice(1);
    mode = 'exec';
  }
  let negate = false;
  if (mode !== 'user' && mode !== 'exec' && tokens[0].toLowerCase() === 'no' && tokens.length > 1) {
    // 'no auto-summary' is a command of its own in router rip mode
    const asWhole = resolve(tokens, available(device, mode, false));
    if (!('cmd' in asWhole) || asWhole.cmd.words[0] !== 'no') {
      negate = true;
      tokens = tokens.slice(1);
    }
  }

  const r = resolve(tokens, available(device, mode, negate));
  if ('error' in r) {
    if (r.error.startsWith('Invalid')) {
      const offset = line.indexOf(tokens[r.at] ?? '', tokens.slice(0, r.at).reduce((n, tk) => line.indexOf(tk, n) + tk.length, 0));
      out.push(' '.repeat(prompt(session, t0).length + Math.max(0, offset)) + '^');
    }
    out.push(`% ${r.error}`);
    return { session: s, output: out };
  }

  const ctx: RunContext = {
    session: s,
    env,
    device,
    args: r.args,
    negate,
    out,
    set(patch) {
      s = { ...s, ...patch };
      ctx.session = s;
    },
    apply(change) {
      try {
        env.apply(change);
        ctx.device = env.topology().devices[s.deviceId];
        return true;
      } catch (e) {
        out.push(`% ${(e as Error).message}`);
        return false;
      }
    },
  };
  r.cmd.run(ctx);
  return { session: s, output: out };
}

/** Command words available in a mode, for tab completion in the UI. */
export function completions(session: CliSession, t: Topology, partial: string): string[] {
  const device = t.devices[session.deviceId];
  if (!device) return [];
  const tokens = tokenize(partial);
  const endsWithSpace = /\s$/.test(partial);
  const typed = endsWithSpace ? tokens : tokens.slice(0, -1);
  const current = endsWithSpace ? '' : (tokens[tokens.length - 1] ?? '');
  const cmds = available(device, session.mode, false).filter((c) => typed.every((w, k) => k < c.words.length && c.words[k].startsWith(w.toLowerCase())));
  return [...new Set(cmds.map((c) => c.words[typed.length]).filter((w): w is string => !!w && w.startsWith(current.toLowerCase())))].sort();
}

export { COMMANDS };
