// Profiles: one page, #/u/<handle>, served by two endpoints.
//
//   GET /users/:handle  the public half. The same answer for every visitor,
//                       so it may be cached (60 s). It NEVER reads the session:
//                       a cached copy can then never contain anyone's private data.
//   GET /me/profile     the owner's view: the public half plus the private half
//                       (hints, failed submits, practice, XP over time).
//                       `no-store`, so no cache keeps it.
//
// Splitting by URL makes "a cache served my stats to a stranger" impossible
// by construction, instead of depending on getting a cache key right.
//
// Every number is computed on read from records (no new cache tables): on
// D1's free plan writes are the scarce quota (100k/day vs 5M reads), so a
// rarely viewed page should cost reads, not make every submit write more.

import { Hono } from 'hono';
import { z } from 'zod';
import { DRILL_KINDS } from '../../src/drills';
import { PROBLEMS, TOPICS } from '../../src/problems/catalog';
import { levelOf } from '../../src/problems/xp';
import { requireUser } from '../auth';
import type { Db } from '../db/types';
import type { AppEnv } from '../env';
import { ApiError, readJson } from '../http';

const DAY = 86_400_000;
/** GitHub logins are 1-39 letters, digits and hyphens; dev handles are a subset. */
export const HANDLE = /^[A-Za-z0-9-]{1,39}$/;

const dayOf = (ms: number) => new Date(ms - (ms % DAY)).toISOString().slice(0, 10);

interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  created_at: number;
  profile_visibility: 'public' | 'hidden';
}

/** The public half. Only what passed the judge, plus day-level activity. */
export async function publicProfile(db: Db, u: UserRow, now: number) {
  const stats = (await db.prepare('SELECT xp, solved, xp_reached_at FROM user_stats WHERE user_id = ?').bind(u.id).first<{ xp: number; solved: number; xp_reached_at: number }>()) ?? { xp: 0, solved: 0, xp_reached_at: 0 };
  // Rank exactly as /me computes it: 1 + users strictly ahead.
  const ahead =
    stats.xp > 0
      ? await db
          .prepare('SELECT COUNT(*) AS n FROM user_stats s JOIN users x ON x.id = s.user_id WHERE x.banned_at IS NULL AND (s.xp > ?1 OR (s.xp = ?1 AND s.xp_reached_at < ?2))')
          .bind(stats.xp, stats.xp_reached_at)
          .first<{ n: number }>()
      : null;
  const { results: solvedRows } = await db.prepare('SELECT slug, solved_at FROM user_problem WHERE user_id = ? AND solved = 1 ORDER BY solved_at DESC').bind(u.id).all<{ slug: string; solved_at: number }>();
  const known = new Map(PROBLEMS.map((p) => [p.slug, p]));
  const solved = solvedRows.filter((r) => known.has(r.slug)).map((r) => ({ slug: r.slug, title: known.get(r.slug)!.title, difficulty: known.get(r.slug)!.difficulty, topic: known.get(r.slug)!.topic, day: dayOf(r.solved_at) }));
  const since = now - (now % DAY) - 364 * DAY;
  // Activity: graded submits plus finished drill sets, by UTC day. Days only, never times.
  const { results: activity } = await db
    .prepare(
      `SELECT d AS day, SUM(n) AS n FROM (
         SELECT (created_at / 86400000) AS d, COUNT(*) AS n FROM submissions WHERE user_id = ?1 AND created_at >= ?2 GROUP BY d
         UNION ALL
         SELECT (finished_at / 86400000) AS d, COUNT(*) AS n FROM drill_sets WHERE user_id = ?1 AND finished_at >= ?2 GROUP BY d
       ) GROUP BY d ORDER BY d`,
    )
    .bind(u.id, since)
    .all<{ day: number; n: number }>();
  const count = (pred: (p: (typeof PROBLEMS)[number]) => boolean) => PROBLEMS.filter(pred).length;
  return {
    handle: u.handle,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    memberSince: dayOf(u.created_at),
    xp: stats.xp,
    level: levelOf(stats.xp),
    rank: ahead ? ahead.n + 1 : null,
    solvedCount: solved.length,
    problemCount: PROBLEMS.length,
    byDifficulty: (['easy', 'medium', 'hard'] as const).map((d) => ({ difficulty: d, solved: solved.filter((s) => s.difficulty === d).length, total: count((p) => p.difficulty === d) })),
    byTopic: TOPICS.map((t) => ({ topic: t, solved: solved.filter((s) => s.topic === t).length, total: count((p) => p.topic === t) })).filter((t) => t.total > 0),
    solved,
    activity: activity.map((a) => ({ day: dayOf(a.day * DAY), n: a.n })),
  };
}

