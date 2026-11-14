// Accounts and sessions.
//
// Sign-in is GitHub OAuth (authorization code flow with state and PKCE). The
// browser then holds an opaque random token in a cookie; the database holds
// only its SHA-256. Why not a JWT: a session must be revocable now (logout,
// a ban), and checking a row is one indexed read we pay anyway.
//
// Cookie: __Host-session, HttpOnly (no script can read it, so an XSS cannot
// steal it), Secure, SameSite=Lax (not sent on cross-site POSTs), Path=/.
// The __Host- prefix makes the browser refuse it unless it is Secure with
// Path=/ and no Domain, so a subdomain cannot overwrite it.

import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, SessionUser } from './env';
import { ApiError, newId, readJson, safeEqual, sha256Base64Url, sha256Hex, toBase64Url } from './http';

export const SESSION_DAYS = 30;
const DAY = 86_400_000;
const OAUTH_COOKIE_MAX_AGE = 600; // seconds: the sign-in must finish within 10 minutes

const sessionCookie = { prefix: 'host', httpOnly: true, secure: true, sameSite: 'Lax', path: '/' } as const;

// ------------------------------------------------------------------ sessions

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = toBase64Url(c.var.deps.randomBytes(32));
  const now = c.var.deps.now();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * DAY)
    .run();
  setCookie(c, 'session', token, { ...sessionCookie, maxAge: SESSION_DAYS * 86_400 });
}

/** Middleware: sets c.var.user when a valid session cookie is present. Never rejects. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, 'session', 'host');
  if (token && token.length <= 64) {
    const tokenHash = await sha256Hex(token);
    const now = c.var.deps.now();
    const row = await c.env.DB.prepare(
      `SELECT u.id, u.handle, u.display_name, u.avatar_url, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND u.banned_at IS NULL`,
    )
      .bind(tokenHash, now)
      .first<{ id: string; handle: string; display_name: string; avatar_url: string | null; expires_at: number }>();
    if (row) {
      c.set('user', { id: row.id, handle: row.handle, displayName: row.display_name, avatarUrl: row.avatar_url, tokenHash });
      // Sliding expiry, written at most once a day per session.
      if (row.expires_at - now < (SESSION_DAYS - 1) * DAY) {
        await c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_DAYS * DAY, tokenHash).run();
        setCookie(c, 'session', token, { ...sessionCookie, maxAge: SESSION_DAYS * 86_400 });
      }
    }
  }
  await next();
};

/** The signed-in user, or a 401. */
export function requireUser(c: Context<AppEnv>): SessionUser {
  const u = c.var.user;
  if (!u) throw new ApiError(401, 'signed_out', 'Sign in to do this.');
  return u;
}

/**
 * Middleware: every request that changes something must come from our own
 * pages. SameSite=Lax already keeps the cookie off cross-site POSTs; this is
 * the second lock, and it also covers browsers with odd cookie behaviour.
 */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('Origin');
    if (!origin || origin !== appOrigin(c)) throw new ApiError(403, 'cross_origin', 'Requests that change data must come from Networky itself.');
  }
  await next();
};

export const appOrigin = (c: Context<AppEnv>) => c.env.APP_ORIGIN ?? new URL(c.req.url).origin;

// ------------------------------------------------------------------- users

/** The handle a new user gets: their GitHub login, made unique. */
async function freeHandle(c: Context<AppEnv>, wanted: string): Promise<string> {
  const base = wanted.replace(/[^A-Za-z0-9-]/g, '').slice(0, 32) || 'learner';
  for (let i = 1; i < 100; i++) {
    const h = i === 1 ? base : `${base}-${i}`;
    const taken = await c.env.DB.prepare('SELECT 1 FROM users WHERE handle = ?').bind(h).first();
    if (!taken) return h;
  }
  return `${base}-${newId(c).slice(0, 8)}`;
}

interface Profile {
  provider: 'github' | 'dev';
  providerUserId: string;
  login: string;
  name: string;
  avatarUrl: string | null;
}

/** Finds the user behind an identity, creating both on first sign-in. */
export async function upsertUser(c: Context<AppEnv>, p: Profile): Promise<string> {
  const db = c.env.DB;
  const found = await db.prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_user_id = ?').bind(p.provider, p.providerUserId).first<{ user_id: string }>();
  if (found) {
    // Keep the avatar fresh; the handle stays what the user has.
    await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(p.avatarUrl, found.user_id).run();
    return found.user_id;
  }
  const id = newId(c);
  const now = c.var.deps.now();
  const handle = await freeHandle(c, p.login);
  await db.batch([
    db.prepare('INSERT INTO users (id, handle, display_name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, handle, (p.name || p.login).slice(0, 64), p.avatarUrl, now),
    db.prepare('INSERT INTO identities (provider, provider_user_id, user_id, created_at) VALUES (?, ?, ?, ?)').bind(p.provider, p.providerUserId, id, now),
    db.prepare('INSERT INTO user_stats (user_id, xp, xp_reached_at) VALUES (?, 0, ?)').bind(id, now),
  ]);
  return id;
}

// ------------------------------------------------------------------- OAuth

/** Only paths on this site, never another origin (`//evil.com` or `https://...`). */
export function safeReturnPath(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.length > 512) return '/';
  return raw;
}

