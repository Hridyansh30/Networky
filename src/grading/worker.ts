// Grading runs here, off the main thread, so a slow or looping network can
// never freeze the page: the client (gradeClient.ts) terminates this worker
// if it takes too long.
import '../zodConfig'; // first: the CSP forbids zod's eval probe (see the file)
import { gradeProblem, type GradeRequest } from './gradeProblem';

self.onmessage = (e: MessageEvent<GradeRequest>) => {
  try {
    self.postMessage({ ok: true, report: gradeProblem(e.data) });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
