// The Cloudflare Pages entry ("advanced mode"): the build copies the bundle of
// this file to dist/_worker.js. dist/_routes.json sends only /api/* here, so
// the pages, scripts and images are served as static files that never start
// the worker and never count against the free plan's 100,000 requests a day.

import { createApp } from './app';
import { realDeps, type Env } from './env';
import { grade } from '../src/grading/grade';
import { problemBySlug } from '../src/problems/catalog';
import { instantiate } from '../src/problems/params';

/**
 * Warm-up, at module load. The first grade in a fresh isolate costs 6 to
 * 16 ms while V8 compiles the engine; later grades take 1 to 3 ms. The free
 * plan allows 10 ms of CPU per request but gives the script's top level its
 * own 1 s startup budget, so we pay the compile cost here, once per isolate,
 * instead of inside someone's Submit.
 */
function warmUp() {
  const spec = problemBySlug('first-ping');
  if (!spec) return;
  const v = instantiate(spec);
  grade(v.reference(v.values), v);
}
warmUp();

const app = createApp(realDeps()); // devLogin is never set here: no dev sign-in in production

interface PagesEnv extends Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export default {
  fetch(req: Request, env: PagesEnv, ctx: unknown): Response | Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/api/')) return app.fetch(req, env, ctx as never);
    return env.ASSETS.fetch(req);
  },
};
