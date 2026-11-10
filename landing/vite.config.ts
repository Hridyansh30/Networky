import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { DEV_WORKSPACE_URL, escapeAttribute, parsePublicUrl, parseWorkspaceUrl, socialTags } from './src/workspaceUrl';

/**
 * Content-Security-Policy for the production build, same idea as the
 * workspace's: everything is bundled, so only same-origin files are allowed.
 * No 'unsafe-inline' at all here. GSAP animates through element.style
 * (the CSSOM), which a CSP does not block; only inline <style> blocks and
 * style="" attributes in markup would need it, and the page has none.
 * frame-ancestors only works as an HTTP header: see README.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const PLACEHOLDER = /__WORKSPACE_URL__/g;

/**
 * Bakes the workspace address into index.html at build time.
 * A build with a missing or unsafe VITE_WORKSPACE_URL fails instead of
 * shipping buttons that go nowhere. The dev server falls back to the
 * workspace's local dev server and only warns.
 */
function workspaceLinks(raw: string | undefined, command: 'build' | 'serve'): Plugin {
  const result = parseWorkspaceUrl(raw);
  let url: string;
  if (result.ok) {
    url = result.url;
  } else if (command === 'serve') {
    console.warn(`[networky-landing] ${result.reason}; using ${DEV_WORKSPACE_URL}`);
    url = DEV_WORKSPACE_URL;
  } else {
    throw new Error(`[networky-landing] ${result.reason}. Set it in the deploy settings or in .env.production.local.`);
  }
  return {
    name: 'networky-workspace-links',
    transformIndexHtml: (html) => html.replace(PLACEHOLDER, escapeAttribute(url)),
  };
}

/**
 * Adds the link-preview tags (og:image and friends) when VITE_SITE_URL says
 * where this page is deployed. Unset: the tags are skipped with a warning,
 * because a relative og:image is ignored by most crawlers anyway.
 * Set but invalid: the build fails, like the workspace URL.
 */
function socialPreview(raw: string | undefined, command: 'build' | 'serve'): Plugin {
  let tags = '';
  if (raw?.trim()) {
    const result = parsePublicUrl('VITE_SITE_URL', raw);
    if (!result.ok) {
      if (command === 'build') throw new Error(`[networky-landing] ${result.reason}`);
      console.warn(`[networky-landing] ${result.reason}; link previews are off`);
    } else {
      tags = socialTags(result.url);
    }
  } else if (command === 'build') {
    console.warn('[networky-landing] VITE_SITE_URL is not set; link previews (og:image) are left out');
  }
  return {
    name: 'networky-social-preview',
    transformIndexHtml: (html) => html.replace('<!-- social-preview -->', tags),
  };
}

function csp(): Plugin {
  return {
    name: 'networky-landing-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [workspaceLinks(env.VITE_WORKSPACE_URL, command), socialPreview(env.VITE_SITE_URL, command), csp()],
    base: './',
    server: { port: 5174, strictPort: true }, // the workspace dev server owns 5173
    preview: { port: 4174, strictPort: true },
    test: { include: ['src/**/*.test.ts'] },
  };
});
