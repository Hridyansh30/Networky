// Read-only views: who am I, what the problems look like for me, the
// leaderboard. Every number comes from the caches the judge rebuilds.

import { Hono } from 'hono';
import { ENGINE_VERSION } from '../../src/grading/grade';
import { ACCEPTANCE_MIN_TRIED } from '../../src/problems/stats';
import { levelOf } from '../../src/problems/xp';
import { allJudgeProblems, CONTENT_PACK } from '../content';
import type { AppEnv } from '../env';
import { ApiError } from '../http';
import { toProblemRow } from '../judge';

export { ACCEPTANCE_MIN_TRIED };

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: number): number {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

interface StatsRow {
  xp: number;
  solved: number;
  solved_easy: number;
  solved_medium: number;
  solved_hard: number;
  xp_reached_at: number;
}

export const siteRoutes = new Hono<AppEnv>()
  /** What the client compares with its own bundle: a mismatch means "reload". */
  .get('/meta', (c) =>
    c.json({
      engineVersion: ENGINE_VERSION,
      problemCount: allJudgeProblems().length,
      contentPack: CONTENT_PACK,
      // False until the D1 binding exists (docs/server-setup.md): the app then stays in browser mode.
      ready: !!c.env.DB,
      // Which sign-in buttons to show. `dev` is only ever true on a local `npm run dev`.
      signIn: { github: !!c.env.GITHUB_CLIENT_ID, dev: !!c.var.deps.devLogin },
    }),
  )

  .get('/me', async (c) => {
    const u = c.var.user;
    if (!u) return c.json({ user: null });
    const db = c.env.DB;
    const s = await db.prepare('SELECT * FROM user_stats WHERE user_id = ?').bind(u.id).first<StatsRow>();
    const stats = s ?? { xp: 0, solved: 0, solved_easy: 0, solved_medium: 0, solved_hard: 0, xp_reached_at: 0 };
    // Rank = 1 + users strictly ahead: more XP, or the same XP reached earlier.
    const ahead = stats.xp > 0
      ? await db.prepare('SELECT COUNT(*) AS n FROM user_stats s JOIN users u ON u.id = s.user_id WHERE u.banned_at IS NULL AND (s.xp > ?1 OR (s.xp = ?1 AND s.xp_reached_at < ?2))').bind(stats.xp, stats.xp_reached_at).first<{ n: number }>()
      : null;
    const imported = await db.prepare('SELECT imported_at FROM users WHERE id = ?').bind(u.id).first<{ imported_at: number | null }>();
    const { results } = await db.prepare('SELECT * FROM user_problem WHERE user_id = ?').bind(u.id).all<Record<string, unknown>>();
    return c.json({
      user: { handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl },
      stats: { xp: stats.xp, solved: stats.solved, byDifficulty: { easy: stats.solved_easy, medium: stats.solved_medium, hard: stats.solved_hard }, level: levelOf(stats.xp) },
      rank: ahead ? ahead.n + 1 : null,
      importedAt: imported?.imported_at ?? null,
      progress: Object.fromEntries(results.map((r) => [String(r.slug), toProblemRow(r)])),
    });
  })

  .get('/problems/stats', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM problem_stats').all<{ slug: string; submissions: number; accepted: number; tried: number; solvers: number }>();
    const solvedEver = await c.env.DB.prepare('SELECT COALESCE(SUM(solvers), 0) AS n FROM problem_stats').first<{ n: number }>();
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      solves: solvedEver?.n ?? 0,
      problems: Object.fromEntries(
        results.map((r) => [r.slug, { tried: r.tried, solvers: r.solvers, acceptance: r.tried >= ACCEPTANCE_MIN_TRIED ? r.solvers / r.tried : null }]),
      ),
    });
  })

  .get('/leaderboard', async (c) => {
    const period = c.req.query('period') ?? 'all';
    const page = Math.max(0, Math.min(100, Number(c.req.query('page') ?? 0) || 0));
    const size = 50;
    const db = c.env.DB;
    let rows: { handle: string; display_name: string; avatar_url: string | null; xp: number; solved: number | null }[];
    if (period === 'all') {
      // An index scan on (xp DESC, xp_reached_at ASC): reads `size` rows, not every user.
      ({ results: rows } = await db
        .prepare(
          `SELECT u.handle, u.display_name, u.avatar_url, s.xp, s.solved
             FROM user_stats s JOIN users u ON u.id = s.user_id
            WHERE s.xp > 0 AND u.banned_at IS NULL
            ORDER BY s.xp DESC, s.xp_reached_at ASC LIMIT ? OFFSET ?`,
        )
        .bind(size, page * size)
        .all());
    } else if (period === 'week') {
      const since = weekStart(c.var.deps.now());
      ({ results: rows } = await db
        .prepare(
          `SELECT u.handle, u.display_name, u.avatar_url, SUM(e.delta) AS xp, NULL AS solved
             FROM xp_events e JOIN users u ON u.id = e.user_id
            WHERE e.created_at >= ? AND u.banned_at IS NULL
            GROUP BY e.user_id ORDER BY xp DESC, MAX(e.created_at) ASC LIMIT ? OFFSET ?`,
        )
        .bind(since, size, page * size)
        .all());
    } else {
      throw new ApiError(400, 'bad_period', 'period is all or week.');
    }
    // Same for everyone, so browsers may reuse it for a minute. A board a
    // minute stale is fine; a full scan per visitor is not.
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      period,
      page,
      rows: rows.map((r, i) => ({ rank: page * size + i + 1, handle: r.handle, displayName: r.display_name, avatarUrl: r.avatar_url, xp: r.xp, solved: r.solved })),
    });
  });
