import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/model/serialize';
import { problemBySlug } from '../../src/problems/catalog';
import { instantiate } from '../../src/problems/params';
import { harness, type Harness } from './harness';

const net = (slug: string) => {
  const v = instantiate(problemBySlug(slug)!);
  return serialize({ topology: v.reference(v.values), layout: {} });
};
const count = async (h: Harness, table: string) => (await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

/** A user who has done a bit of everything: solved, used a hint, answered a predict question. */
async function busyUser(h: Harness, handle: string) {
  const b = h.browser();
  await b.signIn(handle);
  const a = (await b.json('/api/v1/problems/first-ping/attempts', { json: {} })).body.attempt;
  await b.json(`/api/v1/attempts/${a.id}/hints`, {
    json: { requirement: problemBySlug('first-ping')!.requirements[0].id },
  });
  const r = await b.json(`/api/v1/attempts/${a.id}/submissions`, {
    json: { submissionId: crypto.randomUUID(), network: net('first-ping') },
  });
  expect(r.body.report.score).toBe(r.body.report.max);
  return b;
}

describe('account data', () => {
  it('export: everything about you, nothing about anyone else, no token hashes', async () => {
    const h = harness();
    const ada = await busyUser(h, 'ada');
    await busyUser(h, 'bo');
    const r = await ada.json('/api/v1/me/export');
    expect(r.status).toBe(200);
    expect(r.res.headers.get('Content-Disposition')).toContain('networky-ada.json');
    expect(r.body.profile.handle).toBe('ada');
    expect(r.body.submissions).toHaveLength(1);
    expect(r.body.hint_unlocks).toHaveLength(1);
    expect(r.body.problems[0]).toMatchObject({ slug: 'first-ping', solved: 1 });
    expect(r.body.activeSessions).toBe(1);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('token_hash');
    expect(text).not.toMatch(/"bo"/);
  });

  it('export needs a session', async () => {
    const h = harness();
    expect((await h.browser().json('/api/v1/me/export')).status).toBe(401);
  });

  it('delete: needs the handle typed, then removes every row and the session', async () => {
    const h = harness();
    const ada = await busyUser(h, 'ada');
    const bo = await busyUser(h, 'bo');
    expect((await ada.json('/api/v1/me/delete', { json: { confirm: 'nope' } })).status).toBe(400);
    const adaId = (await h.db.prepare("SELECT id FROM users WHERE handle = 'ada'").first<{ id: string }>())!.id;
    const adaAttempts = (await h.db.prepare('SELECT id FROM attempts WHERE user_id = ?').bind(adaId).all<{ id: string }>()).results.map((r) => r.id);
    expect((await ada.json('/api/v1/me/delete', { json: { confirm: 'ADA' } })).body).toEqual({ deleted: true });

    // Every table in the schema: no row points at ada any more. A table
    // added later with a user_id or attempt_id column is covered automatically.
    const { results: tables } = await h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all<{ name: string }>();
    for (const { name } of tables) {
      const cols = (await h.db.prepare(`SELECT name FROM pragma_table_info('${name}')`).all<{ name: string }>()).results.map((c) => c.name);
      if (cols.includes('user_id')) expect((await h.db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE user_id = ?`).bind(adaId).first<{ n: number }>())!.n, name).toBe(0);
      if (cols.includes('attempt_id'))
        for (const a of adaAttempts) expect((await h.db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE attempt_id = ?`).bind(a).first<{ n: number }>())!.n, name).toBe(0);
    }
    expect(await h.db.prepare('SELECT 1 FROM users WHERE id = ?').bind(adaId).first()).toBeNull();

    // Only bo's rows are left anywhere.
    for (const t of ['users', 'identities', 'sessions', 'attempts', 'submissions', 'hint_unlocks', 'user_problem', 'user_stats', 'xp_events']) {
      const n = await count(h, t);
      expect(n, t).toBe(1);
    }
    // The shared acceptance numbers no longer count ada.
    const ps = await h.db.prepare("SELECT tried, solvers FROM problem_stats WHERE slug = 'first-ping'").first();
    expect(ps).toEqual({ tried: 1, solvers: 1 });
    // ada is signed out and off the board; bo is untouched.
    expect((await ada.json('/api/v1/me')).body.user).toBeNull();
    expect((await bo.json('/api/v1/me')).body.user.handle).toBe('bo');
    const board = (await bo.json('/api/v1/leaderboard')).body.rows;
    expect(board.map((r: { handle: string }) => r.handle)).toEqual(['bo']);
  });

  it('delete is refused from another site', async () => {
    const h = harness();
    const ada = await busyUser(h, 'ada');
    const r = await ada.json('/api/v1/me/delete', {
      json: { confirm: 'ada' },
      origin: 'https://evil.example',
    });
    expect(r.status).toBe(403);
    expect(await count(h, 'users')).toBe(1);
  });

  it('signing in again after deleting starts a fresh, empty account', async () => {
    const h = harness();
    const ada = await busyUser(h, 'ada');
    await ada.json('/api/v1/me/delete', { json: { confirm: 'ada' } });
    await ada.signIn('ada');
    const me = (await ada.json('/api/v1/me')).body;
    expect(me.stats.xp).toBe(0);
    expect(me.progress).toEqual({});
  });
});
