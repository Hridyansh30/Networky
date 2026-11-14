// The judge's writes. Everything a learner earns is DERIVED here from rows
// the server wrote itself; no route accepts a score, a count or XP.
//
// The pattern: write the record (a submission, an unlock, an opened
// solution), then rebuild the caches for that user and problem from the
// records, all in one D1 batch. Rebuilding instead of incrementing makes the
// batch idempotent: running it twice leaves the same state as running it
// once, and two racing submits cannot lose an update or double-count XP.
// That is the answer to "how do you keep a counter from drifting without
// locks": don't keep a counter, keep a cache you can always recompute.

import type { Db, Statement } from './db/types';
import { isPredict, xpBase } from './content';
import type { ProblemSpec } from '../src/problems/spec';
import type { GradeReport, TestResult } from '../src/grading/types';
import type { Topology } from '../src/model/types';
import { sha256Hex } from './http';

/** Per-problem state the client shows, read from user_problem. */
export interface ProblemRow {
  slug: string;
  solved: boolean;
  solvedAt: number | null;
  best: number;
  firstTry: number | null;
  solutionOpened: boolean;
  solutionFirst: boolean;
  submits: number;
  failedSubmits: number;
  xp: number;
}

export function toProblemRow(r: Record<string, unknown>): ProblemRow {
  return {
    slug: String(r.slug),
    solved: r.solved === 1,
    solvedAt: (r.solved_at as number | null) ?? null,
    best: Number(r.best),
    firstTry: (r.first_try as number | null) ?? null,
    solutionOpened: r.solution_opened === 1,
    solutionFirst: r.solution_first === 1,
    submits: Number(r.submits),
    failedSubmits: Number(r.failed_submits),
    xp: Number(r.xp),
  };
}

export async function problemRow(db: Db, userId: string, slug: string): Promise<ProblemRow | null> {
  const r = await db.prepare('SELECT * FROM user_problem WHERE user_id = ? AND slug = ?').bind(userId, slug).first();
  return r ? toProblemRow(r) : null;
}

/** Makes sure the cache row exists, so the rebuild below can UPDATE it. */
export const ensureRow = (db: Db, userId: string, spec: ProblemSpec, now: number): Statement =>
  db.prepare('INSERT OR IGNORE INTO user_problem (user_id, slug, difficulty, updated_at) VALUES (?, ?, ?, ?)').bind(userId, spec.slug, spec.difficulty, now);

/**
 * XP for the row as it stands: nothing until solved, nothing if the solution
 * was opened first, else base x share (rounded down, like problemXp in
 * src/problems/xp.ts; both use IEEE doubles, so they agree exactly).
 * A predict problem's share is its first complete attempt.
 */
const XP_EXPR = `CASE WHEN solution_first = 1 OR solved = 0 THEN 0
  ELSE CAST(?1 * (CASE WHEN ?2 = 1 THEN COALESCE(first_try, 0) ELSE best END) AS INTEGER) END`;

/**
 * The statements that rebuild every cache for one user and problem. Order
 * matters: user_problem first, then the XP event (comparing new XP with the
 * stored one), then XP itself, then user_stats and problem_stats.
 */
