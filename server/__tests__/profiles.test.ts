import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/model/serialize';
import { problemBySlug } from '../../src/problems/catalog';
import { instantiate } from '../../src/problems/params';
import { harness, type Browser } from './harness';

const net = (slug: string) => {
  const v = instantiate(problemBySlug(slug)!);
  return serialize({ topology: v.reference(v.values), layout: {} });
};

async function solve(b: Browser, slug: string, opts: { hint?: boolean; failFirst?: boolean } = {}) {
  const a = (await b.json(`/api/v1/problems/${slug}/attempts`, { json: {} })).body.attempt;
  if (opts.hint) await b.json(`/api/v1/attempts/${a.id}/hints`, { json: { requirement: problemBySlug(slug)!.requirements[0].id } });
  if (opts.failFirst) {
    const start = serialize({ topology: instantiate(problemBySlug(slug)!).start({}), layout: {} });
    await b.json(`/api/v1/attempts/${a.id}/submissions`, { json: { submissionId: crypto.randomUUID(), network: start } });
  }
  const r = await b.json(`/api/v1/attempts/${a.id}/submissions`, { json: { submissionId: crypto.randomUUID(), network: net(slug) } });
  expect(r.body.report.score).toBe(r.body.report.max);
}

/** Every key that only the owner may see. None may appear in a public answer. */
const PRIVATE_KEYS = ['submits', 'failedSubmits', 'acceptance', 'hintsUsed', 'solutionsOpened', 'unsolved', 'xpByDay', 'practice', 'visibility', 'private', 'id', 'user_id', 'banned_at', 'network'];
const keysDeep = (v: unknown): string[] => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : []);

describe('profiles', () => {
  it('the public profile shows judged solves and day-level activity, and nothing private', async () => {
    const h = harness();
    const ada = h.browser();
    await ada.signIn('ada');
    await solve(ada, 'first-ping', { hint: true, failFirst: true });
    const r = await h.browser().json('/api/v1/users/ada');
    expect(r.status).toBe(200);
    expect(r.res.headers.get('Cache-Control')).toBe('public, max-age=60');
    const p = r.body.profile;
    expect(p).toMatchObject({ handle: 'ada', solvedCount: 1, rank: 1, memberSince: '2026-11-16' });
    expect(p.solved).toEqual([{ slug: 'first-ping', title: problemBySlug('first-ping')!.title, difficulty: 'easy', topic: problemBySlug('first-ping')!.topic, day: '2026-11-16' }]);
    expect(p.activity).toEqual([{ day: '2026-11-16', n: 2 }]);
    expect(p.byDifficulty.find((d: { difficulty: string }) => d.difficulty === 'easy').solved).toBe(1);
    // Nothing owner-only, and no time finer than a day.
    expect(keysDeep(r.body).filter((k) => PRIVATE_KEYS.includes(k))).toEqual([]);
    expect(JSON.stringify(r.body)).not.toMatch(/T\d\d:\d\d/);
  });

  it('the public endpoint never reads the session: the owner gets the same public answer', async () => {
    const h = harness();
    const ada = h.browser();
    await ada.signIn('ada');
    await solve(ada, 'first-ping');
    const mine = await ada.json('/api/v1/users/ada');
    const theirs = await h.browser().json('/api/v1/users/ada');
    expect(mine.body).toEqual(theirs.body);
  });

  it('the owner view adds the private half and is never cached', async () => {
    const h = harness();
    const ada = h.browser();
    await ada.signIn('ada');
    await solve(ada, 'first-ping', { hint: true, failFirst: true });
    const set = (await ada.json('/api/v1/drills/subnet-range/sets', { json: { level: 1 } })).body.set;
    await ada.json(`/api/v1/drill-sets/${set.id}/finish`, { json: { answers: Array(10).fill({}) } });
    const r = await ada.json('/api/v1/me/profile');
    expect(r.res.headers.get('Cache-Control')).toBe('no-store');
    expect(r.body.visibility).toBe('public');
    expect(r.body.private).toMatchObject({ submits: 2, failedSubmits: 1, acceptance: 0.5, hintsUsed: 1, unsolved: [] });
    expect(r.body.private.practice).toEqual([{ kind: 'subnet-range', sets: 1, correct: 0, xp: 0, answered: 10 }]);
    expect(r.body.private.xpByDay).toHaveLength(1);
    expect(r.body.profile.activity).toEqual([{ day: '2026-11-16', n: 3 }]);
    expect((await h.browser().json('/api/v1/me/profile')).status).toBe(401);
  });

  it('hidden, banned and unknown handles all answer the same 404; a hidden learner stays on the board without a name', async () => {
    const h = harness();
    const ada = h.browser();
    const bob = h.browser();
    await ada.signIn('ada');
    await bob.signIn('bob');
    await solve(ada, 'first-ping');
    await solve(bob, 'first-ping');
    expect((await ada.json('/api/v1/me/visibility', { method: 'PUT', json: { visibility: 'hidden' } })).body).toEqual({ visibility: 'hidden' });
    await h.db.prepare("UPDATE users SET banned_at = 1 WHERE handle = 'bob'").run();
    const anon = h.browser();
    const answers = await Promise.all(['ada', 'bob', 'nobody', 'bad_handle!'].map((x) => anon.json(`/api/v1/users/${x}`)));
    for (const a of answers) {
      expect(a.status).toBe(404);
      expect(a.body).toEqual(answers[0].body);
    }
    const board = (await anon.json('/api/v1/leaderboard')).body.rows;
    expect(board).toEqual([{ rank: 1, handle: null, displayName: 'Hidden learner', avatarUrl: null, xp: 10, solved: 1 }]);
    // The owner still sees their own profile, and can make it public again.
    expect((await ada.json('/api/v1/me/profile')).body.visibility).toBe('hidden');
    await ada.json('/api/v1/me/visibility', { method: 'PUT', json: { visibility: 'public' } });
    expect((await anon.json('/api/v1/users/ADA')).status).toBe(200); // handles are case-insensitive
  });

  it('refuses a bad visibility value and a cross-site change', async () => {
    const h = harness();
    const ada = h.browser();
    await ada.signIn('ada');
    expect((await ada.json('/api/v1/me/visibility', { method: 'PUT', json: { visibility: 'friends' } })).status).toBe(400);
    expect((await ada.json('/api/v1/me/visibility', { method: 'PUT', json: { visibility: 'hidden' }, origin: 'https://evil.test' })).status).toBe(403);
  });

  it('a display name is data, not markup', async () => {
    const h = harness();
    const ada = h.browser();
    await ada.signIn('ada');
    await h.db.prepare(`UPDATE users SET display_name = '<img src=x onerror=alert(1)>' WHERE handle = 'ada'`).run();
    const r = await h.browser().req('/api/v1/users/ada');
    expect(r.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
