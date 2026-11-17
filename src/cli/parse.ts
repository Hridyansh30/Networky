// Small parsing helpers shared by the IOS CLI and the host command prompt.

import type { Interface, Topology } from '../model/types';

export const tokenize = (line: string): string[] => line.trim().split(/\s+/).filter(Boolean);

/**
 * IOS accepts any unique prefix of a keyword: 'conf t', 'sh ip int br'.
 * Returns the keyword `word` abbreviates, 'ambiguous', or null.
 */
export function matchKeyword(word: string, keywords: readonly string[]): string | 'ambiguous' | null {
  const w = word.toLowerCase();
  if (keywords.includes(w)) return w;
  const hits = keywords.filter((k) => k.startsWith(w));
  if (hits.length === 1) return hits[0];
  return hits.length > 1 ? 'ambiguous' : null;
}

const TYPE_NAMES: [RegExp, string][] = [
  [/^g(i(g(a(b(i(t(e(t(h(e(r(n(e(t)?)?)?)?)?)?)?)?)?)?)?)?)?)?$/i, 'GigabitEthernet'],
  [/^f(a(s(t(e(t(h(e(r(n(e(t)?)?)?)?)?)?)?)?)?)?)?$/i, 'FastEthernet'],
  [/^s(e(r(i(a(l)?)?)?)?)?$/i, 'Serial'],
  [/^p(o(r(t)?)?)?$/i, 'Port'],
];

/**
 * 'g0/0', 'Gi 0/0', 'gigabitethernet0/0.10', 'fa0/1', 'se0/0/0' -> the full IOS name.
 * Accepts the type and number as one token or two.
 */
export function expandInterfaceName(tokens: string[]): { name: string; used: number } | null {
  if (!tokens.length) return null;
  let m = tokens[0].match(/^([a-z]+)([\d/.]+)$/i);
  let used = 1;
  if (!m && tokens.length > 1 && /^[a-z]+$/i.test(tokens[0]) && /^[\d/.]+$/.test(tokens[1])) {
    m = [tokens[0] + tokens[1], tokens[0], tokens[1]] as unknown as RegExpMatchArray;
    used = 2;
  }
  if (!m) return null;
  const full = TYPE_NAMES.find(([re]) => re.test(m![1]))?.[1];
  return full ? { name: full + m[2], used } : null;
}

/** No device here has more ports than this; also stops 'fa0/1 - 999999' from building a huge list. */
const MAX_RANGE = 64;

/**
 * 'interface range' arguments -> full interface names, in order, without repeats.
 * 'fa0/1 - 4, g0/1' -> FastEthernet0/1..0/4 and GigabitEthernet0/1.
 * Each item is a type, the slot part and a first port, then optionally '- <last port>'.
 * Spaces around '-' and ',' are optional, as on real IOS. Returns null for bad syntax.
 */
export function expandInterfaceRange(args: string[]): string[] | null {
  const text = args.join(' ').trim();
  if (!text) return null;
  const names: string[] = [];
  for (const part of text.split(',')) {
    const m = part.trim().match(/^([a-z]+)\s*((?:\d+\/)*)(\d+)(?:\s*-\s*(\d+))?$/i);
    if (!m) return null;
    const first = Number(m[3]);
    const last = m[4] === undefined ? first : Number(m[4]);
    if (last < first || last - first >= MAX_RANGE) return null;
    for (let n = first; n <= last; n++) {
      const exp = expandInterfaceName([`${m[1]}${m[2]}${n}`]);
      if (!exp) return null;
      names.push(exp.name);
    }
  }
  const unique = [...new Set(names)];
  return unique.length <= MAX_RANGE ? unique : null;
}

export function findInterface(t: Topology, deviceId: string, name: string): Interface | undefined {
  return t.devices[deviceId].interfaceIds.map((id) => t.interfaces[id]).find((i) => i.name.toLowerCase() === name.toLowerCase());
}

/** Classful network of an address: RIP's 'network 10.1.2.0' means 10.0.0.0/8. */
export function classfulPrefix(address: string): number {
  const first = Number(address.split('.')[0]);
  return first < 128 ? 8 : first < 192 ? 16 : 24;
}

/** '10,20,30-32' -> [10,20,30,31,32] */
export function parseVlanList(s: string): number[] | null {
  const out: number[] = [];
  for (const part of s.split(',')) {
    const r = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!r) return null;
    const a = Number(r[1]);
    const b = r[2] ? Number(r[2]) : a;
    if (b < a || b - a > 4094) return null;
    for (let v = a; v <= b; v++) out.push(v);
  }
  return out;
}

/** Fixed-width text table, the way IOS prints show commands. */
export function table(headers: string[], rows: (string | number)[][]): string[] {
  const widths = headers.map((h, c) => Math.max(h.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells: (string | number)[]) => cells.map((v, c) => String(v ?? '').padEnd(widths[c])).join('  ').trimEnd();
  return [line(headers), ...rows.map(line)];
}
