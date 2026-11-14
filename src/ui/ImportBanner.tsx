import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAccountStore } from '../store/accountStore';
import { useProblemStore } from '../store/problemStore';
import type { ProblemProgress } from '../storage/progressRepository';
import { Icon } from './icons';

type ImportResult = 'solved' | 'draft' | 'skipped';

/** Rows worth offering: something was done, not just opened. */
const worthImporting = (p: ProblemProgress) => p.solved || p.submits > 0 || Object.keys(p.hints).length > 0 || !!p.answers || p.solutionOpened;

/**
 * Once per account: bring the progress saved in this browser (phase 5) into
 * the account. The server re-grades every saved network, so only what still
 * passes becomes a solve; the browser's own "solved" and XP are not sent as
 * facts (see server/routes/import.ts).
 *
 * One request per problem, because each one runs the judge and a free
 * Cloudflare request gets 10 ms of CPU.
 */
export function ImportBanner() {
  const status = useAccountStore((s) => s.status);
  const importedAt = useAccountStore((s) => s.me?.importedAt);
  const [rows, setRows] = useState<ProblemProgress[]>([]);
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'hidden'>('idle');
  const [counts, setCounts] = useState<Record<ImportResult, number>>({ solved: 0, draft: 0, skipped: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'signed-in' || importedAt) return;
    let live = true;
    useProblemStore
      .getState()
      .repo.all()
      .then((all) => live && setRows(all.filter(worthImporting)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [status, importedAt]);

  if (state === 'hidden' || status !== 'signed-in' || (importedAt && state !== 'done') || (!rows.length && state !== 'done')) return null;

  const run = async () => {
    setState('running');
    setError(null);
    const c = { solved: 0, draft: 0, skipped: 0 };
    try {
      for (const row of rows) {
        try {
          const r = await api<{ result: ImportResult }>('POST', `/import/${row.slug}`, { row });
          c[r.result]++;
        } catch (e) {
          // Already imported (a second tab, a retry): fine, move on.
          if (e instanceof ApiError && e.code === 'already_imported') continue;
          if (e instanceof ApiError && e.status === 404) {
            c.skipped++;
            continue;
          }
          throw e;
        }
        setCounts({ ...c });
      }
      await api('POST', '/import/done');
      setCounts({ ...c });
      setState('done');
      await useAccountStore.getState().refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('idle');
    }
  };

  return (
    <div className="import-banner" role="status">
      <Icon.Download size={18} />
      {state === 'done' ? (
        <span>
          Imported. {counts.solved} solved {counts.solved === 1 ? 'problem' : 'problems'} counted
          {counts.draft ? `, ${counts.draft} kept as work in progress` : ''}
          {counts.skipped ? `, ${counts.skipped} skipped (the problem changed since)` : ''}.
        </span>
      ) : (
        <span>
          This browser has progress on <b>{rows.length}</b> {rows.length === 1 ? 'problem' : 'problems'}. Bring it into your account? Saved networks are checked again; ones that pass count as solved. You can do this once.
          {error && <span className="import-error"> {error}</span>}
        </span>
      )}
      {state === 'done' ? (
        <button className="btn sm" onClick={() => setState('hidden')}>
          Close
        </button>
      ) : (
        <>
          <button className="btn sm btn-primary" disabled={state === 'running'} onClick={() => void run()}>
            {state === 'running' ? `Importing ${counts.solved + counts.draft + counts.skipped + 1} of ${rows.length}…` : 'Import'}
          </button>
          <button className="btn sm ghost" disabled={state === 'running'} onClick={() => setState('hidden')} title="Ask again next time">
            Not now
          </button>
        </>
      )}
    </div>
  );
}
