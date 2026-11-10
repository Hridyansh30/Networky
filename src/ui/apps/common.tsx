// Small pieces shared by the Desktop apps.

import { useState, type ReactNode, type SVGProps } from 'react';
import type { Outcome } from '../../apps/client';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Stroke({ size = 18, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const AppIcon = {
  Globe: (p: P) => (
    <Stroke {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.8 3.9 5.8 3.9 9s-1.3 6.2-3.9 9c-2.6-2.8-3.9-5.8-3.9-9s1.3-6.2 3.9-9z" />
    </Stroke>
  ),
  Mail: (p: P) => (
    <Stroke {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </Stroke>
  ),
  Chat: (p: P) => (
    <Stroke {...p}>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" strokeWidth={2.6} />
    </Stroke>
  ),
  FolderUp: (p: P) => (
    <Stroke {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 16v-5M9.5 13.5 12 11l2.5 2.5" />
    </Stroke>
  ),
  Back: (p: P) => (
    <Stroke {...p}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Stroke>
  ),
  Forward: (p: P) => (
    <Stroke {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Stroke>
  ),
  Reload: (p: P) => (
    <Stroke {...p}>
      <path d="M20 12a8 8 0 1 1-2.3-5.7L20 8" />
      <path d="M20 3v5h-5" />
    </Stroke>
  ),
};

/** What happened on the network, step by step, plus the error if it failed. */
export function Steps({ outcome }: { outcome: Outcome<unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!outcome) return null;
  return (
    <div className={`app-steps ${outcome.ok ? 'ok' : 'failed'}`} role="status">
      {!outcome.ok && <p className="app-error">{outcome.error}</p>}
      {outcome.steps.length > 0 && (
        <>
          <button type="button" className="text-btn small" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide' : 'Show'} what happened on the network ({outcome.steps.length} steps)
          </button>
          {open && (
            <ol className="app-step-list">
              {outcome.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/** A labelled input row in the app forms. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="app-row">
      <span>{label}</span>
      {children}
    </label>
  );
}
