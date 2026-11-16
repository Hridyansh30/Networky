// Every drill kind, every level, many seeds. Each answer key is checked
// against an independent oracle: a different method from the one the
// generator uses (the way a person would do it by hand), so a bug in one
// is caught by the other.

import { describe, expect, it } from 'vitest';
import { checkAnswer, DRILL_KINDS, drillKind, LEVELS, nextLevel, questionAt, SET_SIZE, type DrillQuestion, type Level } from '.';
import { parseIPv4Strict, parseMask, parsePrefix } from './answers';
import { DIFFERENT, SAME } from './kinds/sameSubnet';

const SEEDS = 1500;
const seeds = Array.from({ length: SEEDS }, (_, i) => (i * 2654435761) >>> 0);

function* all(kindId: string): Generator<{ q: DrillQuestion; level: Level; seed: number }> {
  const kind = drillKind(kindId)!;
  // A simulation per question is about 1 ms: fewer seeds for those kinds (willItReach.test.ts checks them in depth).
  for (const level of LEVELS) for (const seed of kind.runsEngine ? seeds.slice(0, 150) : seeds) yield { q: questionAt(kind, seed, seed % SET_SIZE, level), level, seed };
}

// ---------------------------------------------------------------- oracles

const octets = (s: string) => s.split('.').map(Number);
const bits = (s: string) => octets(s).map((o) => o.toString(2).padStart(8, '0')).join('');
const fromBits = (b: string) => [0, 8, 16, 24].map((i) => parseInt(b.slice(i, i + 8), 2)).join('.');

/** Subnetting by string bits: keep the prefix, fill the rest with 0s or 1s. */
function oracleRange(addr: string, prefix: number) {
  const b = bits(addr).slice(0, prefix);
  const net = fromBits(b.padEnd(32, '0'));
  const bc = fromBits(b.padEnd(32, '1'));
  const step = (s: string, d: number) => fromBits((parseInt(bits(s), 2) + d).toString(2).padStart(32, '0'));
  return { network: net, first: step(net, 1), last: step(bc, -1), broadcast: bc };
}

/** RFC 5952 by hand: strip zeros, then find the longest run of "0" groups. */
function oracleShorten(full: string): string {
  const g = full.split(':').map((x) => x.replace(/^0+(?=.)/, ''));
  let best = [-1, 0];
  for (let i = 0; i < 8; i++) {
    let j = i;
    while (j < 8 && g[j] === '0') j++;
    if (j - i >= 2 && j - i > best[1]) best = [i, j - i];
    if (j > i) i = j - 1;
  }
  if (best[0] < 0) return g.join(':');
  return `${g.slice(0, best[0]).join(':')}::${g.slice(best[0] + best[1]).join(':')}`;
}

function oracleExpand(short: string): string {
  const [l, r] = short.split('::');
  const left = l ? l.split(':') : [];
  const right = r ? r.split(':') : [];
  const mid = Array(8 - left.length - right.length).fill('0');
  return [...left, ...mid, ...right].map((x) => x.padStart(4, '0')).join(':');
}

// ---------------------------------------------------------------- every kind

describe.each(DRILL_KINDS.map((k) => [k.id, k] as const))('%s', (id, kind) => {
  it('is deterministic: the same seed and level give the same question', () => {
    for (const level of LEVELS) expect(questionAt(kind, 42, 3, level)).toEqual(questionAt(kind, 42, 3, level));
  });

  it('always has one right answer, which its own checker accepts', () => {
    for (const { q } of all(id)) {
      expect(q.prompt.length).toBeGreaterThan(10);
      expect(q.explanation.length).toBeGreaterThan(0);
      if (q.type === 'choice') {
        expect(new Set(q.choices).size).toBe(q.choices.length);
        expect(q.choices.length).toBeGreaterThanOrEqual(2);
        expect(q.choices).toContain(q.expected.choice);
        for (const c of q.choices) expect(checkAnswer(q, { choice: c }).correct).toBe(c === q.expected.choice);
      } else {
        expect(checkAnswer(q, q.expected).correct).toBe(true);
        expect(checkAnswer(q, {}).correct).toBe(false);
      }
    }
  });

  it('has a title, a topic and a line for each level', () => {
    expect(kind.title && kind.topic && kind.summary).toBeTruthy();
    for (const level of LEVELS) expect(kind.levels[level]).toBeTruthy();
  });
});

