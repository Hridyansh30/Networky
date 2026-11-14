import { useEffect, useState } from 'react';
import { useAccountStore } from '../store/accountStore';
import { api, ApiError } from './client';

export type Loadable<T> = { state: 'off' } | { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string };

/**
 * GETs `path` once the account store knows a server exists. 'off' when this
 * copy of Networky has none, so pages can leave the server-only parts out.
 * `path` null skips the request (e.g. a signed-in-only view for a guest).
 */
export function useApi<T>(path: string | null): Loadable<T> {
  const status = useAccountStore((s) => s.status);
  const [result, setResult] = useState<Loadable<T>>({ state: 'loading' });
  useEffect(() => {
    void useAccountStore.getState().load();
  }, []);
  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unavailable' || !path) {
      setResult({ state: 'off' });
      return;
    }
    let live = true;
    setResult({ state: 'loading' });
    api<T>('GET', path).then(
      (data) => live && setResult({ state: 'ok', data }),
      (e: unknown) => live && setResult({ state: 'error', message: e instanceof ApiError ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [status, path]);
  return result;
}
