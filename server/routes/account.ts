// The learner's own data: download all of it, or delete the account.
//
// Both are launch requirements, not features: anyone who signs up must be
// able to see what is stored about them and make it go away (the right of
// access and the right to erasure in GDPR-style laws, and plain fairness).

import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { requireUser, sessionCookie } from '../auth';
import type { AppEnv } from '../env';
import { ApiError, readJson } from '../http';
import { rebuildProblemStats } from '../judge';

/** Every table that holds rows about a user, for the export. A new such table goes here AND in the delete below (account.test.ts checks the delete). */
const USER_TABLES = [
  ['identities', 'SELECT provider, provider_user_id, created_at FROM identities WHERE user_id = ?'],
  ['attempts', 'SELECT id, slug, spec_version, seed, network, created_at, updated_at, active FROM attempts WHERE user_id = ? ORDER BY created_at'],
  [
    'submissions',
    'SELECT id, attempt_id, slug, spec_version, engine_version, seed, kind, source, network, raw_score, hinted_score, max_score, passed, report, created_at FROM submissions WHERE user_id = ? ORDER BY created_at',
  ],
  ['hint_unlocks', 'SELECT slug, requirement, level, updated_at FROM hint_unlocks WHERE user_id = ?'],
  ['predict_answers', 'SELECT p.attempt_id, p.question_id, p.choice, p.correct, p.answered_at FROM predict_answers p JOIN attempts a ON a.id = p.attempt_id WHERE a.user_id = ?'],
  ['problems', 'SELECT slug, solved, solved_at, best, first_try, solution_opened, solution_first, submits, failed_submits, xp FROM user_problem WHERE user_id = ?'],
  ['xp_events', 'SELECT slug, delta, created_at FROM xp_events WHERE user_id = ? ORDER BY id'],
] as const;

export const accountRoutes = new Hono<AppEnv>()
  /**
   * Everything stored about you, as one JSON file. Session token hashes are
   * left out: they are useless to you and are the one thing that should
   * never be copied around. How many sessions exist is included instead.
   */
  .get('/me/export', async (c) => {
    const user = requireUser(c);
    const db = c.env.DB;
    const profile = await db.prepare('SELECT handle, display_name, avatar_url, created_at, imported_at FROM users WHERE id = ?').bind(user.id).first();
    const out: Record<string, unknown> = {
      exportedAt: new Date(c.var.deps.now()).toISOString(),
      format: 'networky-export/1',
      profile,
    };
    for (const [name, sql] of USER_TABLES) out[name] = (await db.prepare(sql).bind(user.id).all()).results;
    out.stats = await db.prepare('SELECT xp, solved, solved_easy, solved_medium, solved_hard FROM user_stats WHERE user_id = ?').bind(user.id).first();
    out.activeSessions = (await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(user.id).first<{ n: number }>())?.n ?? 0;
    c.header('Content-Disposition', `attachment; filename="networky-${user.handle}.json"`);
    return c.json(out);
  })

  /**
   * Deletes the account and everything in it, at once and for good. The
   * learner types their handle to confirm, so a stray click or a forged
   * request (already blocked by the Origin check) cannot do it.
   *
   * Child rows first, by hand, in one batch: that does not depend on
   * foreign-key enforcement being switched on, and it is all-or-nothing.
   * Then the shared acceptance numbers are rebuilt for every problem the
   * user touched, so their attempts stop counting there too.
   */
  .post('/me/delete', async (c) => {
    const user = requireUser(c);
    const { confirm } = await readJson(c, z.object({ confirm: z.string().max(64) }).strict(), 1024);
    if (confirm.toLowerCase() !== user.handle.toLowerCase()) throw new ApiError(400, 'confirm_mismatch', `Type your handle (${user.handle}) to confirm.`);
    const db = c.env.DB;
    const { results } = await db.prepare('SELECT DISTINCT slug FROM submissions WHERE user_id = ?').bind(user.id).all<{ slug: string }>();
    const id = user.id;
    await db.batch([
      db.prepare('DELETE FROM predict_answers WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = ?)').bind(id),
      db.prepare('DELETE FROM submissions WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM attempts WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM hint_unlocks WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM xp_events WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM user_problem WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM user_stats WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM identities WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(id),
      ...results.map((r) => rebuildProblemStats(db, r.slug)),
    ]);
    deleteCookie(c, 'session', { ...sessionCookie });
    return c.json({ deleted: true });
  });

/** For tests: the tables the export and delete cover. */
export const ACCOUNT_TABLES = USER_TABLES.map(([name]) => name);
