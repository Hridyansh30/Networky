// Access control list logic, shared by the engine (to filter packets) and
// the UI (to parse and print rules the way IOS does).
//
// A wildcard mask is an INVERTED subnet mask: 0 bits must match, 1 bits are
// "don't care". 0.0.0.255 matches any last octet. 'any' = 255.255.255.255,
// 'host 10.0.0.5' = 10.0.0.5 0.0.0.0.

import { isValidIPv4, parseIPv4 } from './ip';
import type { Acl, AclProtocol, AclRule } from './types';

export const ANY_WILDCARD = '255.255.255.255';
export const HOST_WILDCARD = '0.0.0.0';

export function wildcardMatch(ip: string, address: string, wildcard: string): boolean {
  const a = parseIPv4(ip);
  const b = parseIPv4(address);
  const w = parseIPv4(wildcard);
  if (a === null || b === null || w === null) return false;
  return ((a ^ b) & ~w) >>> 0 === 0;
}

export interface AclPacket {
  protocol: string; // 'icmp', 'tcp', 'udp', 'ospf'...
  src: string;
  dst: string;
  dstPort?: number;
}

export function ruleMatches(rule: AclRule, type: Acl['type'], p: AclPacket): boolean {
  if (!wildcardMatch(p.src, rule.src, rule.srcWildcard)) return false;
  if (type === 'standard') return true;
  if (rule.protocol !== 'ip' && rule.protocol !== p.protocol) return false;
  if (!wildcardMatch(p.dst, rule.dst ?? '0.0.0.0', rule.dstWildcard ?? ANY_WILDCARD)) return false;
  if (rule.dstPort !== undefined && rule.dstPort !== p.dstPort) return false;
  return true;
}

/**
 * First match wins. If no rule matches, the IMPLICIT DENY at the end of every
 * ACL drops the packet. That invisible last line is the #1 ACL mistake.
 * Returns the index of the matching rule, or -1 for the implicit deny.
 */
export function evaluateAcl(acl: Acl, p: AclPacket): { permit: boolean; index: number } {
  const index = acl.rules.findIndex((r) => ruleMatches(r, acl.type, p));
  if (index < 0) return { permit: false, index: -1 };
  return { permit: acl.rules[index].action === 'permit', index };
}

function formatAddr(addr: string, wildcard: string): string {
  if (wildcard === ANY_WILDCARD) return 'any';
  if (wildcard === HOST_WILDCARD) return `host ${addr}`;
  return `${addr} ${wildcard}`;
}

/** IOS-style text: 'deny tcp 10.0.0.0 0.0.0.255 host 10.1.0.5 eq 80'. */
export function formatRule(rule: AclRule, type: Acl['type']): string {
  if (type === 'standard') return `${rule.action} ${formatAddr(rule.src, rule.srcWildcard)}`;
  const port = rule.dstPort !== undefined ? ` eq ${rule.dstPort}` : '';
  return `${rule.action} ${rule.protocol} ${formatAddr(rule.src, rule.srcWildcard)} ${formatAddr(rule.dst ?? '0.0.0.0', rule.dstWildcard ?? ANY_WILDCARD)}${port}`;
}

const PROTOCOLS: AclProtocol[] = ['ip', 'icmp', 'tcp', 'udp'];
const NAMED_PORTS: Record<string, number> = { www: 80, http: 80, https: 443, ftp: 21, ssh: 22, telnet: 23, smtp: 25, domain: 53 };

/** Parses one rule as typed in IOS. Throws with a helpful message. */
export function parseRule(text: string, type: Acl['type']): AclRule {
  const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let i = 0;
  const next = (what: string) => {
    if (i >= tokens.length) throw new Error(`Expected ${what}`);
    return tokens[i++];
  };
  const action = next("'permit' or 'deny'");
  if (action !== 'permit' && action !== 'deny') throw new Error(`Rules start with 'permit' or 'deny', not '${action}'`);

  let protocol: AclProtocol = 'ip';
  if (type === 'extended') {
    const p = next('a protocol (ip, icmp, tcp, udp)') as AclProtocol;
    if (!PROTOCOLS.includes(p)) throw new Error(`Unknown protocol '${p}'. Use ip, icmp, tcp or udp`);
    protocol = p;
  }

  const address = (what: string): [string, string] => {
    const t = next(what);
    if (t === 'any') return ['0.0.0.0', ANY_WILDCARD];
    if (t === 'host') {
      const h = next('a host address');
      if (!isValidIPv4(h)) throw new Error(`'${h}' is not an IPv4 address`);
      return [h, HOST_WILDCARD];
    }
    if (!isValidIPv4(t)) throw new Error(`'${t}' is not an IPv4 address`);
    // A standard ACL may omit the wildcard: it means 'host'.
    if (i >= tokens.length || !isValidIPv4(tokens[i])) {
      if (type === 'standard') return [t, HOST_WILDCARD];
      throw new Error(`'${t}' needs a wildcard mask, e.g. ${t} 0.0.0.255`);
    }
    const w = next('a wildcard mask');
    const n = parseIPv4(w)!;
    if (((n + 1) & n) !== 0) throw new Error(`'${w}' is not a wildcard mask (it must look like 0.0.0.255, not 255.255.255.0)`);
    return [t, w];
  };

  const [src, srcWildcard] = address('a source (any, host X, or address + wildcard)');
  const rule: AclRule = { action, protocol, src, srcWildcard };
  if (type === 'extended') {
    const [dst, dstWildcard] = address('a destination');
    rule.dst = dst;
    rule.dstWildcard = dstWildcard;
    if (i < tokens.length) {
      if (next("'eq'") !== 'eq') throw new Error("Only 'eq <port>' is supported after the destination");
      if (protocol !== 'tcp' && protocol !== 'udp') throw new Error('Only tcp and udp rules can match a port');
      const raw = next('a port');
      const port = NAMED_PORTS[raw] ?? Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`'${raw}' is not a port`);
      rule.dstPort = port;
    }
  }
  if (i < tokens.length) throw new Error(`Unexpected '${tokens.slice(i).join(' ')}'`);
  return rule;
}
