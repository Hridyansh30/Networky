// Attempts, the judge, hints, the solution and predict answers.
//
// Every handler follows the same rule: the client says WHAT it did (here is
// my network, I want the next hint, my answer is X). The server decides what
// that is worth and writes it. Nothing here accepts a score, a seed, a hint
// level or XP from the client.

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { actualOutcome } from '../../src/problems/predict';
import { grade, ENGINE_VERSION, solved as isSolved } from '../../src/grading/grade';
import { nextHint, scoreWithHints } from '../../src/grading/hints';
import { deserialize, serialize } from '../../src/model/serialize';
import type { Topology } from '../../src/model/types';
import { requireUser } from '../auth';
import { judgeProblem, variantOf, type Variant } from '../content';
import type { AppEnv, SessionUser } from '../env';
import { ApiError, newId, readJson, toHex } from '../http';
import { networkHash, problemRow, rebuild, redact } from '../judge';

/** Limits on what one request may ask of the judge. */
export const LIMITS = {
  /** A real problem network is 2.5 to 7 KB of compact JSON; pretty-printed about twice that. */
  bodyBytes: 160 * 1024,
  /** Devices beyond the start network a solution may add. */
  extraDevices: 8,
  maxDevices: 32,
  submitsPerMinute: 10,
  attemptsPerDay: 10,
  /** Failed networks kept per attempt (passing ones are always kept). */
  failedNetworksKept: 1,
} as const;

const MINUTE = 60_000;
const DAY = 86_400_000;

interface AttemptRow {
  id: string;
  user_id: string;
  slug: string;
  spec_version: number;
  seed: number | null;
  network: string | null;
  created_at: number;
  active: number;
}

async function loadAttempt(c: Context<AppEnv>, user: SessionUser, id: string): Promise<{ attempt: AttemptRow; variant: Variant }> {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new ApiError(404, 'not_found', 'No such attempt.');
  const attempt = await c.env.DB.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').bind(id, user.id).first<AttemptRow>();
  if (!attempt) throw new ApiError(404, 'not_found', 'No such attempt.');
  const spec = judgeProblem(attempt.slug);
  if (!spec) throw new ApiError(404, 'not_found', 'This problem no longer exists.');
  if (spec.version !== attempt.spec_version || !attempt.active) throw new ApiError(409, 'stale_attempt', 'This problem was updated since you started. Start a new attempt.');
  return { attempt, variant: variantOf(spec, attempt.seed) };
}

async function hintsOf(c: Context<AppEnv>, userId: string, slug: string): Promise<Record<string, number>> {
  const { results } = await c.env.DB.prepare('SELECT requirement, level FROM hint_unlocks WHERE user_id = ? AND slug = ?').bind(userId, slug).all<{ requirement: string; level: number }>();
  return Object.fromEntries(results.map((r) => [r.requirement, r.level]));
}

/** The hint texts unlocked so far, filled in for this variant. */
function hintTexts(variant: Variant, hints: Record<string, number>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of variant.requirements) if (hints[r.id]) out[r.id] = r.hints.slice(0, hints[r.id]);
  return out;
}

async function answersOf(c: Context<AppEnv>, attemptId: string, variant: Variant) {
  const { results } = await c.env.DB.prepare('SELECT question_id, choice, correct FROM predict_answers WHERE attempt_id = ?').bind(attemptId).all<{ question_id: string; choice: string; correct: number }>();
  const out: Record<string, { choice: string; correct: boolean; actual: string; explanation: string }> = {};
  for (const r of results) {
    const q = variant.questions?.find((x) => x.id === r.question_id);
    if (q) out[r.question_id] = { choice: r.choice, correct: r.correct === 1, actual: String(actualOutcome(variant.start(variant.values), q)), explanation: q.explanation };
  }
  return out;
}

/** What the problem page needs to restore an attempt on any device. */
async function attemptView(c: Context<AppEnv>, user: SessionUser, attempt: AttemptRow, variant: Variant) {
  const hints = await hintsOf(c, user.id, attempt.slug);
  return {
    id: attempt.id,
    slug: attempt.slug,
    specVersion: attempt.spec_version,
    seed: attempt.seed,
    network: attempt.network,
    hints,
    hintTexts: hintTexts(variant, hints),
    answers: variant.questions ? await answersOf(c, attempt.id, variant) : {},
    progress: await problemRow(c.env.DB, user.id, attempt.slug),
  };
}