const githubUser = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(64),
  name: z.string().max(256).nullable().optional(),
  avatar_url: z.string().url().max(512).nullable().optional(),
});

export const authRoutes = new Hono<AppEnv>()
  .get('/github/start', async (c) => {
    if (!c.env.GITHUB_CLIENT_ID) throw new ApiError(503, 'not_configured', 'GitHub sign-in is not configured on this server.');
    const state = toBase64Url(c.var.deps.randomBytes(24));
    const verifier = toBase64Url(c.var.deps.randomBytes(32));
    const back = toBase64Url(new TextEncoder().encode(safeReturnPath(c.req.query('return'))));
    setCookie(c, 'oauth', `${state}.${verifier}.${back}`, { ...sessionCookie, maxAge: OAUTH_COOKIE_MAX_AGE });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
    url.searchParams.set('redirect_uri', `${appOrigin(c)}/api/v1/auth/github/callback`);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', await sha256Base64Url(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('allow_signup', 'true');
    // No scope: the public profile (id, login, name, avatar) is all we read.
    return c.redirect(url.toString(), 302);
  })

  .get('/github/callback', async (c) => {
    const saved = getCookie(c, 'oauth', 'host') ?? '';
    deleteCookie(c, 'oauth', { ...sessionCookie });
    const [state, verifier, back] = saved.split('.');
    const code = c.req.query('code');
    const given = c.req.query('state') ?? '';
    // A missing or different state means this callback was not started by
    // this browser: an attacker trying to log the victim into the attacker's
    // account ("login CSRF"). Refuse it.
    if (!state || !verifier || !code || !safeEqual(state, given)) return c.redirect('/#/signin-failed', 302);
    if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) throw new ApiError(503, 'not_configured', 'GitHub sign-in is not configured on this server.');

    const tokenRes = await c.var.deps.fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${appOrigin(c)}/api/v1/auth/github/callback`,
        code_verifier: verifier,
      }),
    });
    const token = z.object({ access_token: z.string().min(1).max(512) }).safeParse(await tokenRes.json().catch(() => null));
    if (!tokenRes.ok || !token.success) return c.redirect('/#/signin-failed', 302);

    const userRes = await c.var.deps.fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token.data.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Networky' },
    });
    const gh = githubUser.safeParse(await userRes.json().catch(() => null));
    if (!userRes.ok || !gh.success) return c.redirect('/#/signin-failed', 302);
    // The GitHub token is not stored: we needed it once, to read the profile.

    const userId = await upsertUser(c, {
      provider: 'github',
      providerUserId: String(gh.data.id),
      login: gh.data.login,
      name: gh.data.name ?? gh.data.login,
      // Only GitHub's own avatar host: the page shows it in an <img>, and the CSP allows no other.
      avatarUrl: gh.data.avatar_url?.startsWith('https://avatars.githubusercontent.com/') ? gh.data.avatar_url : null,
    });
    const banned = await c.env.DB.prepare('SELECT banned_at FROM users WHERE id = ?').bind(userId).first<{ banned_at: number | null }>();
    if (banned?.banned_at) return c.redirect('/#/signin-failed', 302);
    await createSession(c, userId);
    let path = '/';
    try {
      path = safeReturnPath(new TextDecoder().decode(Uint8Array.from(atob((back ?? '').replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))));
    } catch {
      path = '/';
    }
    return c.redirect(path, 302);
  })

  .post('/logout', async (c) => {
    const u = c.var.user;
    if (u) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(u.tokenHash).run();
    deleteCookie(c, 'session', { ...sessionCookie });
    return c.body(null, 204);
  })

  // Local development only (see Deps.devLogin): sign in as any handle.
  .post('/dev', async (c) => {
    if (!c.var.deps.devLogin) throw new ApiError(404, 'not_found', 'Not found.');
    const body = await readJson(c, z.object({ handle: z.string().regex(/^[A-Za-z0-9-]{1,32}$/) }).strict(), 1024);
    const userId = await upsertUser(c, { provider: 'dev', providerUserId: body.handle.toLowerCase(), login: body.handle, name: body.handle, avatarUrl: null });
    await createSession(c, userId);
    return c.json({ ok: true });
  });
