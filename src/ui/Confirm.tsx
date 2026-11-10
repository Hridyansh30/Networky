// An in-page confirmation dialog. window.confirm() is blocked in sandboxed
// frames and embedded viewers (it silently returns false), so the app asks
// with its own dialog: `if (await confirmAction({...})) ...`.

import { useEffect, useRef } from 'react';
import { create } from 'zustand';

interface Ask {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ ask: Ask | null }>()(() => ({ ask: null }));

export function confirmAction(opts: Omit<Ask, 'resolve'>): Promise<boolean> {
  useConfirm.getState().ask?.resolve(false);
  return new Promise((resolve) => useConfirm.setState({ ask: { ...opts, resolve } }));
}

export function ConfirmHost() {
  const ask = useConfirm((s) => s.ask);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ok.current?.focus();
  }, [ask]);
  if (!ask) return null;
  const done = (v: boolean) => {
    useConfirm.setState({ ask: null });
    ask.resolve(v);
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(false)} onKeyDown={(e) => e.key === 'Escape' && done(false)}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
        <h2 id="confirm-title">{ask.title}</h2>
        <p id="confirm-text" className="muted">
          {ask.message}
        </p>
        <div className="confirm-actions">
          <button className="btn" onClick={() => done(false)}>
            Cancel
          </button>
          <button ref={ok} className={`btn ${ask.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)}>
            {ask.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
