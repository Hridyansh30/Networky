// The landing page and the workspace are two separate deploys, so the landing
// page has to be told where the workspace lives. That address comes from the
// VITE_WORKSPACE_URL environment variable and is baked into the HTML at build
// time (see vite.config.ts).
//
// It ends up inside href="...", so it is checked here first:
//   - it must parse as an absolute URL
//   - it must be https, or http on localhost (the dev server)
//     A 'javascript:' URL would otherwise run code when someone clicks the
//     button, and plain http in production can be tampered with on the way.
//   - no username or password inside the URL
// The result is HTML-escaped by escapeAttribute() before it is inserted.

export const DEV_WORKSPACE_URL = 'http://localhost:5173/';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type WorkspaceUrlResult = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Checks an absolute public URL from the environment. `name` is the variable
 * name, used only in the error message.
 */
export function parsePublicUrl(name: string, raw: string | undefined): WorkspaceUrlResult {
  const value = raw?.trim();
  if (!value) return { ok: false, reason: `${name} is not set` };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: `${name} is not an absolute URL: "${value}"` };
  }

  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { ok: false, reason: `${name} must use https (http is only allowed on localhost): "${value}"` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: `${name} must not contain a username or password` };
  }
  return { ok: true, url: url.href };
}

export function parseWorkspaceUrl(raw: string | undefined): WorkspaceUrlResult {
  return parsePublicUrl('VITE_WORKSPACE_URL', raw);
}

/**
 * Link previews (og:image, og:url) must be absolute URLs, so they need to
 * know where the landing page itself is deployed: VITE_SITE_URL. It is
 * optional. Without it the preview tags are left out instead of guessed.
 * The image path is resolved against the site URL, so a site under a
 * sub-folder (https://x.github.io/networky/) still gets the right address.
 */
export function socialTags(siteUrl: string): string {
  const image = new URL('og-image.png', siteUrl).href;
  return [
    `<meta property="og:url" content="${escapeAttribute(siteUrl)}" />`,
    `<meta property="og:image" content="${escapeAttribute(image)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="Networky: a router, two switches and four hosts with packets moving between them" />',
    '<meta name="twitter:card" content="summary_large_image" />',
  ].join('\n    ');
}

/** Escape a string for use inside a double-quoted HTML attribute. */
export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
