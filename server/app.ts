// The API: one Hono app under /api/v1, the same code on Cloudflare (worker.ts)
// and on Node (devHandler.ts for `npm run dev`, and the tests). Hono was chosen because it runs unchanged on
// Workers, Node and Deno, which keeps the hosting decision reversible.

import '../src/zodConfig'; // Workers forbid eval, like our CSP: zod must not probe for it
import { Hono } from 'hono';
import { authRoutes, loadSession, sameOrigin } from './auth';
import type { AppEnv, Deps } from './env';
import { ApiError } from './http';
import { importRoutes } from './routes/import';
import { problemRoutes } from './routes/problems';
import { siteRoutes } from './routes/site';
import { ENGINE_VERSION } from '../src/grading/grade';

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>().basePath('/api/v1');

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
    // API answers are personal unless a route says otherwise.
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
    c.header('X-Engine-Version', ENGINE_VERSION);
    c.header('X-Content-Type-Options', 'nosniff');
  });
  app.use('*', sameOrigin);
  app.use('*', loadSession);

  app.route('/auth', authRoutes);
  app.route('/', siteRoutes);
  app.route('/', problemRoutes);
  app.route('/', importRoutes);

  app.notFound((c) => c.json({ error: 'not_found', message: 'No such API route.' }, 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.code, message: err.message }, err.status);
    // Never echo internals to the client; the platform's logs keep the stack.
    console.error(err);
    return c.json({ error: 'internal', message: 'Something went wrong on the server.' }, 500);
  });
  return app;
}

export type App = ReturnType<typeof createApp>;