describe('answer keys against independent oracles', () => {
  it('subnet range', () => {
    for (const { q } of all('subnet-range')) {
      const [, addr, prefix] = /(\d+\.\d+\.\d+\.\d+)\/(\d+)/.exec(q.prompt)!;
      expect(q.expected).toEqual(oracleRange(addr, Number(prefix)));
    }
  });

  it('masks and prefixes', () => {
    for (const { q } of all('mask-cidr')) {
      if (q.type !== 'fields') throw new Error('fields expected');
      const f = q.fields[0].id;
      if (f === 'mask') expect(q.expected.mask).toBe(fromBits('1'.repeat(Number(/\/(\d+)/.exec(q.prompt)![1])).padEnd(32, '0')));
      if (f === 'prefix') expect(q.expected.prefix).toBe(`/${bits(/mask (\S+)\?/.exec(q.prompt)![1]).replace(/0+$/, '').length}`);
      if (f === 'hosts') {
        const p = Number(/\/(\d+)/.exec(q.prompt)![1]);
        expect(Number(q.expected.hosts)).toBe(p === 31 ? 2 : p === 32 ? 1 : 2 ** (32 - p) - 2);
      }
    }
  });

  it('same subnet: by dividing addresses by the block size, not by masking', () => {
    let yes = 0;
    for (const { q } of all('same-subnet')) {
      const [, a, p, b] = /is (\S+)\/(\d+)\. It wants to reach (\S+)\./.exec(q.prompt)!;
      const size = 2 ** (32 - Number(p));
      const n = (s: string) => octets(s).reduce((x, o) => x * 256 + o, 0);
      const same = Math.floor(n(a) / size) === Math.floor(n(b) / size);
      expect(q.expected.choice).toBe(same ? SAME : DIFFERENT);
      // The other address is a usable host, never the network or broadcast address.
      expect([0, size - 1]).not.toContain(n(b) % size);
      if (same) yes++;
    }
    expect(yes).toBeGreaterThan(SEEDS); // about half of 3 x SEEDS
    expect(yes).toBeLessThan(2 * SEEDS);
  });

  it('longest prefix match: by comparing bit strings', () => {
    let nearMisses = 0;
    let defaultWins = 0;
    for (const { q, level } of all('longest-match')) {
      if (q.type !== 'choice') throw new Error('choice expected');
      const dest = bits(/packet for (\S+)\./.exec(q.prompt)![1]);
      const matches = q.choices
        .map((c) => /^(\S+)\/(\d+)/.exec(c)!)
        .filter(([, net, p]) => bits(net).slice(0, Number(p)) === dest.slice(0, Number(p)))
        .sort((x, y) => Number(y[2]) - Number(x[2]));
      expect(q.expected.choice.startsWith(matches[0][0])).toBe(true);
      if (matches.length < q.choices.length) nearMisses++;
      if (matches[0][2] === '0') defaultWins++;
      if (level === 3) expect(q.choices.some((c) => c.startsWith('0.0.0.0/0'))).toBe(true);
    }
    expect(nearMisses).toBeGreaterThan(SEEDS);
    expect(defaultWins).toBeGreaterThan(SEEDS / 10);
  });

  it('MAC learning: replayed from the prompt text; forward, flood and filter all come up', () => {
    const seen = { forward: 0, flood: 0, filter: 0 };
    for (const { q, level } of all('mac-table')) {
      if (q.type !== 'choice') throw new Error('choice expected');
      const port = new Map<string, string>();
      for (const [, h, p] of q.prompt.matchAll(/(PC-[A-E]) on (Fa0\/\d)/g)) port.set(h, p);
      const hub = /PC-E on the same hub as (PC-[A-D]) \((Fa0\/\d)\)/.exec(q.prompt);
      if (hub) port.set('PC-E', hub[2]);
      const learned = new Map<string, string>();
      for (const [, src] of q.prompt.matchAll(/\d\) (PC-[A-E]) to /g)) learned.set(src, port.get(src)!);
      const [, sender, target] = /Then (PC-[A-E]) sends a frame to (PC-[A-E])/.exec(q.prompt)!;
      const inPort = port.get(sender)!;
      const known = learned.get(target);
      const want = known === undefined ? 'Flood' : known === inPort ? 'Filter' : `Forward out ${known} only`;
      expect(q.expected.choice.startsWith(want)).toBe(true);
      expect(q.choices).not.toContain(`Forward out ${inPort} only`);
      if (want === 'Flood') seen.flood++;
      else if (want === 'Filter') {
        seen.filter++;
        expect(level).toBe(3);
      } else seen.forward++;
    }
    expect(Math.min(seen.forward, seen.flood, seen.filter)).toBeGreaterThan(100);
  });

  it('IPv6 shortening and expanding', () => {
    for (const { q, level } of all('ipv6-shorten')) {
      const shown = /(?:Write )(\S+)/.exec(q.prompt)![1];
      const e = q.expected as Record<string, string>;
      if (level === 3) expect(e.full).toBe(oracleExpand(shown));
      else expect(e.short).toBe(oracleShorten(shown));
    }
  });
});

