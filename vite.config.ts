import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for the production build.
 *
 * The app needs no network access at all: no CDN, no API, fonts are bundled.
 * So the policy allows only same-origin scripts, styles, fonts and images.
 * Even if an attacker got text into the page, the browser would refuse to run
 * an inline <script> or send data anywhere (connect-src 'none').
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
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'networky-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig({
  plugins: [react(), csp()],
  base: './', // relative asset paths: the build works from any folder or host
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