export type PublicProfile = Awaited<ReturnType<typeof publicProfile>>;

/** What only the owner sees. */
async function privateProfile(db: Db, userId: string) {
  const sums = await db
    .prepare('SELECT COALESCE(SUM(submits), 0) AS submits, COALESCE(SUM(failed_submits), 0) AS failed, COALESCE(SUM(solution_opened), 0) AS solutions FROM user_problem WHERE user_id = ?')
    .bind(userId)
    .first<{ submits: number; failed: number; solutions: number }>();
  const hints = await db.prepare('SELECT COALESCE(SUM(level), 0) AS n FROM hint_unlocks WHERE user_id = ?').bind(userId).first<{ n: number }>();
  const { results: open } = await db.prepare('SELECT slug FROM user_problem WHERE user_id = ? AND solved = 0 AND submits > 0').bind(userId).all<{ slug: string }>();
  const { results: xp } = await db
    .prepare(`SELECT (created_at / 86400000) AS d, SUM(CASE WHEN source = 'drill' THEN 0 ELSE delta END) AS problem, SUM(CASE WHEN source = 'drill' THEN delta ELSE 0 END) AS practice FROM xp_events WHERE user_id = ? GROUP BY d ORDER BY d`)
    .bind(userId)
    .all<{ d: number; problem: number; practice: number }>();
  const { results: practice } = await db
    .prepare('SELECT kind, COUNT(*) AS sets, COALESCE(SUM(correct), 0) AS correct, COALESCE(SUM(xp), 0) AS xp FROM drill_sets WHERE user_id = ? AND finished_at IS NOT NULL GROUP BY kind')
    .bind(userId)
    .all<{ kind: string; sets: number; correct: number; xp: number }>();
  const known = new Map(PROBLEMS.map((p) => [p.slug, p]));
  const s = sums ?? { submits: 0, failed: 0, solutions: 0 };
  return {
    submits: s.submits,
    failedSubmits: s.failed,
    // Passed / all graded submits. Shown to the owner only: useful feedback, shaming in public.
    acceptance: s.submits > 0 ? (s.submits - s.failed) / s.submits : null,
    hintsUsed: hints?.n ?? 0,
    solutionsOpened: s.solutions,
    /** Tried and not solved yet: where to pick up. */
    unsolved: open.filter((r) => known.has(r.slug)).map((r) => ({ slug: r.slug, title: known.get(r.slug)!.title, topic: known.get(r.slug)!.topic })),
    xpByDay: xp.map((r) => ({ day: dayOf(r.d * DAY), problem: r.problem, practice: r.practice })),
    practice: practice.filter((p) => DRILL_KINDS.some((k) => k.id === p.kind)).map((p) => ({ ...p, answered: p.sets * 10 })),
  };
}

const findUser = (db: Db, handle: string) =>
  db.prepare('SELECT id, handle, display_name, avatar_url, created_at, profile_visibility FROM users WHERE handle = ? AND banned_at IS NULL').bind(handle).first<UserRow>();

export const profileRoutes = new Hono<AppEnv>()
  .get('/users/:handle', async (c) => {
    const handle = c.req.param('handle');
    // Hidden, banned and unknown all give the same 404: a visitor cannot tell them apart.
    const notFound = () => new ApiError(404, 'no_such_profile', 'No public profile with that handle.');
    if (!HANDLE.test(handle)) throw notFound();
    const u = await findUser(c.env.DB, handle);
    if (!u || u.profile_visibility !== 'public') throw notFound();
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ profile: await publicProfile(c.env.DB, u, c.var.deps.now()) });
  })

  .get('/me/profile', async (c) => {
    const me = requireUser(c);
    const u = (await c.env.DB.prepare('SELECT id, handle, display_name, avatar_url, created_at, profile_visibility FROM users WHERE id = ?').bind(me.id).first<UserRow>())!;
    return c.json({
      profile: await publicProfile(c.env.DB, u, c.var.deps.now()),
      visibility: u.profile_visibility,
      private: await privateProfile(c.env.DB, me.id),
    });
  })

  .put('/me/visibility', async (c) => {
    const me = requireUser(c);
    const { visibility } = await readJson(c, z.object({ visibility: z.enum(['public', 'hidden']) }).strict(), 256);
    await c.env.DB.prepare('UPDATE users SET profile_visibility = ? WHERE id = ?').bind(visibility, me.id).run();
    return c.json({ visibility });
  });
