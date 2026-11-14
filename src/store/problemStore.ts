// The problem being solved, and everyone's saved progress.
//
// A problem opens in the same workspace as the playground: its network is
// loaded into the topology store, so every editor, the CLI and the
// simulation work unchanged. What this store adds:
//   - which problem and variant (seed) is open
//   - Run / Submit through the grader worker
//   - hints, the gated solution, XP inputs
//   - autosave of the learner's network into the ProgressRepository, so a
//     reload or a later visit continues where they left off.
//
// Two modes. Guest (not signed in): everything is graded and saved in this
// browser, as in phase 5. Signed in (`remote`): Run still grades here (it is
// free feedback and records nothing), but Submit, hints, answers, the
// solution and restarts go to the server, which grades again and keeps the
// only copy that counts. See remoteProgress.ts for why the actions are
// swapped, not the repository.
//
// Policy decisions, each enforced here and tested:
//   - Best score and XP only change on a Submit that solves the problem.
//     Partial submits are feedback, not credit.
//   - The solution unlocks after solving or after 3 failed submits. Opening
//     it before the first solve zeroes that problem's XP, permanently.
//   - Predict problems: an answer is final once given, because the
//     explanation is shown straight away. The first complete attempt sets the
//     XP share (firstTry); a later attempt can mark the problem solved (all
//     correct) but never raises that share, since by then the answers were
//     on screen. Answers are judged on the problem's own start network, not
//     on whatever the learner changed on the canvas.
//   - A problem whose version changed keeps solved/best (earned before) but
//     starts a fresh attempt: the old network was made for other tests.

import { create } from 'zustand';
import { solved as isSolved } from '../grading/grade';
import { gradeAsync } from '../grading/gradeClient';
import { nextHint, scoreWithHints } from '../grading/hints';
import type { GradeReport } from '../grading/types';
import { deserialize, serialize, type NetworkyFile } from '../model/serialize';
import { problemBySlug } from '../problems/catalog';
import type { Expectation } from '../grading/checks/common';
import { instantiate } from '../problems/params';
import { actualOutcome } from '../problems/predict';
import { newSeed } from '../problems/random';
import type { Params, ProblemSpec } from '../problems/spec';
import { createProgressRepository, emptyProgress, type ProblemProgress, type ProgressRepository } from '../storage/progressRepository';
import { newSubmissionId } from '../api/client';
import type { ServerProblemRow } from '../api/types';
import { fromAttempt, fromServer, remote, REMOTE_AUTOSAVE_MS, saveDraftOnExit } from './remoteProgress';
import { useProjectStore } from './projectStore';
import { useSimStore } from './simStore';
import { useTopologyStore } from './topologyStore';

export const SOLUTION_AFTER_FAILS = 3;
const AUTOSAVE_MS = 500;

export type Variant = ProblemSpec & { seed?: number; values: Params };

interface ProblemState {
  repo: ProgressRepository;
  /** Signed in: the server is the record (see the header). */
  remote: boolean;
  /** Signed in: the server attempt behind the open problem. */
  attemptId: string | null;
  /** Every saved progress row, by slug. */
  progress: Record<string, ProblemProgress>;
  loaded: boolean;
  /** The open problem. */
  variant: Variant | null;
  report: GradeReport | null;
  grading: 'run' | 'submit' | null;
  error: string | null;
  /** Predict problems: what the network really did, per answered question id. */
  outcomes: Record<string, Expectation | 'pending'>;

  loadAll(): Promise<void>;
  /** Switches to signed-in mode with the server's rows, or back to this browser's (null). */
  useServer(rows: Record<string, ServerProblemRow> | null): Promise<void>;
  open(slug: string): Promise<boolean>;
  close(): void;
  run(): Promise<void>;
  submit(): Promise<void>;
  unlockHint(requirement: string): Promise<void>;
  /** Predict problems: lock in an answer. Ignored if that question already has one. */
  answer(question: string, choice: Expectation): Promise<void>;
  /** Predict problems: put the start network back on the canvas (before a replay). */
  restoreStart(): void;
  /** Marks the solution as seen (and costs the XP if not yet solved). */
  openSolution(): Promise<void>;
  /** Replaces the learner's network with the reference solution. */
  loadReference(): void;
  /** Back to the start network (randomized problems: a new variant). */
  restart(): Promise<void>;
  /** Writes the learner's network now (also runs on a timer after edits). */
  flush(): Promise<void>;
}

/** The progress row for the open problem, or a fresh one. */
const current = (s: ProblemState): ProblemProgress | null => {
  if (!s.variant) return null;
  return s.progress[s.variant.slug] ?? emptyProgress(s.variant.slug, s.variant.version);
};

