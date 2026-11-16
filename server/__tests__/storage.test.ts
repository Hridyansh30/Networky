// What the judge keeps, so the free plan's 500 MB database lasts.
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/model/serialize';
import { problemBySlug } from '../../src/problems/catalog';
import { instantiate } from '../../src/problems/params';
import { harness, type Browser, type Harness } from './harness';

const v = () => instantiate(problemBySlug('first-ping')!);
const good = () => serialize({ topology: v().reference(v().values), layout: {} });
const bad = () => serialize({ topology: v().start({}), layout: {} });
const submit = (b: Browser, attempt: string, network: string) => b.json(`/api/v1/attempts/${attempt}/submissions`, { json: { submissionId: crypto.randomUUID(), network } });
const kept = async (h: Harness) =>
  (await h.db.prepare('SELECT passed, network IS NOT NULL AS kept, network_hash IS NOT NULL AS hashed FROM submissions ORDER BY created_at, rowid').all<{ passed: number; kept: number; hashed: number }>()).results.map((r) => `${r.passed ? 'pass' : 'fail'}:${r.kept ? 'kept' : 'dropped'}:${r.hashed ? 'hash' : 'nohash'}`);

describe('stored networks', () => {
  it('keeps the latest failing network until a pass, then only the newest passing one; hashes stay', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('ada');
    const a = (await b.json('/api/v1/problems/first-ping/attempts', { json: {} })).body.attempt.id;
    await submit(b, a, bad());
    h.clock.now += 1000;
    await submit(b, a, bad());
    expect(await kept(h)).toEqual(['fail:dropped:hash', 'fail:kept:hash']);
    h.clock.now += 1000;
    await submit(b, a, good());
    expect(await kept(h)).toEqual(['fail:dropped:hash', 'fail:dropped:hash', 'pass:kept:hash']);
    h.clock.now += 1000;
    await submit(b, a, good());
    expect(await kept(h)).toEqual(['fail:dropped:hash', 'fail:dropped:hash', 'pass:dropped:hash', 'pass:kept:hash']);
    // The solve itself is unaffected.
    expect((await b.json('/api/v1/me')).body.stats.solved).toBe(1);
  });

  it("starting over drops the old attempt's draft", async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('ada');
    const a = (await b.json('/api/v1/problems/first-ping/attempts', { json: {} })).body.attempt.id;
    await b.json(`/api/v1/attempts/${a}/network`, { method: 'PUT', json: { network: bad() } });
    await b.json('/api/v1/problems/first-ping/attempts', { json: {} });
    const rows = (await h.db.prepare('SELECT active, network IS NOT NULL AS has FROM attempts ORDER BY created_at, rowid').all<{ active: number; has: number }>()).results;
    expect(rows).toEqual([
      { active: 0, has: 0 },
      { active: 1, has: 0 },
    ]);
  });
});
