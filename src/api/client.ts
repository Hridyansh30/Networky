// Talking to the Networky API (server/). Same origin, cookie session, JSON.
//
// The app works without it: if the API cannot be reached (offline, a static
// preview with no server, a local `vite preview`), the account store falls
// back to guest mode and everything is saved in this browser, as in phase 5.

import { ENGINE_VERSION } from '../grading/grade';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Listener = (serverEngine: string) => void;
const engineListeners = new Set<Listener>();

/** Called when the server grades with a different engine than this tab's bundle. */
export function onEngineMismatch(l: Listener): () => void {
  engineListeners.add(l);
  return () => engineListeners.delete(l);
}

const authListeners = new Set<() => void>();

/** Called when the server says the session is gone (expired, or signed out in another tab). */
export function onSignedOut(l: () => void): () => void {
  authListeners.add(l);
  return () => authListeners.delete(l);
}

export const API = '/api/v1';

export async function api<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Could not reach the Networky server. Check your connection.');
  }
  const engine = res.headers.get('X-Engine-Version');
  if (engine && engine !== ENGINE_VERSION) for (const l of engineListeners) l(engine);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // A static host answering /api/* with index.html: there is no API here.
      throw new ApiError(res.status || 0, 'no_api', 'This copy of Networky has no server.');
    }
  }
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string };
    if (res.status === 401) for (const l of authListeners) l();
    throw new ApiError(res.status, e.error ?? 'error', e.message ?? `The server answered ${res.status}.`);
  }
  return data as T;
}

/** A random UUID for a submission, so a retried request is recognised by the server. */
export const newSubmissionId = () => crypto.randomUUID();

/** Where the sign-in button goes: GitHub, then back to this page. */
export const signInUrl = (returnTo: string = `/${location.hash}`) => `${API}/auth/github/start?return=${encodeURIComponent(returnTo)}`;
