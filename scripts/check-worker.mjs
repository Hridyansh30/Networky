// Smoke test of the BUILT API (dist/_worker.js), run by CI after `npm run build`.
//
// Unit tests run the server's TypeScript on Node. This checks what actually
// ships: that the bundle loads with no Node built-ins, answers /api/v1/meta,
// hands every other path to the static assets, and has no dev sign-in.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const file = new URL('../dist/_worker.js', import.meta.url);
const code = readFileSync(file, 'utf8');
const fail = (msg) => {
  console.error(`check-worker: ${msg}`);
  process.exit(1);
};

if (/from\s*["']node:|require\(["']node:/.test(code)) fail('the worker imports a Node built-in; Cloudflare will not load it');
if (/\bnew Function\(|\beval\(/.test(code)) fail('the worker uses eval or new Function; Workers forbid both');

const routes = JSON.parse(readFileSync(new URL('../dist/_routes.json', import.meta.url), 'utf8'));
if (JSON.stringify(routes.include) !== '["/api/*"]') fail('_routes.json must send only /api/* to the worker (static files stay free)');

const { default: worker } = await import(pathToFileURL(file.pathname).href);
const env = { DB: { prepare: () => fail('the database was touched on a request that needs none') }, ASSETS: { fetch: async () => new Response('asset') } };
const call = (path, init) => worker.fetch(new Request(`https://networky.test${path}`, init), env, {});

const meta = await call('/api/v1/meta');
const body = await meta.json();
if (meta.status !== 200 || typeof body.engineVersion !== 'string') fail(`/api/v1/meta answered ${meta.status}`);
const bare = await (await worker.fetch(new Request('https://networky.test/api/v1/meta'), { ASSETS: env.ASSETS }, {})).json();
if (bare.ready !== false) fail('/api/v1/meta must report ready: false when the D1 binding is missing');
if ((await (await call('/problems')).text()) !== 'asset') fail('a page path did not go to the static assets');
const dev = await call('/api/v1/auth/dev', { method: 'POST', headers: { Origin: 'https://networky.test', 'Content-Type': 'application/json' }, body: '{"handle":"x"}' });
if (dev.status !== 404) fail(`the dev sign-in answered ${dev.status} in the production build`);

console.log(`check-worker: ok (engine ${body.engineVersion}, ${body.problemCount} problems, content ${body.contentPack}, ${Math.round(code.length / 1024)} KB)`);
