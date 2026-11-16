import { describe, expect, it } from 'vitest';
import { drillKind, PRACTICE_XP_PER_DAY, questionAt, replaySet, SET_SIZE, type Level } from '../../src/drills';
import { DRILL_LIMITS } from '../routes/drills';
import { harness, type Browser, type Harness } from './harness';

/** The right answer to every question, following the levels the rule gives. */
function allRight(kindId: string, seed: number, start: Level): Record<string, string>[] {
  const kind = drillKind(kindId)!;
  const answers: Record<string, string>[] = [];
  for (let i = 0; i < SET_SIZE; i++) {
    const level = replaySet(kind, seed, start, answers).at(i)!.level;
    answers.push({ ...questionAt(kind, seed, i, level).expected });
  }
  return answers;
}

async function playSet(b: Browser, kind = 'subnet-range', level: Level = 1, right = true) {
  const start = await b.json('/api/v1/drills/' + kind + '/sets', { json: { level } });
  expect(start.status).toBe(201);
  const { set } = start.body;
  const answers = right ? allRight(kind, set.seed, level) : Array(SET_SIZE).fill({});
  return (await b.json(`/api/v1/drill-sets/${set.id}/finish`, { json: { answers } })).body;
}

const xpEvents = async (h: Harness, source: string) => (await h.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(delta), 0) AS xp FROM xp_events WHERE source = ?').bind(source).first<{ n: number; xp: number }>())!;

describe('drill practice on the server', () => {
  it('needs a signed-in user', async () => {
    const h = harness();
    expect((await h.browser().json('/api/v1/drills/subnet-range/sets', { json: { level: 1 } })).status).toBe(401);
  });

  it('replays the set from its own seed: all right from level 1 climbs to 3 and earns 1+1+1+2+2+2+3+3+3+3', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('ada');
    const r = await playSet(b);
    expect(r.set.results.map((x: { level: number }) => x.level)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 3]);
    expect(r.set.correct).toBe(10);
    expect(r.set.earned).toBe(21);
    expect(r.set.xp).toBe(21);
    expect(r.practiceToday).toBe(21);
  });

  it('caps practice XP per UTC day, and the cap resets at midnight UTC', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('ada');
    expect((await playSet(b)).set.xp).toBe(21);
    expect((await playSet(b)).set.xp).toBe(PRACTICE_XP_PER_DAY - 21);
    const third = await playSet(b);
    expect(third.set.earned).toBe(21);
    expect(third.set.xp).toBe(0);
    expect(await xpEvents(h, 'drill')).toEqual({ n: 2, xp: PRACTICE_XP_PER_DAY }); // no zero-XP ledger rows
    h.clock.now += 24 * 3600 * 1000;
    expect((await playSet(b)).set.xp).toBe(21);
  });

  it('wrong answers earn nothing, and the level falls', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('ada');
    const r = await playSet(b, 'longest-match', 3, false);
    expect(r.set.xp).toBe(0);
    expect(r.set.results.map((x: { level: number }) => x.level)).toEqual([3, 3, 2, 2, 1, 1, 1, 1, 1, 1]);
  });

  it('a set counts once: a retried finish returns the first result, even with other answers', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('ada');
    const { set } = (await b.json('/api/v1/drills/mask-cidr/sets', { json: { level: 2 } })).body;
    const first = await b.json(`/api/v1/drill-sets/${set.id}/finish`, { json: { answers: allRight('mask-cidr', set.seed, 2) } });
    const again = await b.json(`/api/v1/drill-sets/${set.id}/finish`, { json: { answers: Array(SET_SIZE).fill({}) } });
    expect(again.body.set).toEqual(first.body.set);
    expect((await xpEvents(h, 'drill')).n).toBe(1);
  });

  it('counts on the weekly board, not on the all-time board or the level', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('ada');
    await playSet(b);
    const week = (await b.json('/api/v1/leaderboard?period=week')).body.rows;
    expect(week).toMatchObject([{ handle: 'ada', xp: 21 }]);
    expect((await b.json('/api/v1/leaderboard?period=all')).body.rows).toEqual([]);
    expect((await b.json('/api/v1/me')).body.stats.xp).toBe(0);
  });

  it("refuses someone else's set, an unknown drill, an expired set and a malformed finish", async () => {
    const h = harness();
    const ada = h.browser();
    const bob = h.browser();
    await ada.signIn('ada');
    await bob.signIn('bob');
    const { set } = (await ada.json('/api/v1/drills/same-subnet/sets', { json: { level: 1 } })).body;
    expect((await bob.json(`/api/v1/drill-sets/${set.id}/finish`, { json: { answers: Array(SET_SIZE).fill({}) } })).status).toBe(404);
    expect((await ada.json('/api/v1/drills/nope/sets', { json: { level: 1 } })).status).toBe(404);
    expect((await ada.json('/api/v1/drills/will-it-reach/sets', { json: { level: 1 } })).status).toBe(409);
    expect((await ada.json('/api/v1/drills/same-subnet/sets', { json: { level: 4 } })).status).toBe(400);
    expect((await ada.json(`/api/v1/drill-sets/${set.id}/finish`, { json: { answers: [{}] } })).status).toBe(400);
    expect((await ada.json(`/api/v1/drill-sets/${set.id}/finish`, { json: { answers: Array(SET_SIZE).fill({ choice: 'x'.repeat(65) }) } })).status).toBe(400);
    h.clock.now += DRILL_LIMITS.setLifetimeMs + 1;
    expect((await ada.json(`/api/v1/drill-sets/${set.id}/finish`, { json: { answers: Array(SET_SIZE).fill({}) } })).status).toBe(409);
  });

  it('limits how many sets start in a day', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('ada');
    for (let i = 0; i < DRILL_LIMITS.setsPerDay; i++) expect((await b.json('/api/v1/drills/mac-table/sets', { json: { level: 1 } })).status).toBe(201);
    expect((await b.json('/api/v1/drills/mac-table/sets', { json: { level: 1 } })).status).toBe(429);
  });

  it('reports practice per drill kind', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('ada');
    await playSet(b, 'ipv6-shorten');
    await playSet(b, 'ipv6-shorten', 1, false);
    const p = (await b.json('/api/v1/me/practice')).body;
    expect(p.byKind['ipv6-shorten']).toEqual({ sets: 2, answered: 20, correct: 10, xp: 21 });
    expect(p.practiceToday).toBe(21);
    expect(p.cap).toBe(PRACTICE_XP_PER_DAY);
  });
});
