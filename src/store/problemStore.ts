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
// Policy decisions, each enforced here and tested:
//   - Best score and XP only change on a Submit that solves the problem.
//     Partial submits are feedback, not credit.
//   - The solution unlocks after solving or after 3 failed submits. Opening
//     it before the first solve zeroes that problem's XP, permanently.
//   - A problem whose version changed keeps solved/best (earned before) but
//     starts a fresh attempt: the old network was made for other tests.

import { create } from 'zustand';
import { solved as isSolved } from '../grading/grade';
import { gradeAsync } from '../grading/gradeClient';
import { nextHint, scoreWithHints } from '../grading/hints';
import type { GradeReport } from '../grading/types';
import { deserialize, serialize, type NetworkyFile } from '../model/serialize';
import { problemBySlug } from '../problems/catalog';
import { instantiate } from '../problems/params';
import { newSeed } from '../problems/random';
import type { Params, ProblemSpec } from '../problems/spec';
import { createProgressRepository, emptyProgress, type ProblemProgress, type ProgressRepository } from '../storage/progressRepository';
import { useProjectStore } from './projectStore';
import { useSimStore } from './simStore';
import { useTopologyStore } from './topologyStore';

export const SOLUTION_AFTER_FAILS = 3;
const AUTOSAVE_MS = 500;

export type Variant = ProblemSpec & { seed?: number; values: Params };

interface ProblemState {
  repo: ProgressRepository;
  /** Every saved progress row, by slug. */
  progress: Record<string, ProblemProgress>;
  loaded: boolean;
  /** The open problem. */
  variant: Variant | null;
  report: GradeReport | null;
  grading: 'run' | 'submit' | null;
  error: string | null;

  loadAll(): Promise<void>;
  open(slug: string): Promise<boolean>;
  close(): void;
  run(): Promise<void>;
  submit(): Promise<void>;
  unlockHint(requirement: string): Promise<void>;
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

  return {
    repo: createProgressRepository(),
    progress: {},
    loaded: false,
    variant: null,
    report: null,
    grading: null,
    error: null,

    async loadAll() {
      try {
        const rows = await get().repo.all();
        set({ progress: Object.fromEntries(rows.map((r) => [r.slug, r])), loaded: true });
      } catch {
        set({ loaded: true });
      }
    },

    async open(slug) {
      const spec = problemBySlug(slug);
      if (!spec) return false;
      if (!get().loaded) await get().loadAll();
      await get().flush();
      let saved = get().progress[slug] ?? null;
      if (saved && saved.specVersion !== spec.version) {
        // The tests changed: keep what was earned, start a fresh attempt.
        saved = { ...emptyProgress(slug, spec.version), best: saved.best, solved: saved.solved, solutionFirst: saved.solutionFirst, solutionOpened: saved.solutionOpened };
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
      set({ variant, report: null, error: null, grading: null });
      showNetwork(file ?? startFile(variant), spec.title, slug);
      if (!file) row.attempt = attemptNow();
      await write(row);

      unsubscribe?.();
      unsubscribe = useTopologyStore.subscribe((s, prev) => {
        if (s.topology === prev.topology && s.layout === prev.layout) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void get().flush(), AUTOSAVE_MS);
      });
      return true;
    },

    close() {
      void get().flush();
      unsubscribe?.();
      unsubscribe = undefined;
      set({ variant: null, report: null, grading: null, error: null });
    },

    async flush() {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      const p = current(get());
      if (!p || useProjectStore.getState().problem !== p.slug) return;
      const attempt = attemptNow();
      if (attempt !== p.attempt) await write({ ...p, attempt });
    },

    async run() {
      await grade('run');
    },

    async submit() {
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
      await write({ ...p, hints: { ...p.hints, [requirement]: n } });
    },

    async openSolution() {
      const p = current(get());
      if (!p || !solutionUnlocked(p) || p.solutionOpened) return;
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
      const seed = spec.params ? newSeed() : undefined;
      const variant = instantiate(spec, seed) as Variant;
      set({ variant, report: null, error: null });
      useTopologyStore.getState().replaceAll(startFile(variant));
      await write({ ...p, seed, attempt: attemptNow() });
    },
  };
});

/** Test helper: a clean store on a given repository. */
export function resetProblemStore(repo: ProgressRepository) {
  unsubscribe?.();
  unsubscribe = undefined;
  clearTimeout(saveTimer);
  useProblemStore.setState({ repo, progress: {}, loaded: false, variant: null, report: null, grading: null, error: null });
}
