import { describe, expect, it } from 'vitest';
import { addressPc1 } from '../grading/__tests__/fixtures';
import { registry } from '../grading/checks';
import { validateSpec, visibilityOf, type ProblemSpec } from './spec';

const checks = registry();

describe('validateSpec', () => {
  it('accepts a good problem', () => {
    expect(validateSpec(addressPc1, checks)).toEqual([]);
  });
  it('finds the mistakes an author makes', () => {
    const bad: ProblemSpec = {
      ...addressPc1,
      slug: 'Bad Slug',
    };
    expect(validateSpec(bad, checks)[0]).toMatch(/^slug:/);
    const broken: ProblemSpec = {
      ...addressPc1,
      tests: [
        { id: 'a', requirement: 'missing', points: 1, check: { kind: 'reach', params: { from: 'PC1', to: '192.168.1.1' } } },
        { id: 'a', requirement: 'address', points: 1, check: { kind: 'nope', params: {} } },
        { id: 'b', requirement: 'address', points: 1, check: { kind: 'reach', params: { from: 'PC1', to: 'not-an-ip' } } },
      ],
    };
    const errors = validateSpec(broken, checks);
    expect(errors).toContain('test ids repeat');
    expect(errors).toContain("test a: unknown requirement 'missing'");
    expect(errors).toContain("test a: unknown check kind 'nope'");
    expect(errors.some((e) => e.startsWith('test b: to'))).toBe(true);
    expect(errors).toContain('requirement reach has no test');
  });
  it('requires at least one shown test', () => {
    const hidden: ProblemSpec = { ...addressPc1, difficulty: 'hard' };
    expect(validateSpec(hidden, checks)).toContain('no test is shown: the Run button would have nothing to run');
  });
});

describe('tests fade with difficulty', () => {
  const [config, behaviour] = [addressPc1.tests[0], addressPc1.tests[1]];
  it('easy shows everything', () => {
    expect([visibilityOf(config, 'easy', checks), visibilityOf(behaviour, 'easy', checks)]).toEqual(['shown', 'shown']);
  });
  it('medium shows behaviour and hides exact settings', () => {
    expect([visibilityOf(config, 'medium', checks), visibilityOf(behaviour, 'medium', checks)]).toEqual(['hidden', 'shown']);
  });
  it('hard hides everything unless the author shows a test', () => {
    expect(visibilityOf(behaviour, 'hard', checks)).toBe('hidden');
    expect(visibilityOf({ ...behaviour, visibility: 'shown' }, 'hard', checks)).toBe('shown');
  });
});
