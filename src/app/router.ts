// A tiny hash router: #/ , #/projects , #/learn , #/workspace , #/workspace/<projectId>,
// and #/lab/<labId>: a deep link that opens a sample lab (see app/LabLink.tsx).
// Hash routing works from any static host or folder (no server rewrites needed).

import { useSyncExternalStore } from 'react';

export type Route =
  | { page: 'home' }
  | { page: 'projects' }
  | { page: 'learn' }
  | { page: 'workspace'; projectId?: string }
  | { page: 'lab'; labId?: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'projects':
      return { page: 'projects' };
    case 'learn':
      return { page: 'learn' };
    case 'lab':
      return { page: 'lab', labId: parts[1] && ID.test(parts[1]) ? parts[1] : undefined };
    case 'workspace':
      return { page: 'workspace', projectId: parts[1] && ID.test(parts[1]) ? parts[1] : undefined };
    default:
      return { page: 'home' };
  }
}

export function href(r: Route): string {
  if (r.page === 'home') return '#/';
  if (r.page === 'workspace') return r.projectId ? `#/workspace/${r.projectId}` : '#/workspace';
  if (r.page === 'lab') return r.labId ? `#/lab/${r.labId}` : '#/learn';
  return `#/${r.page}`;
}

export function navigate(r: Route, replace = false) {
  const h = href(r);
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parseRoute(hash);
}
