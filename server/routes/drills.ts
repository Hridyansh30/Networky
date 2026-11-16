// Drill practice on the server: hand out a set (the server draws the seed),
// then grade the finished set by replaying it from that seed.
//
// Why the server is involved at all, when the generators are public and the
// browser can grade a drill by itself: practice XP reaches the weekly board,
// and the server is the only writer of anything on a board. The daily cap
// (PRACTICE_XP_PER_DAY) is what makes it safe: a script can answer drills,
// but it cannot earn more than a diligent learner.
//
// Cost on the free plan: 2 requests per set of 10 questions, and about 4
// written rows (the set twice, one XP event, plus indexes). The cap bounds
// how many sets earn, and SETS_PER_DAY bounds how many exist.

import { Hono } from 'hono';
import { z } from 'zod';
import { DRILL_KINDS, drillKind, LEVELS, PRACTICE_XP_PER_DAY, replaySet, SET_SIZE, setXp, utcDayStart, type Level } from '../../src/drills';
import { requireUser } from '../auth';
import type { AppEnv } from '../env';
import { ApiError, newId, readJson } from '../http';

export const DRILL_LIMITS = {
  /** Sets a user may start per UTC day, finished or not. */
  setsPerDay: 40,
  /** A set must be finished within this long of starting. */
  setLifetimeMs: 6 * 60 * 60 * 1000,
} as const;

interface SetRow {
  id: string;
  user_id: string;
  kind: string;
  start_level: number;
  seed: number;
  created_at: number;
  finished_at: number | null;
  correct: number | null;
  earned: number | null;
  xp: number | null;
  answers: string | null;
}

const answerSchema = z.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), z.string().max(64)).refine((a) => Object.keys(a).length <= 6, 'too many fields');

/** XP from drills already counted today (UTC). */
async function practiceToday(db: AppEnv['Bindings']['DB'], userId: string, now: number): Promise<number> {
  const r = await db.prepare('SELECT COALESCE(SUM(xp), 0) AS n FROM drill_sets WHERE user_id = ? AND finished_at >= ?').bind(userId, utcDayStart(now)).first<{ n: number }>();
  return r?.n ?? 0;
}

function resultView(row: SetRow, replay?: ReturnType<typeof replaySet>) {
  return {
    id: row.id,
    kind: row.kind,
    startLevel: row.start_level,
    seed: row.seed,
    finished: row.finished_at !== null,
    correct: row.correct,
    earned: row.earned,
    xp: row.xp,
    results: replay?.map((r) => ({ index: r.index, level: r.level, correct: r.correct })),
  };
}

