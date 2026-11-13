// Grade without blocking the UI.
//
// Each request gets its own short-lived Web Worker. That costs a few
// milliseconds to start, and buys two things: a hard timeout (terminate()
// kills a runaway grade, which a main-thread loop could never do) and no
// state carried from one grade to the next.
//
// Where workers don't exist (unit tests, very old browsers) it grades on the
// main thread instead: same function, same result, just not interruptible.

import { gradeProblem, type GradeRequest } from './gradeProblem';
import type { GradeReport } from './types';

export const GRADE_TIMEOUT_MS = 20_000;

type Reply = { ok: true; report: GradeReport } | { ok: false; error: string };

export type WorkerFactory = () => Worker;

const defaultWorker: WorkerFactory = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

export function gradeAsync(req: GradeRequest, opts: { timeoutMs?: number; worker?: WorkerFactory | null } = {}): Promise<GradeReport> {
  const factory = opts.worker === undefined ? (typeof Worker === 'undefined' ? null : defaultWorker) : opts.worker;
  if (!factory) {
    // Let the UI paint "Grading…" first.
    return new Promise((resolve, reject) => setTimeout(() => {
      try {
        resolve(gradeProblem(req));
      } catch (e) {
        reject(e);
      }
    }, 0));
  }
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = factory();
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error(`Grading took longer than ${Math.round((opts.timeoutMs ?? GRADE_TIMEOUT_MS) / 1000)} seconds and was stopped. Is there a loop in your network?`));
    }, opts.timeoutMs ?? GRADE_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      w.terminate();
    };
    w.onmessage = (e: MessageEvent<Reply>) => {
      done();
      if (e.data.ok) resolve(e.data.report);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      done();
      reject(new Error(e.message || 'The grader crashed'));
    };
    w.postMessage(req);
  });
}
