// A predict question never stores its answer: the answer is what the engine
// does. The explanations, though, were written for one particular outcome.
// This table pins those outcomes, so if an engine change ever makes a
// network behave differently, this test fails and the explanation gets
// re-read instead of silently lying to learners.
import { describe, expect, it } from 'vitest';
import { actualOutcome } from '../predict';
import { PREDICTS } from './predicts';

const WRITTEN_FOR: Record<string, Record<string, string>> = {
  'predict-local-or-remote': { 'pc1-server': 'success', 'pc2-pc1': 'success', 'pc2-server': 'unreachable', 'server-pc2': 'lost' },
  'predict-vlan-walls': { 'same-vlan-far': 'success', 'other-vlan-near': 'unreachable', 'hr-far': 'success' },
  'predict-ping-vs-port': { ping: 'success', web: 'success', ftp: 'refused' },
  'predict-the-way-back': { 'pc1-pc3': 'lost', 'pc3-pc1': 'unreachable', 'pc1-r2': 'lost', 'pc1-nowhere': 'lost' },
  'predict-acl-first-match': { 'pc1-web': 'success', 'pc2-web': 'prohibited', 'pc1-ssh': 'prohibited', 'pc2-ping': 'success', 'outside-in': 'unreachable' },
  'predict-longest-match': { 'low-host': 'success', 'high-half': 'ttl-exceeded', 'low-empty': 'unreachable', 'no-route': 'unreachable' },
};

describe('predict problems', () => {
  it('every predict problem is pinned here', () => {
    expect(PREDICTS.map((p) => p.slug).sort()).toEqual(Object.keys(WRITTEN_FOR).sort());
  });

  it.each(PREDICTS.map((p) => [p.slug, p] as const))('%s behaves the way its explanations say', (slug, p) => {
    const start = p.start({});
    expect(Object.fromEntries(p.questions!.map((q) => [q.id, actualOutcome(start, q)]))).toEqual(WRITTEN_FOR[slug]);
  });

  it.each(PREDICTS.map((p) => [p.slug, p] as const))('%s is not answered by picking the same choice every time', (_, p) => {
    const start = p.start({});
    expect(new Set(p.questions!.map((q) => actualOutcome(start, q))).size).toBeGreaterThan(1);
  });
});
