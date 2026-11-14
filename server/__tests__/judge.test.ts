import { describe, expect, it } from 'vitest';
import { grade, solved } from '../../src/grading/grade';
import { serialize } from '../../src/model/serialize';
import { PROBLEMS, problemBySlug } from '../../src/problems/catalog';
import { instantiate } from '../../src/problems/params';
import { problemXp } from '../../src/problems/xp';
import { harness, type Browser, type Harness } from './harness';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

async function start(b: Browser, slug: string) {
  const r = await b.json(`/api/v1/problems/${slug}/attempts`, { method: 'POST', json: {} });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.attempt as { id: string; seed: number | null };
}

/** The network a learner would build: the problem's reference (or any builder) for the attempt's variant. */
function net(slug: string, seed: number | null, pick: 'start' | 'reference' | number = 'reference') {
  const v = instantiate(problemBySlug(slug)!, seed ?? undefined);
  const t = pick === 'start' ? v.start(v.values) : pick === 'reference' ? v.reference(v.values) : v.wrong[pick](v.values);
  return serialize({ topology: t, layout: {} });
}

async function submit(b: Browser, attemptId: string, network: string, id = uuid()) {
  return b.json(`/api/v1/attempts/${attemptId}/submissions`, { json: { submissionId: id, network } });
}

const count = async (h: Harness, sql: string, ...v: (string | number)[]) => (await h.db.prepare(sql).bind(...v).first<{ n: number }>())!.n;

describe('the judge', () => {
  it('grades a correct network, pays XP once, and counts every submit', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    const r1 = await submit(b, a.id, net('first-ping', a.seed));
    expect(r1.status).toBe(200);
    expect(r1.body.report.score).toBe(r1.body.report.max);
    expect(r1.body.progress).toMatchObject({ solved: true, best: 1, xp: 10, submits: 1, failedSubmits: 0 });
    h.clock.now += 1000;
    const r2 = await submit(b, a.id, net('first-ping', a.seed));
    expect(r2.body.progress).toMatchObject({ xp: 10, submits: 2 });
    expect(await count(h, 'SELECT COUNT(*) AS n FROM xp_events')).toBe(1);
    const me = await b.json('/api/v1/me');
    expect(me.body.stats).toMatchObject({ xp: 10, solved: 1, byDifficulty: { easy: 1, medium: 0, hard: 0 } });
    expect(me.body.rank).toBe(1);
  });

  it('records a failed submit without XP', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    const r = await submit(b, a.id, net('first-ping', a.seed, 'start'));
    expect(r.status).toBe(200);
    expect(r.body.progress).toMatchObject({ solved: false, xp: 0, submits: 1, failedSubmits: 1 });
  });

  it('returns the stored verdict for a retried request and changes nothing', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    const id = uuid();
    const first = await submit(b, a.id, net('first-ping', a.seed), id);
    const again = await submit(b, a.id, net('first-ping', a.seed, 'start'), id); // even with another body
    expect(again.body.repeated).toBe(true);
    expect(again.body.report).toEqual(first.body.report);
    expect(again.body.progress.submits).toBe(1);
    // Someone else cannot reuse (or probe) that id.
    const other = h.browser();
    await other.signIn('mallory');
    const theirs = await start(other, 'first-ping');
    expect((await submit(other, theirs.id, net('first-ping', null), id)).status).toBe(409);
  });

  it('accepts no verdict, score or seed from the client', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    const forged = await b.json(`/api/v1/attempts/${a.id}/submissions`, { json: { submissionId: uuid(), network: net('first-ping', null, 'start'), score: 6, passed: true } });
    expect(forged.status).toBe(400);
    const seeded = await b.json('/api/v1/problems/join-the-lan/attempts', { method: 'POST', json: { seed: 1 } });
    expect(seeded.status).toBe(201);
    expect(seeded.body.attempt.seed).not.toBe(1);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM submissions')).toBe(0);
  });

  it('grades a randomized problem on the seed the server stored, not the one the network was built for', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'join-the-lan');
    expect(a.seed).toEqual(expect.any(Number));
    const otherSeed = (a.seed! + 1) >>> 0;
    const wrongVariant = await submit(b, a.id, net('join-the-lan', otherSeed));
    const rightVariant = await submit(b, a.id, net('join-the-lan', a.seed));
    expect(rightVariant.body.progress.solved).toBe(true);
    // A copied answer for someone else's variant fails (when the variants differ).
    const v1 = instantiate(problemBySlug('join-the-lan')!, a.seed!).values;
    const v2 = instantiate(problemBySlug('join-the-lan')!, otherSeed).values;
    if (JSON.stringify(v1) !== JSON.stringify(v2)) expect(wrongVariant.body.report.score).toBeLessThan(wrongVariant.body.report.max);
  });

  it('hides what hidden tests check', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const spec = PROBLEMS.find((p) => p.difficulty === 'hard' && p.type !== 'predict' && !p.params)!;
    const a = await start(b, spec.slug);
    const r = await submit(b, a.id, net(spec.slug, a.seed, 'start'));
    const hidden = r.body.report.tests.filter((t: { shown: boolean }) => !t.shown);
    expect(hidden.length).toBeGreaterThan(0);
    for (const t of hidden) {
      expect(t.detail).toBe('');
      expect(t.dropAt).toBeUndefined();
      if (t.pass) expect(t.title).toBe('Hidden test');
    }
  });

  it('enforces size, shape, device and rate limits', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    expect((await b.json(`/api/v1/attempts/${a.id}/submissions`, { method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    const huge = 'x'.repeat(200 * 1024);
    expect((await submit(b, a.id, huge)).status).toBe(413);
    expect((await submit(b, a.id, '{"not":"a network"}')).status).toBe(400);
    // Too many devices.
    const v = instantiate(problemBySlug('first-ping')!);
    const t = v.reference(v.values);
    const { addDevice } = await import('../../src/model/ops');
    let big = t;
    for (let i = 0; i < 12; i++) big = addDevice(big, 'pc', { hostname: `Extra${i}` }).topology;
    const tooBig = await submit(b, a.id, serialize({ topology: big, layout: {} }));
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error).toBe('too_many_devices');
    // Ten graded submits a minute, then 429.
    for (let i = 0; i < 10; i++) expect((await submit(b, a.id, net('first-ping', null, 'start'))).status).toBe(200);
    expect((await submit(b, a.id, net('first-ping', null, 'start'))).status).toBe(429);
    h.clock.now += 61_000;
    expect((await submit(b, a.id, net('first-ping', null, 'start'))).status).toBe(200);
  });

  it('keeps each user out of everyone else\'s attempts', async () => {
    const h = harness();
    const alice = h.browser();
    await alice.signIn('alice');
    const a = await start(alice, 'first-ping');
    const bob = h.browser();
    await bob.signIn('bob');
    expect((await submit(bob, a.id, net('first-ping', null))).status).toBe(404);
    expect((await bob.json(`/api/v1/attempts/${a.id}/hints`, { json: { requirement: 'address' } })).status).toBe(404);
    expect((await h.browser().json(`/api/v1/attempts/${a.id}/hints`, { json: { requirement: 'address' } })).status).toBe(401);
  });

  it('turns a changed problem into a stale attempt instead of grading against new tests', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    await h.db.prepare('UPDATE attempts SET spec_version = spec_version - 1').run();
    expect((await submit(b, a.id, net('first-ping', null))).body.error).toBe('stale_attempt');
  });

  it('limits Start over to ten a day per problem', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    for (let i = 0; i < 10; i++) await start(b, 'join-the-lan');
    expect((await b.json('/api/v1/problems/join-the-lan/attempts', { method: 'POST', json: {} })).status).toBe(429);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM attempts WHERE active = 1')).toBe(1);
  });
});

