// A test harness for the API: a fresh in-memory database, a fake clock, a
// predictable random source, and a tiny browser (cookie jar + Origin header).

import { createApp } from '../app';
import { testDb, type SqliteDb } from '../db/sqlite';
import type { Deps, Env } from '../env';

export const ORIGIN = 'https://networky.test';

export interface Harness {
  db: SqliteDb;
  env: Env;
  clock: { now: number };
  app: ReturnType<typeof createApp>;
  fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  setFetch(f: Harness['fetchMock']): void;
  browser(): Browser;
}

export interface Browser {
  cookies: Map<string, string>;
  req(path: string, init?: RequestInit & { json?: unknown; origin?: string | null }): Promise<Response>;
  json<T = any>(path: string, init?: RequestInit & { json?: unknown; origin?: string | null }): Promise<{ status: number; body: T; res: Response }>;
  signIn(handle: string): Promise<void>;
}

export function harness(opts: { devLogin?: boolean; github?: boolean } = {}): Harness {
  const db = testDb();
  const clock = { now: Date.UTC(2026, 10, 16, 12, 0, 0) }; // a Monday
  let counter = 0;
  let fetchImpl: Harness['fetchMock'] = async () => new Response('no network in tests', { status: 599 });
  const deps: Deps = {
    now: () => clock.now,
    // Predictable but never repeating: tests can rely on ids being unique.
    randomBytes: (n) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = (++counter * 131 + i * 7) & 0xff;
      out[0] = counter & 0xff;
      out[1] = (counter >> 8) & 0xff;
      return out;
    },
    fetch: (input, init) => fetchImpl(input as RequestInfo, init),
    devLogin: opts.devLogin ?? true,
  };
  const env: Env = { DB: db, APP_ORIGIN: ORIGIN, ...(opts.github ? { GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'secret' } : {}) };
  const app = createApp(deps);
  const h: Harness = {
    db,
    env,
    clock,
    app,
    get fetchMock() {
      return fetchImpl;
    },
    setFetch(f) {
      fetchImpl = f;
    },
    browser() {
      const cookies = new Map<string, string>();
      const req: Browser['req'] = async (path, init = {}) => {
        const headers = new Headers(init.headers);
        if (cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
        const method = init.method ?? (init.json !== undefined ? 'POST' : 'GET');
        if (init.origin !== null && method !== 'GET') headers.set('Origin', init.origin ?? ORIGIN);
        let body = init.body;
        if (init.json !== undefined) {
          body = JSON.stringify(init.json);
          headers.set('Content-Type', 'application/json');
        }
        const res = await app.request(`${ORIGIN}${path}`, { ...init, method, headers, body }, env);
        for (const sc of res.headers.getSetCookie()) {
          const [pair, ...attrs] = sc.split(';');
          const [k, v] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
          const gone = attrs.some((a) => /max-age=0/i.test(a.trim())) || v === '';
          if (gone) cookies.delete(k);
          else cookies.set(k, v);
        }
        return res;
      };
      return {
        cookies,
        req,
        async json(path, init) {
          const res = await req(path, init);
          const text = await res.text();
          return { status: res.status, body: text ? JSON.parse(text) : null, res };
        },
        async signIn(handle) {
          const r = await req('/api/v1/auth/dev', { json: { handle } });
          if (r.status !== 200) throw new Error(`dev sign-in failed: ${r.status} ${await r.text()}`);
        },
      };
    },
  };
  return h;
}
