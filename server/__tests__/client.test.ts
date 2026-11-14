// The real client (account store + problem store) against the real API, in
// one process: global fetch is routed into the Hono app with a cookie jar.
// This is the test that would catch the two halves drifting apart.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deserialize, serialize } from '../../src/model/serialize';
import { PROBLEMS, problemBySlug } from '../../src/problems/catalog';
import { learnerStats } from '../../src/problems/stats';
import { resetAccountStore, useAccountStore } from '../../src/store/accountStore';
import { resetProblemStore, useProblemStore } from '../../src/store/problemStore';
import { useProjectStore } from '../../src/store/projectStore';
import { useTopologyStore } from '../../src/store/topologyStore';
import { emptyProgress, MemoryProgress } from '../../src/storage/progressRepository';
import { harness, type Browser, type Harness } from './harness';

let h: Harness;
let b: Browser;
let local: MemoryProgress;
const ps = () => useProblemStore.getState();
const acc = () => useAccountStore.getState();

/** Puts the problem's reference network on the canvas, as a learner who solved it would. */
function buildReference() {
  const v = ps().variant!;
  useTopologyStore.getState().apply(() => ({ topology: v.reference(v.values), layout: useTopologyStore.getState().layout }));
}

beforeEach(async () => {
  h = harness();
  b = h.browser();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return b.req(url.startsWith('/') ? url : new URL(url).pathname, init as never);
  });
  local = new MemoryProgress();
  resetProblemStore(local);
  resetAccountStore();
  useProjectStore.getState().newProject();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client against the API', () => {
  it('a guest stays in browser mode, and sees which sign-in the server offers', async () => {
    await acc().load();
    expect(acc().status).toBe('guest');
    expect(acc().meta?.signIn).toEqual({ github: false, dev: true });
    expect(ps().remote).toBe(false);
  });

  it('no server at all: unavailable, browser mode, nothing breaks', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<!doctype html><title>static host</title>', { status: 200, headers: { 'Content-Type': 'text/html' } })));
    await acc().load();
    expect(acc().status).toBe('unavailable');
    expect(ps().remote).toBe(false);
    expect(await ps().open('first-ping')).toBe(true);
  });

  it('signed in: open, submit, and the server records the solve; local storage is untouched', async () => {
    await acc().devSignIn('ada');
    expect(acc().status).toBe('signed-in');
    expect(ps().remote).toBe(true);

    expect(await ps().open('first-ping')).toBe(true);
    expect(ps().attemptId).toMatch(/^[0-9a-f]{32}$/);
    await ps().submit();
    expect(ps().progress['first-ping'].solved).toBe(false);
    expect(ps().progress['first-ping'].failedSubmits).toBe(1);

    buildReference();
    await ps().submit();
    expect(ps().report?.score).toBe(ps().report?.max);
    expect(ps().progress['first-ping'].solved).toBe(true);
    expect(await local.all()).toEqual([]); // the account, not the browser, holds it

    // The XP the nav bar computes from the rows equals the server's own.
    await acc().refresh();
    expect(learnerStats(ps().progress, PROBLEMS).xp).toBe(acc().me!.stats!.xp);
    expect(acc().me!.stats!.xp).toBe(10);
  });

  it('hints are paid for on the server, and a fresh device sees them', async () => {
    await acc().devSignIn('bo');
    await ps().open('first-ping');
    const req = ps().variant!.requirements[0].id;
    await ps().unlockHint(req);
    expect(ps().progress['first-ping'].hints[req]).toBe(1);
    ps().close();

    // "Another device": a fresh client, same account.
    resetProblemStore(new MemoryProgress());
    resetAccountStore();
    await acc().load();
    await ps().open('first-ping');
    expect(ps().progress['first-ping'].hints[req]).toBe(1);
  });

  it('the draft network is saved to the account on flush and comes back', async () => {
    await acc().devSignIn('cy');
    await ps().open('first-ping');
    buildReference();
    const mine = serialize({ topology: useTopologyStore.getState().topology, layout: useTopologyStore.getState().layout });
    await ps().flush();
    ps().close();
    resetProblemStore(new MemoryProgress());
    resetAccountStore();
    await acc().load();
    await ps().open('first-ping');
    // Same network (key order may differ after the round trip through the canvas).
    expect(deserialize(ps().progress['first-ping'].attempt!).topology).toEqual(deserialize(mine).topology);
  });

  it('randomized problems: the server picks the variant, and restart draws a new one', async () => {
    const slug = PROBLEMS.find((p) => p.params)!.slug;
    await acc().devSignIn('di');
    await ps().open(slug);
    const first = ps().variant!.seed;
    expect(first).toBeTypeOf('number');
    const row = await h.db.prepare('SELECT seed FROM attempts WHERE id = ?').bind(ps().attemptId!).first<{ seed: number }>();
    expect(row!.seed).toBe(first);
    await ps().restart();
    expect(ps().variant!.seed).not.toBe(first);
  });

  it('predict problems: answers are judged by the server', async () => {
    const spec = PROBLEMS.find((p) => p.type === 'predict')!;
    await acc().devSignIn('ed');
    await ps().open(spec.slug);
    const v = ps().variant!;
    for (const q of v.questions!) await ps().answer(q.id, q.choices[0]);
    const p = ps().progress[spec.slug];
    expect(Object.keys(p.answers!)).toHaveLength(v.questions!.length);
    expect(Object.keys(ps().outcomes)).toHaveLength(v.questions!.length);
    expect(p.submits).toBe(1);
  });

  it('import: browser progress is re-graded, and only a passing network counts', async () => {
    const good = problemBySlug('first-ping')!;
    await local.put({ ...emptyProgress('first-ping', good.version), solved: true, best: 1, submits: 1, attempt: serialize({ topology: good.reference({}), layout: {} }) });
    const liar = PROBLEMS.find((p) => !p.params && p.type !== 'predict' && p.slug !== 'first-ping')!;
    await local.put({ ...emptyProgress(liar.slug, liar.version), solved: true, best: 1, submits: 1, attempt: serialize({ topology: liar.start({}), layout: {} }) });

    await acc().devSignIn('fay');
    expect(acc().me!.importedAt).toBeNull();
    for (const row of await local.all()) await b.json(`/api/v1/import/${row.slug}`, { json: { row } });
    await b.json('/api/v1/import/done', { json: {} });
    await acc().refresh();
    expect(acc().me!.importedAt).not.toBeNull();
    expect(ps().progress['first-ping'].solved).toBe(true);
    expect(ps().progress[liar.slug]?.solved ?? false).toBe(false);
  });

  it('sign out goes back to the progress saved in this browser', async () => {
    await local.put({ ...emptyProgress('first-ping', 1), solved: true, best: 1 });
    await acc().devSignIn('gil');
    expect(ps().progress['first-ping']?.solved ?? false).toBe(false);
    await acc().signOut();
    expect(acc().status).toBe('guest');
    expect(ps().remote).toBe(false);
    expect(ps().progress['first-ping'].solved).toBe(true);
  });
});

describe('client when the session ends', () => {
  it('a 401 drops to guest mode with the browser progress', async () => {
    await acc().devSignIn('hal');
    expect(ps().remote).toBe(true);
    await h.db.prepare('DELETE FROM sessions').run();
    expect(await ps().open('first-ping')).toBe(true); // falls back to this browser
    expect(acc().status).toBe('guest');
    expect(ps().remote).toBe(false);
    expect(ps().error).toBeNull();
  });
});
