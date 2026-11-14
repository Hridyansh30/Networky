import { describe, expect, it } from 'vitest';
import { harness, ORIGIN } from './harness';

describe('meta', () => {
  it('reports the engine version in the body and on every response', async () => {
    const h = harness();
    const r = await h.browser().json('/api/v1/meta');
    expect(r.status).toBe(200);
    expect(r.body.engineVersion).toBe('2');
    expect(r.res.headers.get('X-Engine-Version')).toBe('2');
    expect(r.res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers unknown routes with JSON 404', async () => {
    const r = await harness().browser().json('/api/v1/nope');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('not_found');
  });
});

describe('sessions', () => {
  it('signs in, knows who you are, and signs out for real', async () => {
    const h = harness();
    const b = h.browser();
    expect((await b.json('/api/v1/me')).body.user).toBeNull();
    await b.signIn('kavya');
    const me = await b.json('/api/v1/me');
    expect(me.body.user.handle).toBe('kavya');
    expect(me.body.stats.xp).toBe(0);
    // The cookie is __Host- prefixed, HttpOnly, Secure, SameSite=Lax.
    expect([...b.cookies.keys()]).toEqual(['__Host-session']);
    const stolen = b.cookies.get('__Host-session')!;
    expect((await b.req('/api/v1/auth/logout', { method: 'POST' })).status).toBe(204);
    // The old token no longer works, even if someone kept a copy.
    const other = h.browser();
    other.cookies.set('__Host-session', stolen);
    expect((await other.json('/api/v1/me')).body.user).toBeNull();
  });

  it('stores only a hash of the session token', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const token = b.cookies.get('__Host-session')!;
    const rows = await h.db.prepare('SELECT token_hash FROM sessions').all<{ token_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].token_hash).not.toContain(token);
    expect(rows.results[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('expires sessions after 30 idle days and slides while in use', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    h.clock.now += 20 * 86_400_000;
    expect((await b.json('/api/v1/me')).body.user).not.toBeNull(); // slides to day 50
    h.clock.now += 25 * 86_400_000;
    expect((await b.json('/api/v1/me')).body.user).not.toBeNull();
    h.clock.now += 31 * 86_400_000;
    expect((await b.json('/api/v1/me')).body.user).toBeNull();
  });

  it('refuses changes from another origin or with no Origin at all', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('kavya');
    const evil = await b.json('/api/v1/auth/logout', { method: 'POST', origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const none = await b.json('/api/v1/auth/logout', { method: 'POST', origin: null });
    expect(none.status).toBe(403);
    expect((await b.json('/api/v1/me')).body.user).not.toBeNull();
  });

  it('a banned user is signed out everywhere', async () => {
    const h = harness();
    const b = h.browser();
    await b.signIn('troll');
    await h.db.prepare('UPDATE users SET banned_at = 1').run();
    expect((await b.json('/api/v1/me')).body.user).toBeNull();
  });

  it('has no dev sign-in unless the server was started for development', async () => {
    const h = harness({ devLogin: false });
    const r = await h.browser().json('/api/v1/auth/dev', { json: { handle: 'x' } });
    expect(r.status).toBe(404);
  });

  it('gives two people with the same login different handles', async () => {
    const h = harness();
    await h.browser().signIn('Kavya');
    const b = h.browser();
    // A different provider id with a login that differs only in case.
    await h.db.prepare("UPDATE identities SET provider_user_id = 'other' WHERE provider = 'dev'").run();
    await b.signIn('kavya');
    expect((await b.json('/api/v1/me')).body.user.handle).toBe('kavya-2');
  });
});

describe('GitHub sign-in', () => {
  const ghFetch = (id = 4242, login = 'octo') => async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      const form = new URLSearchParams(String(init?.body));
      if (form.get('client_secret') !== 'secret' || !form.get('code_verifier')) return new Response('{}', { status: 400 });
      return Response.json({ access_token: 'gho_test' });
    }
    if (url === 'https://api.github.com/user') return Response.json({ id, login, name: 'Octo Cat', avatar_url: 'https://avatars.githubusercontent.com/u/1' });
    return new Response('unexpected', { status: 500 });
  };

  it('runs the whole flow: state + PKCE, user created, session set, back to the page', async () => {
    const h = harness({ github: true });
    h.setFetch(ghFetch());
    const b = h.browser();
    const start = await b.req('/api/v1/auth/github/start?return=/problems/first-ping');
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get('Location')!);
    expect(to.origin + to.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(to.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/v1/auth/github/callback`);
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    const state = to.searchParams.get('state')!;
    const back = await b.req(`/api/v1/auth/github/callback?code=abc&state=${state}`);
    expect(back.status).toBe(302);
    expect(back.headers.get('Location')).toBe('/problems/first-ping');
    const me = await b.json('/api/v1/me');
    expect(me.body.user).toMatchObject({ handle: 'octo', displayName: 'Octo Cat' });
    // Signing in again finds the same user.
    const again = h.browser();
    const s2 = new URL((await again.req('/api/v1/auth/github/start')).headers.get('Location')!).searchParams.get('state');
    await again.req(`/api/v1/auth/github/callback?code=x&state=${s2}`);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!.n).toBe(1);
  });

  it('keeps an avatar only from GitHub\'s avatar host', async () => {
    const h = harness({ github: true });
    const gh = ghFetch(7, 'mallory');
    h.setFetch(async (input, init) => (String(input) === 'https://api.github.com/user' ? Response.json({ id: 7, login: 'mallory', avatar_url: 'https://evil.example/track.png' }) : gh(input, init)));
    const b = h.browser();
    const state = new URL((await b.req('/api/v1/auth/github/start')).headers.get('Location')!).searchParams.get('state');
    await b.req(`/api/v1/auth/github/callback?code=c&state=${state}`);
    expect((await b.json('/api/v1/me')).body.user).toMatchObject({ handle: 'mallory', avatarUrl: null });
  });

  it('refuses a callback whose state this browser did not start (login CSRF)', async () => {
    const h = harness({ github: true });
    h.setFetch(ghFetch());
    const victim = h.browser();
    await victim.req('/api/v1/auth/github/start');
    const r = await victim.req('/api/v1/auth/github/callback?code=attackers-code&state=attackers-state');
    expect(r.headers.get('Location')).toBe('/#/signin-failed');
    expect((await victim.json('/api/v1/me')).body.user).toBeNull();
    // And a callback with no sign-in started at all.
    const fresh = h.browser();
    expect((await fresh.req('/api/v1/auth/github/callback?code=c&state=s')).headers.get('Location')).toBe('/#/signin-failed');
  });

  it('never redirects to another site after sign-in', async () => {
    const h = harness({ github: true });
    h.setFetch(ghFetch());
    for (const evil of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
      const b = h.browser();
      const s = new URL((await b.req(`/api/v1/auth/github/start?return=${encodeURIComponent(evil)}`)).headers.get('Location')!).searchParams.get('state');
      const r = await b.req(`/api/v1/auth/github/callback?code=c&state=${s}`);
      expect(r.headers.get('Location')).toBe('/');
    }
  });

  it('fails cleanly when GitHub refuses the code', async () => {
    const h = harness({ github: true });
    h.setFetch(async () => new Response('{"error":"bad_verification_code"}', { status: 200 }));
    const b = h.browser();
    const s = new URL((await b.req('/api/v1/auth/github/start')).headers.get('Location')!).searchParams.get('state');
    const r = await b.req(`/api/v1/auth/github/callback?code=c&state=${s}`);
    expect(r.headers.get('Location')).toBe('/#/signin-failed');
    expect((await b.json('/api/v1/me')).body.user).toBeNull();
  });

  it('says so when GitHub sign-in is not configured', async () => {
    const r = await harness().browser().json('/api/v1/auth/github/start');
    expect(r.status).toBe(503);
  });
});
