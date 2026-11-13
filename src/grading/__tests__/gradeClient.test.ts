import { describe, expect, it, vi } from 'vitest';
import { firstPing } from '../../problems/catalog/firstPing';
import { gradeAsync } from '../gradeClient';
import { gradeProblem } from '../gradeProblem';

const topology = firstPing.reference({});

/** A fake worker that runs the real handler logic, or hangs. */
function fakeWorker(mode: 'grade' | 'hang' | 'crash') {
  const w = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    terminate: vi.fn(),
    postMessage(req: Parameters<typeof gradeProblem>[0]) {
      if (mode === 'hang') return;
      setTimeout(() => {
        if (mode === 'crash') w.onerror?.({ message: 'boom' } as ErrorEvent);
        else w.onmessage?.({ data: { ok: true, report: gradeProblem(req) } } as MessageEvent);
      }, 0);
    },
  };
  return w;
}

describe('gradeAsync', () => {
  it('grades on the main thread when there are no workers, with the same result', async () => {
    const r = await gradeAsync({ slug: 'first-ping', scope: 'submit', topology }, { worker: null });
    expect(r).toEqual(gradeProblem({ slug: 'first-ping', scope: 'submit', topology }));
    expect(r.score).toBe(r.max);
  });

  it('grades in a worker and terminates it afterwards', async () => {
    const w = fakeWorker('grade');
    const r = await gradeAsync({ slug: 'first-ping', scope: 'run', topology }, { worker: () => w as unknown as Worker });
    expect(r.scope).toBe('run');
    expect(w.terminate).toHaveBeenCalled();
  });

  it('kills a worker that takes too long', async () => {
    const w = fakeWorker('hang');
    await expect(gradeAsync({ slug: 'first-ping', scope: 'run', topology }, { worker: () => w as unknown as Worker, timeoutMs: 20 })).rejects.toThrow(/stopped/);
    expect(w.terminate).toHaveBeenCalled();
  });

  it('reports a crashed worker', async () => {
    const w = fakeWorker('crash');
    await expect(gradeAsync({ slug: 'first-ping', scope: 'run', topology }, { worker: () => w as unknown as Worker })).rejects.toThrow('boom');
  });

  it('rejects an unknown problem', async () => {
    await expect(gradeAsync({ slug: 'nope', scope: 'run', topology }, { worker: null })).rejects.toThrow(/Unknown problem/);
  });
});
