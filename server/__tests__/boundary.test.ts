// What ships to Cloudflare must not depend on Node. Only the dev server, the
// SQLite adapter and tests may.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { problemBySlug } from '../../src/problems/catalog';
import { rebuild } from '../judge';
import { harness } from './harness';

const ROOT = join(import.meta.dirname, '..');
const NODE_ONLY = new Set(['devHandler.ts', 'db/sqlite.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : files(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

describe('server boundaries', () => {
  it('production server code imports no Node built-ins', () => {
    const bad = files(ROOT)
      .filter((f) => !NODE_ONLY.has(relative(ROOT, f)))
      .filter((f) => /from\s+'node:/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(bad).toEqual([]);
  });

  it('the cache rebuild is idempotent: running it again changes nothing', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const a = (await b.json('/api/v1/problems/first-ping/attempts', { method: 'POST', json: {} })).body.attempt;
    const { serialize } = await import('../../src/model/serialize');
    const { instantiate } = await import('../../src/problems/params');
    const v = instantiate(problemBySlug('first-ping')!);
    await b.json(`/api/v1/attempts/${a.id}/submissions`, { json: { submissionId: crypto.randomUUID(), network: serialize({ topology: v.reference(v.values), layout: {} }) } });
    const snapshot = async () =>
      JSON.stringify(await Promise.all(['user_problem', 'user_stats', 'problem_stats', 'xp_events'].map((t) => h.db.prepare(`SELECT * FROM ${t}`).all())));
    const before = await snapshot();
    const userId = (await h.db.prepare('SELECT id FROM users').first<{ id: string }>())!.id;
    await h.db.batch(rebuild(h.db, userId, problemBySlug('first-ping')!, h.clock.now));
    await h.db.batch(rebuild(h.db, userId, problemBySlug('first-ping')!, h.clock.now));
    expect(await snapshot()).toBe(before);
  });
});