export const drillRoutes = new Hono<AppEnv>()
  /** Start a set. The client picks the kind and the starting level; the server picks the seed. */
  .post('/drills/:kind/sets', async (c) => {
    const user = requireUser(c);
    const kind = drillKind(c.req.param('kind'));
    if (!kind) throw new ApiError(404, 'no_such_drill', 'No such drill.');
    // Replaying 10 simulations at the finish would not fit 10 ms of CPU: these stay browser practice.
    if (kind.runsEngine) throw new ApiError(409, 'practice_only', 'This drill runs the simulator for every question, so it is graded in your browser and earns no practice XP.');
    const body = await readJson(c, z.object({ level: z.number().int().min(1).max(3) }).strict(), 1024);
    const now = c.var.deps.now();
    const db = c.env.DB;
    const started = await db.prepare('SELECT COUNT(*) AS n FROM drill_sets WHERE user_id = ? AND created_at >= ?').bind(user.id, utcDayStart(now)).first<{ n: number }>();
    if ((started?.n ?? 0) >= DRILL_LIMITS.setsPerDay) throw new ApiError(429, 'too_many_sets', `At most ${DRILL_LIMITS.setsPerDay} drill sets a day. They reset at 00:00 UTC.`);
    const seed = new DataView(c.var.deps.randomBytes(4).buffer).getUint32(0);
    const id = newId(c);
    await db.prepare('INSERT INTO drill_sets (id, user_id, kind, start_level, seed, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, user.id, kind.id, body.level, seed, now).run();
    return c.json({ set: { id, kind: kind.id, startLevel: body.level as Level, seed }, practiceToday: await practiceToday(db, user.id, now), cap: PRACTICE_XP_PER_DAY }, 201);
  })

  /**
   * Finish a set: the answers to all 10 questions. The server replays the
   * set from its seed (levels follow from the answers), counts the XP, caps
   * it for the day, and records it, once. Sending the same finish again
   * returns the first result.
   */
  .post('/drill-sets/:id/finish', async (c) => {
    const user = requireUser(c);
    const db = c.env.DB;
    const id = c.req.param('id');
    const body = await readJson(c, z.object({ answers: z.array(answerSchema).length(SET_SIZE) }).strict(), 16 * 1024);
    const row = await db.prepare('SELECT * FROM drill_sets WHERE id = ? AND user_id = ?').bind(id, user.id).first<SetRow>();
    if (!row) throw new ApiError(404, 'no_such_set', 'No such drill set.');
    const kind = drillKind(row.kind);
    if (!kind) throw new ApiError(404, 'no_such_drill', 'This drill no longer exists.');
    if (row.finished_at !== null) {
      // Already finished (a retry, or a second tab): the first answers stand.
      const first = replaySet(kind, row.seed, row.start_level as Level, JSON.parse(row.answers ?? '[]'));
      return c.json({ set: resultView(row, first), practiceToday: await practiceToday(db, user.id, c.var.deps.now()), cap: PRACTICE_XP_PER_DAY });
    }
    const replay = replaySet(kind, row.seed, row.start_level as Level, body.answers);
    const now = c.var.deps.now();
    if (now - row.created_at > DRILL_LIMITS.setLifetimeMs) throw new ApiError(409, 'set_expired', 'This set was started more than 6 hours ago. Start a new one.');

    const correct = replay.filter((r) => r.correct).length;
    const earned = setXp(replay);
    const day = utcDayStart(now);
    // The cap is applied inside SQL, in one atomic batch: two finishes racing
    // each other run one after the other, and the second sees the first's XP.
    await db.batch([
      db
        .prepare(
          `UPDATE drill_sets SET finished_at = ?1, correct = ?2, earned = ?3, answers = ?8,
             xp = MAX(0, MIN(?3, ?4 - (SELECT COALESCE(SUM(xp), 0) FROM drill_sets WHERE user_id = ?5 AND finished_at >= ?6)))
           WHERE id = ?7 AND finished_at IS NULL`,
        )
        .bind(now, correct, earned, PRACTICE_XP_PER_DAY, user.id, day, id, JSON.stringify(body.answers)),
      // One ledger row per set, at most: the slug names the set, and NOT EXISTS guards a retry.
      db
        .prepare(
          `INSERT INTO xp_events (user_id, slug, delta, created_at, source)
           SELECT user_id, 'drill:' || kind || ':' || id, xp, finished_at, 'drill' FROM drill_sets
            WHERE id = ?1 AND xp > 0 AND NOT EXISTS (SELECT 1 FROM xp_events WHERE user_id = ?2 AND slug = 'drill:' || drill_sets.kind || ':' || drill_sets.id)`,
        )
        .bind(id, user.id),
    ]);
    const done = (await db.prepare('SELECT * FROM drill_sets WHERE id = ?').bind(id).first<SetRow>())!;
    return c.json({ set: resultView(done, replay), practiceToday: await practiceToday(db, user.id, now), cap: PRACTICE_XP_PER_DAY });
  })

  /** Your practice so far: today's XP against the cap, and accuracy per drill kind. */
  .get('/me/practice', async (c) => {
    const user = requireUser(c);
    const db = c.env.DB;
    const now = c.var.deps.now();
    const { results } = await db
      .prepare(
        `SELECT kind, COUNT(*) AS sets, COALESCE(SUM(correct), 0) AS correct, COALESCE(SUM(xp), 0) AS xp
           FROM drill_sets WHERE user_id = ? AND finished_at IS NOT NULL GROUP BY kind`,
      )
      .bind(user.id)
      .all<{ kind: string; sets: number; correct: number; xp: number }>();
    const byKind = Object.fromEntries(results.filter((r) => DRILL_KINDS.some((k) => k.id === r.kind)).map((r) => [r.kind, { sets: r.sets, answered: r.sets * SET_SIZE, correct: r.correct, xp: r.xp }]));
    return c.json({ practiceToday: await practiceToday(db, user.id, now), cap: PRACTICE_XP_PER_DAY, byKind, levels: LEVELS });
  });
