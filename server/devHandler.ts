// The API inside `npm run dev`. vite.config.ts hands every /api/* request of
// the dev server to handle() below, so the app and the API share one origin
// (http://localhost:5173) in development exactly as they do in production.
//
// Same Hono app as production, with two development-only differences:
//   - a SQLite file (.data/dev.sqlite) instead of D1;
//   - POST /api/v1/auth/dev signs in as any handle, so you can work without
//     a GitHub OAuth app. GitHub sign-in also works if GITHUB_CLIENT_ID and
//     GITHUB_CLIENT_SECRET are set in the environment.
//
// Never deployed: server/worker.ts is the production entry.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { createApp } from './app';
import { migrate, SqliteDb } from './db/sqlite';
import { realDeps, type Env } from './env';

let env: Env | undefined;
let app: ReturnType<typeof createApp> | undefined;

async function setup(origin: string) {
  mkdirSync('.data', { recursive: true });
  const db = new SqliteDb('.data/dev.sqlite');
  if (!(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").first())) migrate(db);
  env = { DB: db, GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET, APP_ORIGIN: origin };
  app = createApp({ ...realDeps(), devLogin: true });
}

async function readBody(req: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const all = Buffer.concat(chunks);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
}

export async function handle(req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> {
  if (!app || !env) await setup(origin);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const response = await app!.fetch(new Request(new URL(req.url ?? '/', origin), { method: req.method, headers, body: hasBody ? await readBody(req) : undefined }), env!);
  res.statusCode = response.status;
  response.headers.forEach((v, k) => {
    if (k !== 'set-cookie') res.setHeader(k, v);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
