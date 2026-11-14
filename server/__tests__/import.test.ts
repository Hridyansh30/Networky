import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/model/serialize';
import { PROBLEMS, problemBySlug } from '../../src/problems/catalog';
import { instantiate } from '../../src/problems/params';
import { actualOutcome } from '../../src/problems/predict';
import { harness } from './harness';

const network = (slug: string, pick: 'start' | 'reference', seed?: number) => {
  const v = instantiate(problemBySlug(slug)!, seed);
  return serialize({ topology: pick === 'start' ? v.start(v.values) : v.reference(v.values), layout: {} });
};

describe('importing phase 5 progress', () => {
  it('re-grades the saved network: a real solve counts, a claim does not', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const good = await b.json('/api/v1/import/first-ping', { json: { row: { specVersion: problemBySlug('first-ping')!.version, attempt: network('first-ping', 'reference'), hints: {}, solved: true, best: 1 } } });
    expect(good.body.result).toBe('solved');
    expect(good.body.progress).toMatchObject({ solved: true, xp: 10 });
    // "solved: true, best: 1" with a network that does not pass: stays a draft.
    const lie = await b.json('/api/v1/import/wrong-subnet', { json: { row: { specVersion: problemBySlug('wrong-subnet')!.version, attempt: network('wrong-subnet', 'start'), hints: {}, solved: true, best: 1 } } });
    expect(lie.body.result).toBe('draft');
    expect(lie.body.progress).toMatchObject({ solved: false, xp: 0, failedSubmits: 0 });
    // The draft is there to carry on with.
    expect((await b.json('/api/v1/problems/wrong-subnet/attempt')).body.attempt.network).toContain('"format": "networky"');
  });

  it('applies reported hints and an early solution look (they only cost)', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const v = problemBySlug('first-ping')!.version;
    const hinted = await b.json('/api/v1/import/first-ping', { json: { row: { specVersion: v, attempt: network('first-ping', 'reference'), hints: { address: 2 } } } });
    expect(hinted.body.progress.xp).toBeLessThan(10);
    const peeked = await b.json('/api/v1/import/missing-gateway', { json: { row: { specVersion: problemBySlug('missing-gateway')!.version, attempt: network('missing-gateway', 'reference'), solutionFirst: true } } });
    expect(peeked.body.progress).toMatchObject({ solved: true, xp: 0 });
  });

  it('grades a randomized problem on the variant it was saved with', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const r = await b.json('/api/v1/import/join-the-lan', { json: { row: { specVersion: problemBySlug('join-the-lan')!.version, seed: 777, attempt: network('join-the-lan', 'reference', 777) } } });
    expect(r.body.result).toBe('solved');
  });

  it('re-checks predict answers against the engine', async () => {
    const spec = PROBLEMS.find((p) => p.type === 'predict')!;
    const v = instantiate(spec);
    const right = Object.fromEntries(v.questions!.map((q) => [q.id, String(actualOutcome(v.start(v.values), q))]));
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const ok = await b.json(`/api/v1/import/${spec.slug}`, { json: { row: { specVersion: spec.version, answers: right, firstTry: 0.5 } } });
    expect(ok.body.result).toBe('solved');
    expect(ok.body.progress.firstTry).toBe(0.5);
    const h2 = harness();
    const b2 = h2.browser();
    await b2.signIn('kavya');
    const q0 = v.questions![0];
    const wrong = { ...right, [q0.id]: q0.choices.find((c) => c !== right[q0.id])! };
    expect((await b2.json(`/api/v1/import/${spec.slug}`, { json: { row: { specVersion: spec.version, answers: wrong, firstTry: 1 } } })).body.result).toBe('draft');
  });

  it('happens once per problem and once per account', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const row = { specVersion: problemBySlug('first-ping')!.version, attempt: network('first-ping', 'reference') };
    expect((await b.json('/api/v1/import/first-ping', { json: { row } })).status).toBe(200);
    expect((await b.json('/api/v1/import/first-ping', { json: { row } })).status).toBe(409);
    expect((await b.json('/api/v1/import/done', { json: {} })).status).toBe(200);
    expect((await b.json('/api/v1/import/missing-gateway', { json: { row: { ...row, specVersion: problemBySlug('missing-gateway')!.version } } })).status).toBe(409);
    expect((await b.json('/api/v1/me')).body.importedAt).toEqual(expect.any(Number));
  });

  it('skips progress saved against an older version of the problem', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const r = await b.json('/api/v1/import/first-ping', { json: { row: { specVersion: 999, attempt: network('first-ping', 'reference') } } });
    expect(r.body.result).toBe('skipped');
  });
});

describe('leaderboard and stats', () => {
  it('ranks by XP, breaks ties by who got there first, and shows the week', async () => {
    const h = harness();
    const solve = async (handle: string, slugs: string[]) => {
      const b = h.browser();
      await b.signIn(handle);
      for (const slug of slugs) {
        h.clock.now += 10_000;
        const a = (await b.json(`/api/v1/problems/${slug}/attempts`, { method: 'POST', json: {} })).body.attempt;
        await b.json(`/api/v1/attempts/${a.id}/submissions`, { json: { submissionId: crypto.randomUUID(), network: network(slug, 'reference', a.seed ?? undefined) } });
      }
      return b;
    };
    await solve('first', ['first-ping']);
    await solve('second', ['first-ping']);
    const third = await solve('third', ['first-ping', 'missing-gateway']);
    const board = await third.json('/api/v1/leaderboard');
    expect(board.body.rows.map((r: { handle: string }) => r.handle)).toEqual(['third', 'first', 'second']);
    expect(board.res.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect((await third.json('/api/v1/me')).body.rank).toBe(1);
    // Next week: the weekly board starts empty, the all-time one does not.
    h.clock.now += 8 * 86_400_000;
    expect((await third.json('/api/v1/leaderboard?period=week')).body.rows).toEqual([]);
    expect((await third.json('/api/v1/leaderboard?period=all')).body.rows).toHaveLength(3);
    expect((await third.json('/api/v1/leaderboard?period=year')).status).toBe(400);
  });

  it('shows acceptance only after enough people tried', async () => {
    const h = harness();
    for (let i = 0; i < 20; i++) {
      const b = h.browser();
      await b.signIn(`u${i}`);
      const a = (await b.json('/api/v1/problems/first-ping/attempts', { method: 'POST', json: {} })).body.attempt;
      await b.json(`/api/v1/attempts/${a.id}/submissions`, { json: { submissionId: crypto.randomUUID(), network: network('first-ping', i % 4 === 0 ? 'start' : 'reference') } });
      if (i === 18) expect((await b.json('/api/v1/problems/stats')).body.problems['first-ping'].acceptance).toBeNull();
    }
    const stats = (await h.browser().json('/api/v1/problems/stats')).body;
    expect(stats.problems['first-ping']).toEqual({ tried: 20, solvers: 15, acceptance: 0.75 });
    expect(stats.solves).toBe(15);
  });
});
