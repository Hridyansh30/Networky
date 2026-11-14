// Signed-in mode of the problem store: what each action sends to the server.
//
// The phase 5 plan said "an HTTP repository behind the same interface"
// (progressRepository.ts). That would have been a mistake: that interface is
// put(row), and a row holds `solved`, `best` and the hints count. An HTTP
// put(row) is the client TELLING the server its score, the exact thing the
// judge exists to refuse. So signed-in mode does not swap the repository; it
// swaps the actions. The client says what it did ("here is my network",
// "show me the next hint", "my answer is X") and copies back the row the
// server computed.

import { API, api } from '../api/client';
import type { ServerAttempt, ServerProblemRow, SubmitResult } from '../api/types';
import { emptyProgress, type ProblemProgress } from '../storage/progressRepository';

/** How long edits wait before the draft is sent. Locally it is 500 ms; a request every half second of dragging is not. */
export const REMOTE_AUTOSAVE_MS = 20_000;

/** The server's row, in the shape the pages already read. */
export function fromServer(slug: string, specVersion: number, row: ServerProblemRow | null, extra: Partial<ProblemProgress> = {}): ProblemProgress {
  const base = emptyProgress(slug, specVersion);
  if (!row) return { ...base, ...extra };
  return {
    ...base,
    best: row.best,
    solved: row.solved,
    solutionFirst: row.solutionFirst,
    solutionOpened: row.solutionOpened,
    submits: row.submits,
    failedSubmits: row.failedSubmits,
    firstTry: row.firstTry ?? undefined,
    updatedAt: row.solvedAt ?? base.updatedAt,
    ...extra,
  };
}

/** The row for an attempt as the server sees it, plus what only the attempt knows. */
export function fromAttempt(a: ServerAttempt): ProblemProgress {
  return fromServer(a.slug, a.specVersion, a.progress, {
    seed: a.seed ?? undefined,
    attempt: a.network ?? undefined,
    hints: a.hints,
    answers: Object.keys(a.answers).length ? Object.fromEntries(Object.entries(a.answers).map(([k, v]) => [k, v.choice])) : undefined,
  });
}

/**
 * The tab is closing: a normal request would be cancelled with the page, so
 * this one is sent with `keepalive`. Browsers cap keepalive bodies at 64 KB;
 * a bigger network waits for the next autosave instead (it was saved at most
 * REMOTE_AUTOSAVE_MS ago).
 */
export function saveDraftOnExit(attemptId: string, network: string) {
  const body = JSON.stringify({ network });
  if (body.length > 60_000) return;
  void fetch(`${API}/attempts/${attemptId}/network`, { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
}

export const remote = {
  /** The active attempt, or a new one (the server draws the seed). */
  async attempt(slug: string): Promise<ServerAttempt> {
    const { attempt } = await api<{ attempt: ServerAttempt | null }>('GET', `/problems/${slug}/attempt`);
    return attempt ?? (await this.restart(slug));
  },
  async restart(slug: string): Promise<ServerAttempt> {
    return (await api<{ attempt: ServerAttempt }>('POST', `/problems/${slug}/attempts`)).attempt;
  },
  saveDraft: (attemptId: string, network: string) => api<{ ok: true }>('PUT', `/attempts/${attemptId}/network`, { network }),
  submit: (attemptId: string, submissionId: string, network: string) => api<SubmitResult>('POST', `/attempts/${attemptId}/submissions`, { submissionId, network }),
  hint: (attemptId: string, requirement: string) => api<{ requirement: string; level: number; texts: string[] }>('POST', `/attempts/${attemptId}/hints`, { requirement }),
  solution: (attemptId: string) => api<{ solution: string; reference: string; progress: ServerProblemRow }>('POST', `/attempts/${attemptId}/solution`),
  answer: (attemptId: string, questionId: string, choice: string) =>
    api<{ answers: ServerAttempt['answers']; progress: ServerProblemRow }>('POST', `/attempts/${attemptId}/answers`, { questionId, choice }),
};
