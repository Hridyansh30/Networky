// One-time import of phase 5 progress (saved in the browser) into an account.
//
// The rule: a client may report things that LOWER its score, never things
// that raise it. Local rows fail that test both ways, so:
//   - the saved network is RE-GRADED here; only a pass becomes a solve;
//   - hints used and "solution opened first" are applied as reported
//     (claiming fewer hints is the only lie possible, and it can only matter
//     on a network that really passes);
//   - predict answers are re-checked against the engine;
//   - solved / best / XP from the browser are ignored.
//
// One problem per request, not all 36 in one: each import grades a network,
// and the free Workers plan allows 10 ms of CPU per request. 36 grades in one
// request would be killed; 36 small requests are not. The client loops, then
// calls /import/done, which closes the door for good.

import { Hono } from 'hono';
import { z } from 'zod';
import { ENGINE_VERSION, grade, solved as isSolved } from '../../src/grading/grade';
import { scoreWithHints } from '../../src/grading/hints';
import { deserialize } from '../../src/model/serialize';
import { actualOutcome } from '../../src/problems/predict';
import { requireUser } from '../auth';
import { judgeProblem, variantOf } from '../content';
import type { AppEnv } from '../env';
import { ApiError, newId, readJson } from '../http';
import { networkHash, problemRow, rebuild, redact } from '../judge';
import { LIMITS } from './problems';

const outcome = z.enum(['success', 'refused', 'unreachable', 'prohibited', 'ttl-exceeded', 'lost']);

/** The phase 5 ProblemProgress fields the import reads. Unknown fields are ignored, never trusted. */
const row = z.object({
  specVersion: z.number().int().min(1),
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  attempt: z.string().max(LIMITS.bodyBytes).optional(),
  hints: z.record(z.string().max(64), z.number().int().min(0).max(3)).default({}),
  solutionFirst: z.boolean().default(false),
  answers: z.record(z.string().max(64), outcome).optional(),
  firstTry: z.number().min(0).max(1).optional(),
});

export type ImportResult = 'solved' | 'draft' | 'skipped';