export const solutionUnlocked = (p: ProblemProgress | null | undefined) => !!p && (p.solved || p.failedSubmits >= SOLUTION_AFTER_FAILS);

function startFile(v: Variant): NetworkyFile {
  return { topology: v.start(v.values), layout: { ...(v.layout ?? {}) } };
}

/** Puts a problem's network into the workspace without it counting as unsaved playground work. */
function showNetwork(file: NetworkyFile, title: string, slug: string) {
  useTopologyStore.getState().replaceAll(file);
  const t = useTopologyStore.getState();
  useProjectStore.setState({ id: undefined, name: title, lab: undefined, problem: slug, savedTopology: t.topology, savedLayout: t.layout });
  useSimStore.getState().setMode('realtime');
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | undefined;

export const useProblemStore = create<ProblemState>()((set, get) => {
  const write = async (p: ProblemProgress) => {
    const row = { ...p, updatedAt: Date.now() };
    set((s) => ({ progress: { ...s.progress, [row.slug]: row } }));
    if (get().remote) return; // the server wrote its own copy already
    try {
      await get().repo.put(row);
    } catch (e) {
      set({ error: `Could not save your progress: ${e instanceof Error ? e.message : e}` });
    }
  };

  const attemptNow = (): string => {
    const { topology, layout } = useTopologyStore.getState();
    return serialize({ topology, layout });
  };

  const grade = async (scope: 'run' | 'submit') => {
    const v = get().variant;
    if (!v || get().grading) return null;
    set({ grading: scope, error: null });
    try {
      const report = await gradeAsync({ slug: v.slug, seed: v.seed, scope, topology: useTopologyStore.getState().topology });
      if (get().variant !== v) return null; // the learner left meanwhile
      set({ report, grading: null });
      return report;
    } catch (e) {
      set({ grading: null, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };

  /** Saves the learner's network a while after each edit. */
  const watchEdits = () => {
    unsubscribe?.();
    unsubscribe = useTopologyStore.subscribe((s, prev) => {
      if (s.topology === prev.topology && s.layout === prev.layout) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void get().flush(), get().remote ? REMOTE_AUTOSAVE_MS : AUTOSAVE_MS);
    });
  };

  /** Signed in: the server's active attempt (any device), or a new one. */
  const openRemote = async (spec: ProblemSpec): Promise<boolean> => {
    set({ error: null });
    const a = await call(() => remote.attempt(spec.slug));
    if (!a) return false;
    const variant = instantiate(spec, a.seed ?? undefined) as Variant;
    let file: NetworkyFile | null = null;
    if (a.network) {
      try {
        file = deserialize(a.network);
      } catch {
        file = null;
      }
    }
    const outcomes = Object.fromEntries(Object.entries(a.answers).map(([k, x]) => [k, x.actual as Expectation]));
    set({ variant, attemptId: a.id, report: null, grading: null, outcomes });
    showNetwork(file ?? startFile(variant), spec.title, spec.slug);
    await write({ ...fromAttempt(a), attempt: attemptNow() });
    watchEdits();
    return true;
  };

  /**
   * Signed in: the server grades the network again and records the result.
   * The report shown is the server's, so what you see is what was recorded.
   */
  const submitRemote = async () => {
    const v = get().variant;
    const id = get().attemptId;
    if (!v || !id || get().grading) return;
    clearTimeout(saveTimer);
    const network = attemptNow();
    set({ grading: 'submit', error: null });
    const r = await call(() => remote.submit(id, newSubmissionId(), network));
    if (get().variant !== v) return;
    set({ grading: null, report: r?.report ?? get().report });
    if (r) merge(r.progress, { attempt: network, last: r.hinted ? { score: r.hinted.score, max: r.hinted.max } : undefined });
  };

  /** Signed in: runs a server call, showing its error instead of throwing. */
  const call = async <T,>(f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };

  /** Copies a server row into the open problem's row, keeping what only the client tracks. */
  const merge = (row: ServerProblemRow, extra: Partial<ProblemProgress> = {}) => {
    const v = get().variant;
    const p = current(get());
    if (!v || !p) return;
    const fresh = fromServer(v.slug, v.version, row);
    void write({ ...p, best: fresh.best, solved: fresh.solved, solutionFirst: fresh.solutionFirst, solutionOpened: fresh.solutionOpened, submits: fresh.submits, failedSubmits: fresh.failedSubmits, firstTry: fresh.firstTry, ...extra });
  };

  return {
    repo: createProgressRepository(),
    remote: false,
    attemptId: null,
    progress: {},
    loaded: false,
    variant: null,
    report: null,
    grading: null,
    error: null,
    outcomes: {},

    async loadAll() {
      if (get().remote) return;
      try {
        const rows = await get().repo.all();
        set({ progress: Object.fromEntries(rows.map((r) => [r.slug, r])), loaded: true });
      } catch {
        set({ loaded: true });
      }
    },

    async useServer(rows) {
      await get().flush();
      if (!rows) {
        if (get().remote) set({ remote: false, attemptId: null, loaded: false, progress: {} });
        if (!get().loaded) await get().loadAll();
        return;
      }
      const was = get().remote ? get().progress : {};
      const progress: Record<string, ProblemProgress> = {};
      for (const [slug, row] of Object.entries(rows)) {
        const spec = problemBySlug(slug);
        // Keep what only an open attempt knows (network, hints, answers) on a refresh.
        if (spec) progress[slug] = { ...was[slug], ...fromServer(slug, spec.version, row, { hints: was[slug]?.hints ?? {}, attempt: was[slug]?.attempt, seed: was[slug]?.seed, answers: was[slug]?.answers, last: was[slug]?.last }) };
      }
      for (const slug of Object.keys(was)) progress[slug] ??= was[slug];
      if (get().remote) set({ progress, loaded: true });
      else set({ remote: true, attemptId: null, progress, loaded: true });
    },

    async open(slug) {
      const spec = problemBySlug(slug);
      if (!spec) return false;
      if (!get().loaded) await get().loadAll();
      await get().flush();
      if (get().remote) {
        const ok = await openRemote(spec);
        // Signed out meanwhile (a 401): open it from this browser instead.
        if (ok || get().remote) return ok;
        if (!get().loaded) await get().loadAll();
      }
      let saved = get().progress[slug] ?? null;
      if (saved && saved.specVersion !== spec.version) {
        // The tests changed: keep what was earned, start a fresh attempt.
        saved = { ...emptyProgress(slug, spec.version), best: saved.best, solved: saved.solved, solutionFirst: saved.solutionFirst, solutionOpened: saved.solutionOpened, firstTry: saved.firstTry };
      }
      const seed = spec.params ? (saved?.seed ?? newSeed()) : undefined;
      const variant = instantiate(spec, seed) as Variant;
      let file: NetworkyFile | null = null;
      if (saved?.attempt) {
        try {
          file = deserialize(saved.attempt);
        } catch {
          file = null; // a damaged save is dropped, never trusted
        }
      }
      const row: ProblemProgress = { ...(saved ?? emptyProgress(slug, spec.version)), seed };
      // Answers given earlier are shown with their real outcome again.
      const start = variant.questions?.length ? variant.start(variant.values) : null;
      const outcomes = Object.fromEntries((variant.questions ?? []).filter((q) => row.answers?.[q.id]).map((q) => [q.id, actualOutcome(start!, q)]));
      set({ variant, report: null, error: null, grading: null, outcomes });
      showNetwork(file ?? startFile(variant), spec.title, slug);
      if (!file) row.attempt = attemptNow();
      await write(row);
      watchEdits();
      return true;
    },

    close() {
      void get().flush();
      unsubscribe?.();
      unsubscribe = undefined;
      set({ variant: null, attemptId: null, report: null, grading: null, error: null, outcomes: {} });
    },

    async flush() {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      const p = current(get());
      if (!p || useProjectStore.getState().problem !== p.slug) return;
      const attempt = attemptNow();
      if (attempt === p.attempt) return;
      // Read before the first await: close() clears the attempt right after calling this.
      const id = get().remote ? get().attemptId : null;
      await write({ ...p, attempt });
      if (id) await call(() => remote.saveDraft(id, attempt));
    },

    async run() {
      await grade('run');
    },

    async submit() {
      if (get().remote) return submitRemote();
      const report = await grade('submit');
      const p = current(get());
      if (!report || !p) return;
      const hinted = scoreWithHints(report, p.hints);
      const ok = isSolved(report);
      await write({
        ...p,
        attempt: attemptNow(),
        submits: p.submits + 1,
        failedSubmits: p.failedSubmits + (ok ? 0 : 1),
        solved: p.solved || ok,
        best: ok && hinted.max > 0 ? Math.max(p.best, hinted.score / hinted.max) : p.best,
        last: { score: hinted.score, max: hinted.max },
      });
    },

    async unlockHint(requirement) {
      const p = current(get());
      if (!p || !get().variant?.requirements.some((r) => r.id === requirement)) return;
      const n = nextHint(p.hints, requirement);
      if (n === null) return;
      const id = get().attemptId;
      if (get().remote) {
        const r = id && (await call(() => remote.hint(id, requirement)));
        if (r) await write({ ...current(get())!, hints: { ...current(get())!.hints, [requirement]: r.level } });
        return;
      }
      await write({ ...p, hints: { ...p.hints, [requirement]: n } });
    },

    async answer(question, choice) {
      const v = get().variant;
      const p = current(get());
      const q = v?.questions?.find((x) => x.id === question);
      if (!v || !p || !q || !q.choices.includes(choice) || p.answers?.[question]) return;
      if (get().remote) {
        const id = get().attemptId;
        const r = id && (await call(() => remote.answer(id, question, choice)));
        if (!r) return;
        const outcomes = { ...get().outcomes, ...Object.fromEntries(Object.entries(r.answers).map(([k, a]) => [k, a.actual as Expectation])) };
        set({ outcomes });
        const answers = Object.fromEntries(Object.entries(r.answers).map(([k, a]) => [k, a.choice]));
        const all = v.questions!;
        const done = all.every((x) => answers[x.id]);
        const right = all.filter((x) => r.answers[x.id]?.correct).length;
        merge(r.progress, { answers, ...(done ? { last: { score: right, max: all.length } } : {}) });
        return;
      }
      const actual = actualOutcome(v.start(v.values), q);
      const answers = { ...(p.answers ?? {}), [question]: choice };
      const outcomes = { ...get().outcomes, [question]: actual };
      set({ outcomes });
      const all = v.questions!;
      if (!all.every((x) => answers[x.id])) return write({ ...p, answers });
      // The attempt is complete.
      const right = all.filter((x) => outcomes[x.id] === answers[x.id]).length;
      const share = right / all.length;
      const firstTry = p.firstTry ?? share;
      await write({ ...p, answers, firstTry, best: firstTry, submits: p.submits + 1, failedSubmits: p.failedSubmits + (right === all.length ? 0 : 1), solved: p.solved || right === all.length, last: { score: right, max: all.length } });
    },

    restoreStart() {
      const v = get().variant;
      // Untouched since it was opened (nothing to undo): leave the canvas alone.
      if (v && useTopologyStore.getState().past.length > 0) useTopologyStore.getState().replaceAll(startFile(v));
    },

    async openSolution() {
      const p = current(get());
      if (!p || !solutionUnlocked(p) || p.solutionOpened) return;
      if (get().remote) {
        const id = get().attemptId;
        const r = id && (await call(() => remote.solution(id)));
        if (r) merge(r.progress);
        return;
      }
      await write({ ...p, solutionOpened: true, solutionFirst: p.solutionFirst || !p.solved });
    },

    loadReference() {
      const v = get().variant;
      const p = current(get());
      if (!v || !p?.solutionOpened) return;
      // One undo step, so Undo brings the learner's own network back.
      const topology = v.reference(v.values);
      useTopologyStore.getState().apply(() => ({ topology, layout: { ...(v.layout ?? {}) } }));
      set({ report: null });
    },

    async restart() {
      const v = get().variant;
      const p = current(get());
      if (!v || !p) return;
      const spec = problemBySlug(v.slug)!;
      if (get().remote) {
        const a = await call(() => remote.restart(v.slug));
        if (!a) return;
        const variant = instantiate(spec, a.seed ?? undefined) as Variant;
        set({ variant, attemptId: a.id, report: null, error: null, outcomes: {} });
        useTopologyStore.getState().replaceAll(startFile(variant));
        await write({ ...fromAttempt(a), attempt: attemptNow() });
        return;
      }
      const seed = spec.params ? newSeed() : undefined;
      const variant = instantiate(spec, seed) as Variant;
      set({ variant, report: null, error: null, outcomes: {} });
      useTopologyStore.getState().replaceAll(startFile(variant));
      await write({ ...p, seed, attempt: attemptNow(), answers: undefined });
    },
  };
});

// Signed in, edits reach the server every REMOTE_AUTOSAVE_MS. Closing the tab
// in between would lose them, so the last change goes out as the page hides.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    const s = useProblemStore.getState();
    const p = s.variant && s.progress[s.variant.slug];
    if (!s.remote || !s.attemptId || !p || !saveTimer || useProjectStore.getState().problem !== p.slug) return;
    const { topology, layout } = useTopologyStore.getState();
    saveDraftOnExit(s.attemptId, serialize({ topology, layout }));
  });
}

/** Test helper: a clean store on a given repository. */
export function resetProblemStore(repo: ProgressRepository) {
  unsubscribe?.();
  unsubscribe = undefined;
  clearTimeout(saveTimer);
  useProblemStore.setState({ repo, remote: false, attemptId: null, progress: {}, loaded: false, variant: null, report: null, grading: null, error: null, outcomes: {} });
}
