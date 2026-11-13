import { describe, expect, it } from 'vitest';
import { setDefaultGateway } from '../model/ops';
import { Builder } from '../model/testing';
import { fill, instantiate } from './params';
import { privateLan24 } from './random';
import type { Params, ProblemSpec } from './spec';
import { verifyProblem } from './verify';
import { grade, solved } from '../grading/grade';

/** A randomized problem: one LAN whose /24 and host numbers change per seed. */
function lan(p: Params, opts: { pc1?: boolean; gateway?: boolean } = {}) {
  const b = new Builder();
  b.add('pc', 'PC0');
  b.add('pc', 'PC1');
  b.add('switch', 'S1');
  b.add('router', 'R1');
  b.link(['PC0', 'FastEthernet0'], ['S1', 'FastEthernet0/1']);
  b.link(['PC1', 'FastEthernet0'], ['S1', 'FastEthernet0/2']);
  b.link(['S1', 'GigabitEthernet0/1'], ['R1', 'GigabitEthernet0/0']);
  b.ip('R1', 'GigabitEthernet0/0', `${p.lan}.1/24`);
  b.ip('PC0', 'FastEthernet0', `${p.lan}.${p.pc0}/24`);
  b.t = setDefaultGateway(b.t, 'PC0', `${p.lan}.1`);
  if (opts.pc1) b.ip('PC1', 'FastEthernet0', `${p.lan}.${p.pc1}/24`);
  if (opts.pc1 && opts.gateway) b.t = setDefaultGateway(b.t, 'PC1', `${p.lan}.1`);
  return b.t;
}

export const randomLan: ProblemSpec = {
  slug: 'random-lan',
  version: 1,
  title: 'Join PC1 to the LAN',
  topic: 'IP Addressing',
  difficulty: 'hard',
  type: 'configure',
  statement: 'This office uses {{lan}}.0/24. Give PC1 the address {{lan}}.{{pc1}} and make it reach R1 at {{lan}}.1.',
  params: (r) => {
    const [pc0, pc1] = r.distinct(2, 10, 200);
    return { lan: privateLan24(r), pc0, pc1 };
  },
  requirements: [{ id: 'join', text: 'PC1 is on {{lan}}.0/24 and reaches its gateway', hints: ['Hosts need an address in their LAN.', 'Look at R1 for the LAN.', 'Set {{lan}}.{{pc1}}/24 and gateway {{lan}}.1.'] }],
  tests: [
    { id: 'gw', requirement: 'join', points: 2, visibility: 'shown', check: { kind: 'reach', params: { from: 'PC1', to: '{{lan}}.1' } } },
    { id: 'pc0', requirement: 'join', points: 1, check: { kind: 'reach', params: { from: 'PC1', to: '{{lan}}.{{pc0}}' } } },
    { id: 'addr', requirement: 'join', points: 1, check: { kind: 'interfaceIp', params: { device: 'PC1', port: 'FastEthernet0', address: '{{lan}}.{{pc1}}/24' } } },
  ],
  start: (p) => lan(p),
  reference: (p) => lan(p, { pc1: true, gateway: true }),
  wrong: [(p) => lan({ ...p, pc1: Number(p.pc0) }, { pc1: true, gateway: true })], // duplicate of PC0's address
};

describe('fill', () => {
  it('replaces known placeholders and nothing else', () => {
    expect(fill('{{lan}}.{{ pc1 }} via {{lan}}.1', { lan: '10.1.2', pc1: 7 })).toBe('10.1.2.7 via 10.1.2.1');
    expect(fill('no placeholders ${x} %{y}', {})).toBe('no placeholders ${x} %{y}');
  });
  it('throws on an unknown key, so author typos fail in CI', () => {
    expect(() => fill('{{lna}}', { lan: '10.0.0' })).toThrow(/unknown placeholder \{\{lna\}\}/);
  });
  it('never evaluates anything', () => {
    expect(fill('{{constructor}}', { constructor: 'x' } as never)).toBe('x');
    expect(() => fill('{{toString}}', {})).toThrow(); // inherited names are not params
  });
});

describe('instantiate', () => {
  it('fills statement, hints and test params for one seed, keeping numbers as numbers', () => {
    const v = instantiate(randomLan, 1234);
    expect(v.seed).toBe(1234);
    expect(v.statement).not.toMatch(/\{\{/);
    expect(v.requirements[0].hints[2]).toMatch(new RegExp(`^Set ${String(v.values.lan).replace(/\./g, '\\.')}\\.`));
    expect(v.tests[0].check.params).toEqual({ from: 'PC1', to: `${v.values.lan}.1` });
  });
  it('is the same variant for the same seed and usually a different one for another', () => {
    expect(instantiate(randomLan, 5).values).toEqual(instantiate(randomLan, 5).values);
    const variants = new Set(Array.from({ length: 50 }, (_, s) => JSON.stringify(instantiate(randomLan, s).values)));
    expect(variants.size).toBeGreaterThan(45);
  });
  it('needs a seed for a randomized problem', () => {
    expect(() => instantiate(randomLan)).toThrow(/needs a seed/);
  });
  it("a copied answer from another variant fails", () => {
    const mine = instantiate(randomLan, 1);
    const theirs = instantiate(randomLan, 2);
    expect(solved(grade(theirs.reference(theirs.values), mine))).toBe(false);
  });
});

describe('verifyProblem', () => {
  it('passes the randomized problem on 60 seeds', () => {
    expect(verifyProblem(randomLan, Array.from({ length: 60 }, (_, i) => i * 7919))).toEqual([]);
  });
  it('catches a broken reference and a wrong solution that slips through', () => {
    const broken: ProblemSpec = { ...randomLan, reference: (p) => lan(p), wrong: [(p) => lan(p, { pc1: true, gateway: true })] };
    const problems = verifyProblem(broken, [1]);
    expect(problems.some((m) => /reference scores/.test(m))).toBe(true);
    expect(problems.some((m) => /wrong solution #1 passes every test/.test(m))).toBe(true);
  });
});
