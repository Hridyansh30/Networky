// Who is signed in, and whether this copy of Networky has a server at all.
//
// The app never needs the server to work. If /api is missing (a static
// preview, `vite preview`, offline), the status is 'unavailable', no sign-in
// button is shown, and progress stays in this browser exactly as in phase 5.

import { create } from 'zustand';
import { api, ApiError, onEngineMismatch, onSignedOut, signInUrl } from '../api/client';
import type { Me } from '../api/types';
import { ENGINE_VERSION } from '../grading/grade';
import { useProblemStore } from './problemStore';
import { useTopologyStore } from './topologyStore';

export type AccountStatus = 'loading' | 'unavailable' | 'guest' | 'signed-in';

interface Meta {
  engineVersion: string;
  problemCount: number;
  ready: boolean;
  signIn: { github: boolean; dev: boolean };
}

interface AccountState {
  status: AccountStatus;
  me: Me | null;
  meta: Meta | null;
  /** The server grades with another engine version: this tab must reload. */
  staleEngine: string | null;
  load(): Promise<void>;
  /** Re-reads stats and rank (after a solve). */
  refresh(): Promise<void>;
  signIn(): void;
  /** Local development only: sign in as any handle without GitHub. */
  devSignIn(handle: string): Promise<void>;
  signOut(): Promise<void>;
}

let loading: Promise<void> | null = null;

export const useAccountStore = create<AccountState>()((set, get) => ({
  status: 'loading',
  me: null,
  meta: null,
  staleEngine: null,

  load() {
    // The sign-in callback sends a failed sign-in back here (server/auth.ts).
    if (typeof location !== 'undefined' && location.hash === '#/signin-failed') {
      history.replaceState(null, '', '#/');
      useTopologyStore.getState().notify('Sign-in did not complete. Please try again.', 'error');
    }
    loading ??= (async () => {
      try {
        const meta = await api<Meta>('GET', '/meta');
        if (meta.engineVersion !== ENGINE_VERSION) set({ staleEngine: meta.engineVersion });
        // Deployed but not set up yet (no database): behave as if there were no server.
        if (!meta.ready) throw new ApiError(503, 'not_ready', 'The server has no database yet.');
        set({ meta });
        await get().refresh();
      } catch (e) {
        // No server here (or it is down): stay a guest in this browser.
        set({ status: 'unavailable', meta: null });
        if (e instanceof ApiError && e.status >= 500) console.warn('Networky server error, progress stays in this browser:', e.message);
        await useProblemStore.getState().useServer(null);
      }
    })();
    return loading;
  },

  async refresh() {
    const me = await api<Me>('GET', '/me');
    const signedIn = !!me.user;
    set({ me, status: signedIn ? 'signed-in' : 'guest' });
    await useProblemStore.getState().useServer(signedIn ? (me.progress ?? {}) : null);
  },

  signIn() {
    location.assign(signInUrl());
  },

  async devSignIn(handle) {
    await api('POST', '/auth/dev', { handle });
    await get().refresh();
  },

  async signOut() {
    await useProblemStore.getState().flush();
    try {
      await api('POST', '/auth/logout');
    } finally {
      set({ me: null, status: 'guest' });
      await useProblemStore.getState().useServer(null);
    }
  },
}));

onEngineMismatch((v) => useAccountStore.setState({ staleEngine: v }));
// The session ended under us: drop to guest mode, the browser's own progress.
onSignedOut(() => {
  if (useAccountStore.getState().status !== 'signed-in') return;
  useAccountStore.setState({ status: 'guest', me: null });
  useTopologyStore.getState().notify('You were signed out. Sign in again to keep saving to your account.', 'info');
  // Synchronously, so the request that failed can fall back to this browser at once.
  useProblemStore.setState({ remote: false, attemptId: null, loaded: false, progress: {} });
  void useProblemStore.getState().loadAll();
});

/** Test helper. */
export function resetAccountStore() {
  loading = null;
  useAccountStore.setState({ status: 'loading', me: null, meta: null, staleEngine: null });
}