export function rebuild(db: Db, userId: string, spec: ProblemSpec, now: number): Statement[] {
  const base = xpBase(spec.difficulty);
  const predict = isPredict(spec) ? 1 : 0;
  const slug = spec.slug;
  return [
    ensureRow(db, userId, spec, now),
    db
      .prepare(
        `UPDATE user_problem SET
           solved         = EXISTS (SELECT 1 FROM submissions s WHERE s.user_id = ?1 AND s.slug = ?2 AND s.passed = 1),
           solved_at      = (SELECT MIN(created_at) FROM submissions s WHERE s.user_id = ?1 AND s.slug = ?2 AND s.passed = 1),
           best           = COALESCE((SELECT MAX(CAST(hinted_score AS REAL) / max_score) FROM submissions s
                                       WHERE s.user_id = ?1 AND s.slug = ?2 AND s.passed = 1 AND s.max_score > 0), 0),
           submits        = (SELECT COUNT(*) FROM submissions s WHERE s.user_id = ?1 AND s.slug = ?2),
           failed_submits = (SELECT COUNT(*) FROM submissions s WHERE s.user_id = ?1 AND s.slug = ?2 AND s.passed = 0),
           updated_at     = ?3
         WHERE user_id = ?1 AND slug = ?2`,
      )
      .bind(userId, slug, now),
    // Record the increase, if any, before overwriting the stored XP.
    db
      .prepare(
        `INSERT INTO xp_events (user_id, slug, delta, created_at)
         SELECT user_id, slug, (${XP_EXPR}) - xp, ?5 FROM user_problem
          WHERE user_id = ?3 AND slug = ?4 AND (${XP_EXPR}) > xp`,
      )
      .bind(base, predict, userId, slug, now),
    db.prepare(`UPDATE user_problem SET xp = (${XP_EXPR}) WHERE user_id = ?3 AND slug = ?4`).bind(base, predict, userId, slug),
    db
      .prepare(
        `INSERT INTO user_stats (user_id, xp, solved, solved_easy, solved_medium, solved_hard, xp_reached_at)
         SELECT ?1, COALESCE(SUM(xp), 0), COALESCE(SUM(solved), 0),
                COALESCE(SUM(solved AND difficulty = 'easy'), 0), COALESCE(SUM(solved AND difficulty = 'medium'), 0),
                COALESCE(SUM(solved AND difficulty = 'hard'), 0), ?2
           FROM user_problem WHERE user_id = ?1
         ON CONFLICT (user_id) DO UPDATE SET
           xp = excluded.xp, solved = excluded.solved, solved_easy = excluded.solved_easy,
           solved_medium = excluded.solved_medium, solved_hard = excluded.solved_hard,
           xp_reached_at = CASE WHEN excluded.xp <> user_stats.xp THEN excluded.xp_reached_at ELSE user_stats.xp_reached_at END`,
      )
      .bind(userId, now),
    db
      .prepare(
        `INSERT INTO problem_stats (slug, submissions, accepted, tried, solvers)
         SELECT ?1, COUNT(*), COALESCE(SUM(passed), 0), COUNT(DISTINCT user_id),
                COUNT(DISTINCT CASE WHEN passed = 1 THEN user_id END)
           FROM submissions WHERE slug = ?1
         ON CONFLICT (slug) DO UPDATE SET submissions = excluded.submissions, accepted = excluded.accepted,
           tried = excluded.tried, solvers = excluded.solvers`,
      )
      .bind(slug),
  ];
}

/**
 * What the client may see of a report. Shown tests come back whole. A hidden
 * test keeps its title only once it fails (as in phase 5), and never its
 * detail or drop point: those describe the hidden setup.
 */
export function redact(report: GradeReport): GradeReport {
  const tests: TestResult[] = report.tests.map((t) =>
    t.shown ? t : { id: t.id, requirement: t.requirement, pass: t.pass, shown: false, points: t.points, earned: t.earned, title: t.pass ? 'Hidden test' : t.title, detail: '' },
  );
  return { ...report, tests };
}

/**
 * A fingerprint of a network's configuration with everything incidental
 * removed: ids become hostnames and port names, MACs and layout are dropped,
 * keys are sorted. Two learners who submit the same configuration get the
 * same hash however they built it, which is what copy detection needs.
 */
export async function networkHash(t: Topology): Promise<string> {
  const host = (deviceId: string) => t.devices[deviceId]?.hostname ?? '?';
  const portName = (ifId: string) => {
    const i = t.interfaces[ifId];
    return i ? `${host(i.deviceId)}/${i.name}` : '?';
  };
  const idFields = new Set(['id', 'deviceId', 'interfaceIds', 'linkId', 'parentId', 'mac']);
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        if (idFields.has(k)) continue;
        const x = (v as Record<string, unknown>)[k];
        // Interface ids inside config (NAT inside/outside, ACL bindings) become port names.
        out[k] = typeof x === 'string' && t.interfaces[x] ? portName(x) : clean(x);
      }
      return out;
    }
    return v;
  };
  const devices = Object.values(t.devices)
    .map((d) => ({ device: clean(d), ports: d.interfaceIds.map((i) => clean({ ...t.interfaces[i], name: portName(i) })) }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const links = Object.values(t.links)
    .map((l) => [portName(l.a), portName(l.b)].sort().join(' -- ') + ` ${l.cable}`)
    .sort();
  return sha256Hex(JSON.stringify({ devices, links }));
}