describe('hints and the solution', () => {
  it('records a hint before returning it, and the hint costs points', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    const hint = await b.json(`/api/v1/attempts/${a.id}/hints`, { json: { requirement: 'address' } });
    expect(hint.body).toMatchObject({ requirement: 'address', level: 1 });
    expect(hint.body.texts).toHaveLength(1);
    expect(await count(h, 'SELECT level AS n FROM hint_unlocks')).toBe(1);
    const r = await submit(b, a.id, net('first-ping', a.seed));
    expect(r.body.progress.solved).toBe(true);
    expect(r.body.progress.best).toBeLessThan(1);
    expect(r.body.progress.xp).toBe(problemXp({ difficulty: 'easy', best: r.body.progress.best, solutionFirst: false }));
    // Start over keeps the hints (and their cost).
    const again = await start(b, 'first-ping');
    expect((await b.json('/api/v1/problems/first-ping/attempt')).body.attempt.hints).toEqual({ address: 1 });
    expect(again.id).not.toBe(a.id);
  });

  it('stops at three hints per requirement', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    for (let i = 0; i < 5; i++) await b.json(`/api/v1/attempts/${a.id}/hints`, { json: { requirement: 'address' } });
    expect(await count(h, 'SELECT level AS n FROM hint_unlocks')).toBe(3);
    expect((await b.json(`/api/v1/attempts/${a.id}/hints`, { json: { requirement: 'nope' } })).status).toBe(400);
  });

  it('locks the solution until a solve or three failed submits, and opening it first costs the XP', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    expect((await b.json(`/api/v1/attempts/${a.id}/solution`, { method: 'POST', json: {} })).status).toBe(403);
    for (let i = 0; i < 3; i++) await submit(b, a.id, net('first-ping', null, 'start'));
    const sol = await b.json(`/api/v1/attempts/${a.id}/solution`, { method: 'POST', json: {} });
    expect(sol.status).toBe(200);
    expect(sol.body.solution.length).toBeGreaterThan(10);
    expect(sol.body.reference).toContain('"format": "networky"');
    expect(sol.body.progress).toMatchObject({ solutionOpened: true, solutionFirst: true });
    const r = await submit(b, a.id, net('first-ping', null));
    expect(r.body.progress).toMatchObject({ solved: true, xp: 0 });
  });

  it('opening the solution after solving keeps the XP', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    await submit(b, a.id, net('first-ping', null));
    const sol = await b.json(`/api/v1/attempts/${a.id}/solution`, { method: 'POST', json: {} });
    expect(sol.body.progress).toMatchObject({ solutionOpened: true, solutionFirst: false, xp: 10 });
  });

  it('cannot be opened by a cross-site page (it is a POST behind the Origin check)', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, 'first-ping');
    await submit(b, a.id, net('first-ping', null));
    expect((await b.json(`/api/v1/attempts/${a.id}/solution`)).status).toBe(404); // GET does not exist
    expect((await b.json(`/api/v1/attempts/${a.id}/solution`, { method: 'POST', json: {}, origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('predict problems', () => {
  const slug = PROBLEMS.find((p) => p.type === 'predict')!.slug;
  const spec = problemBySlug(slug)!;
  it('makes the first answer final and pays XP on the first complete attempt only', async () => {
    const { actualOutcome } = await import('../../src/problems/predict');
    const v = instantiate(spec);
    const answers = v.questions!.map((q) => ({ id: q.id, right: String(actualOutcome(v.start(v.values), q)), wrong: q.choices.find((c) => c !== actualOutcome(v.start(v.values), q))! }));
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, slug);
    // First attempt: one wrong.
    for (const [i, x] of answers.entries()) {
      const r = await b.json(`/api/v1/attempts/${a.id}/answers`, { json: { questionId: x.id, choice: i === 0 ? x.wrong : x.right } });
      expect(r.status).toBe(200);
      expect(r.body.answer.explanation.length).toBeGreaterThan(0);
    }
    const dup = await b.json(`/api/v1/attempts/${a.id}/answers`, { json: { questionId: answers[0].id, choice: answers[0].right } });
    expect(dup.status).toBe(409);
    let me = await b.json('/api/v1/me');
    expect(me.body.progress[slug]).toMatchObject({ solved: false, xp: 0 });
    const firstTry = (answers.length - 1) / answers.length;
    expect(me.body.progress[slug].firstTry).toBeCloseTo(firstTry);
    // Second attempt, all right: solved, but XP is paid on the first attempt's share.
    const a2 = await start(b, slug);
    for (const x of answers) await b.json(`/api/v1/attempts/${a2.id}/answers`, { json: { questionId: x.id, choice: x.right } });
    me = await b.json('/api/v1/me');
    expect(me.body.progress[slug]).toMatchObject({ solved: true, xp: problemXp({ difficulty: spec.difficulty, best: firstTry, solutionFirst: false }) });
    expect(me.body.progress[slug].firstTry).toBeCloseTo(firstTry);
  });

  it('refuses choices that are not offered and a network Submit', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = await start(b, slug);
    const q = spec.questions![0];
    expect((await b.json(`/api/v1/attempts/${a.id}/answers`, { json: { questionId: q.id, choice: 'teleported' } })).status).toBe(400);
    expect((await submit(b, a.id, net('first-ping', null))).status).toBe(400);
  });
});

describe('the browser and the judge agree', () => {
  it('on every reference and wrong network of every problem', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    for (const spec of PROBLEMS.filter((p) => p.type !== 'predict')) {
      const a = await start(b, spec.slug);
      const v = instantiate(spec, a.seed ?? undefined);
      for (const build of [v.reference, ...v.wrong]) {
        h.clock.now += 7_000; // stay under the submit rate limit
        const topology = build(v.values);
        const local = grade(topology, v, { scope: 'submit', seed: a.seed ?? undefined });
        const r = await submit(b, a.id, serialize({ topology, layout: {} }));
        expect(r.status, `${spec.slug}: ${JSON.stringify(r.body)}`).toBe(200);
        expect([r.body.report.score, r.body.report.max], spec.slug).toEqual([local.score, local.max]);
        expect(r.body.report.tests.map((t: { pass: boolean }) => t.pass), spec.slug).toEqual(local.tests.map((t) => t.pass));
        expect(solved(local), spec.slug).toBe(build === v.reference);
      }
    }
  }, 120_000);
});
