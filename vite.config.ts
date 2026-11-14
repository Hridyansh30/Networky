import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for the production build.
 *
 * The app talks to one server, its own (/api, same origin, phase 6), and
 * loads nothing from a CDN; fonts are bundled. So the policy allows only
 * same-origin scripts, styles, fonts, images and requests. Even if an
 * attacker got text into the page, the browser would refuse to run an inline
 * <script> or send data to any other host (connect-src 'self').
 *
 * The one outside host: GitHub's avatar CDN, for profile pictures. Images
 * cannot run code, and the leaderboard sends no referrer with them.
 *
 * 'unsafe-inline' for STYLES only: React Flow positions nodes with inline
 * style attributes. Inline styles cannot run code.
 *
 * Added at build time only, because Vite's dev server injects an inline
 * script for hot reload that a strict policy would (correctly) block.
 * Note: frame-ancestors is ignored in a <meta> tag; set it as an HTTP header
 * when deploying (see README).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Development only: serves the API (server/) from the Vite dev server itself,
 * so `npm run dev` runs app and API on one origin, as in production. Vite
 * compiles server/devHandler.ts on demand; production uses dist/_worker.js.
 */
function devApi(): Plugin {
  return {
    name: 'networky-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const origin = `http://${req.headers.host ?? 'localhost:5173'}`;
        server
          .ssrLoadModule('/server/devHandler.ts')
          .then((m) => m.handle(req, res, origin))
          .catch((e: unknown) => {
            server.config.logger.error(String(e));
            res.statusCode = 500;
            res.end('API error (see the dev server log)');
          });
      });
    },
  };
}

function csp(): Plugin {
  return {
    name: 'networky-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig({
  plugins: [react(), csp(), devApi()],
  base: './', // relative asset paths: the build works from any folder or host
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
    // The default 5 s is a guard against hangs, not a speed target. UI tests
    // that render the 30-row Problems page take about 0.3 s alone but several
    // seconds on a busy laptop running every file in parallel.
    testTimeout: 30_000,
    setupFiles: ['src/test/setup.ts'],
  },
});
