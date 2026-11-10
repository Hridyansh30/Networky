// Light / dark theme. The choice is a per-viewer convenience kept in
// localStorage; with no choice the OS setting decides (tokens.css handles that).

import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'networky-theme';
const listeners = new Set<() => void>();

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  const s = stored();
  if (s) return s;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme() {
  const s = stored();
  if (s) document.documentElement.dataset.theme = s;
  else delete document.documentElement.dataset.theme;
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode: the toggle still works for this page view */
  }
  document.documentElement.dataset.theme = t;
  listeners.forEach((l) => l());
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    currentTheme,
  );
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')];
}