export const importRoutes = new Hono<AppEnv>()
  // Registered before /import/:slug so 'done' is never read as a slug.
  .post('/import/done', async (c) => {
    const user = requireUser(c);
    await c.env.DB.prepare('UPDATE users SET imported_at = COALESCE(imported_at, ?) WHERE id = ?').bind(c.var.deps.now(), user.id).run();
    return c.json({ ok: true });
  })

  .post('/import/:slug', async (c) => {
    const user = requireUser(c);
    const db = c.env.DB;
    const u = await db.prepare('SELECT imported_at FROM users WHERE id = ?').bind(user.id).first<{ imported_at: number | null }>();
    if (u?.imported_at) throw new ApiError(409, 'already_imported', 'This account already imported its browser progress.');
    const spec = judgeProblem(c.req.param('slug'));
    if (!spec) throw new ApiError(404, 'not_found', 'No such problem.');
    const done = await db.prepare("SELECT 1 FROM submissions WHERE user_id = ? AND slug = ? AND source = 'import'").bind(user.id, spec.slug).first();
    if (done) throw new ApiError(409, 'already_imported', 'This problem was already imported.');
    const p = (await readJson(c, z.object({ row }).passthrough(), LIMITS.bodyBytes + 4096)).row;
    // Progress made against older tests is not comparable: skip it.
    if (p.specVersion !== spec.version) return c.json({ result: 'skipped' satisfies ImportResult, reason: 'The problem changed since this progress was saved.' });

    const now = c.var.deps.now();
    // The one place the server accepts a client seed, once per problem: the
    // saved network was built for that variant. A missing seed on a
    // randomized problem gets a fresh server seed (and will likely fail).
    const seed = spec.params ? (p.seed ?? new DataView(c.var.deps.randomBytes(4).buffer).getUint32(0)) : null;
    const variant = variantOf(spec, seed);
    const attemptId = newId(c);
    const writes = [
      db.prepare('UPDATE attempts SET active = 0 WHERE user_id = ? AND slug = ?').bind(user.id, spec.slug),
      db.prepare('INSERT INTO attempts (id, user_id, slug, spec_version, seed, network, created_at, updated_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)').bind(attemptId, user.id, spec.slug, spec.version, seed, p.attempt ?? null, now, now),
      db.prepare('INSERT OR IGNORE INTO user_problem (user_id, slug, difficulty, updated_at) VALUES (?, ?, ?, ?)').bind(user.id, spec.slug, spec.difficulty, now),
    ];
    // Penalties apply as reported.
    for (const r of variant.requirements) {
      const level = p.hints[r.id] ?? 0;
      if (level > 0) {
        writes.push(
          db
            .prepare('INSERT INTO hint_unlocks (user_id, slug, requirement, level, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, slug, requirement) DO UPDATE SET level = MAX(level, excluded.level)')
            .bind(user.id, spec.slug, r.id, level, now),
        );
      }
    }
    if (p.solutionFirst) writes.push(db.prepare('UPDATE user_problem SET solution_opened = 1, solution_first = 1 WHERE user_id = ? AND slug = ?').bind(user.id, spec.slug));

    let result: ImportResult = 'draft';
    if (variant.type === 'predict') {
      const qs = variant.questions ?? [];
      const answers = p.answers ?? {};
      const start = variant.start(variant.values);
      const allRight = qs.length > 0 && qs.every((q) => answers[q.id] && String(actualOutcome(start, q)) === answers[q.id]);
      if (allRight) {
        result = 'solved';
        writes.push(
          db
            .prepare(
              `INSERT INTO submissions (id, user_id, attempt_id, slug, spec_version, engine_version, seed, kind, source, raw_score, hinted_score, max_score, passed, report, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'predict', 'import', ?, ?, ?, 1, ?, ?)`,
            )
            .bind(newId(c), user.id, attemptId, spec.slug, spec.version, ENGINE_VERSION, seed, qs.length, qs.length, qs.length, JSON.stringify({ imported: true }), now),
          // The first-try share cannot be verified; it is taken as reported (it only sets how much XP, never whether).
          db.prepare('UPDATE user_problem SET first_try = COALESCE(first_try, ?) WHERE user_id = ? AND slug = ?').bind(p.firstTry ?? 0, user.id, spec.slug),
        );
      }
    } else if (p.attempt) {
      let ok = false;
      try {
        const topology = deserialize(p.attempt).topology;
        const startDevices = Object.keys(variant.start(variant.values).devices).length;
        if (Object.keys(topology.devices).length <= Math.min(LIMITS.maxDevices, startDevices + LIMITS.extraDevices)) {
          const report = grade(topology, variant, { scope: 'submit', seed: seed ?? undefined });
          ok = isSolved(report);
          if (ok) {
            const hinted = scoreWithHints(report, p.hints);
            writes.push(
              db
                .prepare(
                  `INSERT INTO submissions (id, user_id, attempt_id, slug, spec_version, engine_version, seed, kind, source, network_hash, network,
                                            raw_score, hinted_score, max_score, passed, report, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'network', 'import', ?, ?, ?, ?, ?, 1, ?, ?)`,
                )
                .bind(newId(c), user.id, attemptId, spec.slug, spec.version, ENGINE_VERSION, seed, await networkHash(topology), p.attempt, report.score, hinted.score, report.max, JSON.stringify(redact(report)), now),
            );
          }
        }
      } catch {
        ok = false; // a damaged saved network stays a draft, like in phase 5
      }
      // A failing network is not recorded as a failed submit: the learner may
      // have solved it, then kept experimenting. It stays as the draft.
      result = ok ? 'solved' : 'draft';
    }
    await db.batch([...writes, ...rebuild(db, user.id, variant, now)]);
    return c.json({ result, progress: await problemRow(db, user.id, spec.slug) });
  });