/** A fresh seed from the server's random source. The client never chooses one. */
const drawSeed = (c: Context<AppEnv>) => new DataView(c.var.deps.randomBytes(4).buffer).getUint32(0);

const submissionId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be a UUID');

export const problemRoutes = new Hono<AppEnv>()
  // ------------------------------------------------------------ attempts
  .get('/problems/:slug/attempt', async (c) => {
    const user = requireUser(c);
    const spec = judgeProblem(c.req.param('slug'));
    if (!spec) throw new ApiError(404, 'not_found', 'No such problem.');
    const attempt = await c.env.DB.prepare('SELECT * FROM attempts WHERE user_id = ? AND slug = ? AND active = 1 ORDER BY created_at DESC LIMIT 1').bind(user.id, spec.slug).first<AttemptRow>();
    if (!attempt || attempt.spec_version !== spec.version) return c.json({ attempt: null, progress: await problemRow(c.env.DB, user.id, spec.slug) });
    return c.json({ attempt: await attemptView(c, user, attempt, variantOf(spec, attempt.seed)) });
  })

  /** Start (or start over): a new attempt with a server-drawn seed. */
  .post('/problems/:slug/attempts', async (c) => {
    const user = requireUser(c);
    const spec = judgeProblem(c.req.param('slug'));
    if (!spec) throw new ApiError(404, 'not_found', 'No such problem.');
    const now = c.var.deps.now();
    const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND slug = ? AND created_at > ?').bind(user.id, spec.slug, now - DAY).first<{ n: number }>();
    if ((recent?.n ?? 0) >= LIMITS.attemptsPerDay) throw new ApiError(429, 'too_many_attempts', `You can start this problem ${LIMITS.attemptsPerDay} times a day. Your current attempt is still there.`);
    const id = newId(c);
    const seed = spec.params ? drawSeed(c) : null;
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE attempts SET active = 0 WHERE user_id = ? AND slug = ?').bind(user.id, spec.slug),
      c.env.DB.prepare('INSERT INTO attempts (id, user_id, slug, spec_version, seed, created_at, updated_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)').bind(id, user.id, spec.slug, spec.version, seed, now, now),
    ]);
    const attempt = (await c.env.DB.prepare('SELECT * FROM attempts WHERE id = ?').bind(id).first<AttemptRow>())!;
    return c.json({ attempt: await attemptView(c, user, attempt, variantOf(spec, seed)) }, 201);
  })

  /** Autosave of the draft network. Not graded, not ranked. */
  .put('/attempts/:id/network', async (c) => {
    const user = requireUser(c);
    const { attempt } = await loadAttempt(c, user, c.req.param('id'));
    const body = await readJson(c, z.object({ network: z.string().max(LIMITS.bodyBytes) }).strict(), LIMITS.bodyBytes + 1024);
    try {
      deserialize(body.network);
    } catch (e) {
      throw new ApiError(400, 'bad_network', (e as Error).message);
    }
    await c.env.DB.prepare('UPDATE attempts SET network = ?, updated_at = ? WHERE id = ?').bind(body.network, c.var.deps.now(), attempt.id).run();
    return c.body(null, 204);
  })

  // --------------------------------------------------------------- judge
  .post('/attempts/:id/submissions', async (c) => {
    const user = requireUser(c);
    const { attempt, variant } = await loadAttempt(c, user, c.req.param('id'));
    const body = await readJson(c, z.object({ submissionId, network: z.string().max(LIMITS.bodyBytes) }).strict(), LIMITS.bodyBytes + 1024);
    const db = c.env.DB;
    const id = body.submissionId.toLowerCase();

    // A retry of a submit we already graded: return what we said then.
    const earlier = await db.prepare('SELECT user_id, report FROM submissions WHERE id = ?').bind(id).first<{ user_id: string; report: string }>();
    if (earlier) {
      if (earlier.user_id !== user.id) throw new ApiError(409, 'id_taken', 'That submission id is already used.');
      return c.json({ report: JSON.parse(earlier.report), progress: await problemRow(db, user.id, attempt.slug), repeated: true });
    }
    if (variant.type === 'predict') throw new ApiError(400, 'predict_problem', 'Answer the questions of a predict problem one by one.');

    const now = c.var.deps.now();
    const recent = await db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND created_at > ?').bind(user.id, now - MINUTE).first<{ n: number }>();
    if ((recent?.n ?? 0) >= LIMITS.submitsPerMinute) throw new ApiError(429, 'too_many_submits', `At most ${LIMITS.submitsPerMinute} submits a minute. Try Run first: it is instant and free.`);

    let topology: Topology;
    try {
      topology = deserialize(body.network).topology;
    } catch (e) {
      throw new ApiError(400, 'bad_network', (e as Error).message);
    }
    const startDevices = Object.keys(variant.start(variant.values).devices).length;
    const devices = Object.keys(topology.devices).length;
    const allowed = Math.min(LIMITS.maxDevices, startDevices + LIMITS.extraDevices);
    if (devices > allowed) throw new ApiError(400, 'too_many_devices', `This problem allows at most ${allowed} devices; your network has ${devices}.`);

    const report = grade(topology, variant, { scope: 'submit', seed: attempt.seed ?? undefined });
    const hints = await hintsOf(c, user.id, attempt.slug);
    const hinted = scoreWithHints(report, hints);
    const passed = isSolved(report);
    const visible = redact(report);
    const hash = await networkHash(topology);

    await db.batch([
      db
        .prepare(
          `INSERT INTO submissions (id, user_id, attempt_id, slug, spec_version, engine_version, seed, kind, source, network_hash, network,
                                    raw_score, hinted_score, max_score, passed, report, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'network', 'submit', ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
        )
        .bind(id, user.id, attempt.id, attempt.slug, attempt.spec_version, ENGINE_VERSION, attempt.seed, hash, body.network, report.score, hinted.score, report.max, passed ? 1 : 0, JSON.stringify(visible), now),
      // Keep every passing network, and only the latest failing one per attempt.
      db.prepare('UPDATE submissions SET network = NULL WHERE attempt_id = ? AND passed = 0 AND id <> ? AND network IS NOT NULL').bind(attempt.id, id),
      db.prepare('UPDATE attempts SET network = ?, updated_at = ? WHERE id = ?').bind(body.network, now, attempt.id),
      ...rebuild(db, user.id, variant, now),
    ]);
    return c.json({ report: visible, hinted, progress: await problemRow(db, user.id, attempt.slug) });
  })

  // --------------------------------------------------------------- hints
  .post('/attempts/:id/hints', async (c) => {
    const user = requireUser(c);
    const { attempt, variant } = await loadAttempt(c, user, c.req.param('id'));
    const { requirement } = await readJson(c, z.object({ requirement: z.string().max(64) }).strict(), 1024);
    const req = variant.requirements.find((r) => r.id === requirement);
    if (!req) throw new ApiError(400, 'bad_requirement', 'This problem has no such requirement.');
    const hints = await hintsOf(c, user.id, attempt.slug);
    const level = nextHint(hints, requirement);
    if (level !== null) {
      // The unlock is written BEFORE the text leaves the server: a hint you
      // have read is a hint you have paid for.
      await c.env.DB.prepare(
        `INSERT INTO hint_unlocks (user_id, slug, requirement, level, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, slug, requirement) DO UPDATE SET level = MAX(level, excluded.level), updated_at = excluded.updated_at`,
      )
        .bind(user.id, attempt.slug, requirement, level, c.var.deps.now())
        .run();
      hints[requirement] = level;
    }
    return c.json({ requirement, level: hints[requirement] ?? 0, texts: req.hints.slice(0, hints[requirement] ?? 0) });
  })

  // ------------------------------------------------------------ solution
  /**
   * POST, not GET: opening the solution changes your XP. A GET could be
   * triggered by any page that embeds an image pointing here.
   */
  .post('/attempts/:id/solution', async (c) => {
    const user = requireUser(c);
    const { attempt, variant } = await loadAttempt(c, user, c.req.param('id'));
    if (variant.type === 'predict') throw new ApiError(400, 'predict_problem', 'Predict problems explain each answer instead.');
    const row = await problemRow(c.env.DB, user.id, attempt.slug);
    const unlocked = !!row && (row.solved || row.failedSubmits >= 3);
    if (!unlocked) throw new ApiError(403, 'locked', 'The solution unlocks after you solve the problem or after three failed submits.');
    if (!row.solutionOpened) {
      const db = c.env.DB;
      const now = c.var.deps.now();
      await db.batch([
        db.prepare('UPDATE user_problem SET solution_opened = 1, solution_first = CASE WHEN solved = 0 THEN 1 ELSE solution_first END WHERE user_id = ? AND slug = ?').bind(user.id, attempt.slug),
        ...rebuild(db, user.id, variant, now),
      ]);
    }
    return c.json({
      solution: variant.solution ?? '',
      reference: serialize({ topology: variant.reference(variant.values), layout: { ...(variant.layout ?? {}) } }),
      progress: await problemRow(c.env.DB, user.id, attempt.slug),
    });
  })

  // ------------------------------------------------------------- predict
  .post('/attempts/:id/answers', async (c) => {
    const user = requireUser(c);
    const { attempt, variant } = await loadAttempt(c, user, c.req.param('id'));
    const body = await readJson(c, z.object({ questionId: z.string().max(64), choice: z.string().max(32) }).strict(), 1024);
    const questions = variant.questions ?? [];
    const q = questions.find((x) => x.id === body.questionId);
    if (!q) throw new ApiError(400, 'bad_question', 'This problem has no such question.');
    if (!(q.choices as string[]).includes(body.choice)) throw new ApiError(400, 'bad_choice', 'That is not one of the choices.');
    const db = c.env.DB;
    const now = c.var.deps.now();
    const actual = String(actualOutcome(variant.start(variant.values), q));
    // The primary key (attempt, question) makes the first answer final.
    const r = await db
      .prepare('INSERT INTO predict_answers (attempt_id, question_id, choice, correct, answered_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .bind(attempt.id, q.id, body.choice, actual === body.choice ? 1 : 0, now)
      .run();
    if (r.meta.changes === 0) throw new ApiError(409, 'already_answered', 'You already answered this question in this attempt.');

    // Was that the last question? Then the attempt counts as one submission.
    const answers = await answersOf(c, attempt.id, variant);
    if (questions.length > 0 && questions.every((x) => answers[x.id])) {
      const right = questions.filter((x) => answers[x.id].correct).length;
      const report = { complete: true, right, total: questions.length };
      await db.batch([
        db
          .prepare(
            `INSERT INTO submissions (id, user_id, attempt_id, slug, spec_version, engine_version, seed, kind, source, raw_score, hinted_score, max_score, passed, report, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'predict', 'submit', ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
          )
          // One id per attempt, derived from it: a race between two last answers writes one row.
          .bind(`predict-${attempt.id}`, user.id, attempt.id, attempt.slug, attempt.spec_version, ENGINE_VERSION, attempt.seed, right, right, questions.length, right === questions.length ? 1 : 0, JSON.stringify(report), now),
        db.prepare('INSERT OR IGNORE INTO user_problem (user_id, slug, difficulty, updated_at) VALUES (?, ?, ?, ?)').bind(user.id, attempt.slug, variant.difficulty, now),
        // Only the FIRST complete attempt sets the share XP is paid on.
        db.prepare('UPDATE user_problem SET first_try = COALESCE(first_try, ?) WHERE user_id = ? AND slug = ?').bind(right / questions.length, user.id, attempt.slug),
        ...rebuild(db, user.id, variant, now),
      ]);
    }
    return c.json({ answer: answers[q.id], answers, progress: await problemRow(db, user.id, attempt.slug) });
  })

  // ---------------------------------------------------------- history
  .get('/submissions', async (c) => {
    const user = requireUser(c);
    const slug = c.req.query('slug');
    const sql = `SELECT id, slug, kind, source, passed, raw_score, hinted_score, max_score, engine_version, created_at
                   FROM submissions WHERE user_id = ?${slug ? ' AND slug = ?' : ''} ORDER BY created_at DESC LIMIT 50`;
    const stmt = slug ? c.env.DB.prepare(sql).bind(user.id, slug) : c.env.DB.prepare(sql).bind(user.id);
    const { results } = await stmt.all<Record<string, unknown>>();
    return c.json({
      submissions: results.map((r) => ({
        id: r.id,
        slug: r.slug,
        kind: r.kind,
        source: r.source,
        passed: r.passed === 1,
        score: r.hinted_score,
        rawScore: r.raw_score,
        max: r.max_score,
        engineVersion: r.engine_version,
        at: r.created_at,
      })),
    });
  });

/** Exported for the import route: same id format as attempts. */
export const randomHex = (c: Context<AppEnv>, n: number) => toHex(c.var.deps.randomBytes(n));