// ---------------------------------------------------------------- answers

describe('reading answers', () => {
  it('refuses leading zeros in IPv4, because many tools read them as octal', () => {
    expect(parseIPv4Strict('10.010.0.1')).toMatchObject({ ok: false });
    expect(parseIPv4Strict(' 10.10.0.1 ')).toEqual({ ok: true, value: '10.10.0.1' });
    expect(parseIPv4Strict('10.0.0')).toMatchObject({ ok: false });
    expect(parseIPv4Strict('10.0.0.256')).toMatchObject({ ok: false });
  });

  it('accepts /21 or 21 for a prefix, and only contiguous masks', () => {
    expect(parsePrefix('21')).toEqual({ ok: true, value: '/21' });
    expect(parsePrefix('/21')).toEqual({ ok: true, value: '/21' });
    expect(parsePrefix('/33')).toMatchObject({ ok: false });
    expect(parseMask('255.255.248.0')).toMatchObject({ ok: true });
    expect(parseMask('255.0.255.0')).toMatchObject({ ok: false });
  });

  it('says so when an IPv6 answer is the right address in the wrong form', () => {
    const q = questionAt(drillKind('ipv6-shorten')!, 7, 0, 1);
    if (q.type !== 'fields') throw new Error('fields expected');
    const longer = oracleExpand(q.expected.short);
    const r = checkAnswer(q, { short: longer });
    expect(r.correct).toBe(false);
    expect(r.fields.short.problem).toMatch(/Same address/);
  });

  it('says why an answer could not be read', () => {
    const q = questionAt(drillKind('subnet-range')!, 1, 0, 1);
    const r = checkAnswer(q, { network: '192.168.001.0' });
    expect(r.fields.network.problem).toMatch(/leading zeros/);
  });
});

describe('the level rule', () => {
  it('goes up after three right in a row and down after two wrong', () => {
    expect(nextLevel(1, [true, true])).toBe(1);
    expect(nextLevel(1, [false, true, true, true])).toBe(2);
    expect(nextLevel(3, [true, true, true])).toBe(3);
    expect(nextLevel(2, [true, false])).toBe(2);
    expect(nextLevel(2, [true, false, false])).toBe(1);
    expect(nextLevel(1, [false, false])).toBe(1);
  });
});

it('a set has a fixed size and refuses questions outside it', () => {
  expect(() => questionAt(DRILL_KINDS[0], 1, SET_SIZE, 1)).toThrow();
  expect(() => questionAt(DRILL_KINDS[0], 1, -1, 1)).toThrow();
});
