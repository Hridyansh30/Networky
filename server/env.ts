// What the server needs from the outside world, passed in rather than reached
// for. Production gets the real thing (server/worker.ts), tests get fakes.
// The same idea as the core's IdSource: anything that varies between runs
// (time, randomness, the network) is an argument.

import type { Db } from './db/types';

/** Bindings and secrets, as Cloudflare Pages passes them to the worker. */
export interface Env {
  DB: Db;
  /** GitHub OAuth app (Settings > Developer settings > OAuth Apps). */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /**
   * The site's own origin, e.g. https://networky.pages.dev. Used to build the
   * OAuth redirect URI and to check the Origin header. When unset, the
   * request's own origin is used (fine behind Pages, which sets it honestly).
   */
  APP_ORIGIN?: string;
}

export interface Deps {
  /** Milliseconds since 1970, UTC. */
  now(): number;
  /** Cryptographically secure random bytes. */
  randomBytes(n: number): Uint8Array;
  /** Outbound HTTP (GitHub). */
  fetch: typeof fetch;
  /**
   * Local development only: lets /api/v1/auth/dev sign in without GitHub.
   * The production worker never sets it (see worker.ts and its test).
   */
  devLogin?: boolean;
}

export const realDeps = (): Deps => ({
  now: () => Date.now(),
  randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  fetch: (input, init) => fetch(input, init),
});

/** Hono's context variables, set by middleware. */
export interface Vars {
  deps: Deps;
  user?: SessionUser;
}

export interface SessionUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  tokenHash: string;
}

export type AppEnv = { Bindings: Env; Variables: Vars };
