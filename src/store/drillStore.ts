// The drill set being played, and drill practice saved in this browser.
//
// Grading happens here, instantly, with the same pure functions the server
// uses (src/drills). Signed in, the set comes from the server (it draws the
// seed) and the finished answers go back to it, which replays the set and
// decides the practice XP. As a guest, or for a replayed seed from a link,
// everything stays in this browser and earns no XP.

import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import { checkAnswer, drillKind, nextLevel, questionAt, replaySet, SET_SIZE, type CheckResult, type DrillQuestion, type Level } from '../drills';
import { newSeed } from '../problems/random';
import { createDrillRepository, emptyDrillStats, type DrillRepository, type DrillStats } from '../storage/drillRepository';
import { useAccountStore } from './accountStore';

export interface Played {
  level: Level;
  answer: Record<string, string>;
  check: CheckResult;
}

export interface ServerResult {
  xp: number;
  earned: number;
  practiceToday: number;
  cap: number;
}

export interface DrillSet {
  kind: string;
  seed: number;
  startLevel: Level;
  /** Server set id: present when this set can earn practice XP. */
  setId: string | null;
  /** Why this set earns no XP, when it doesn't. */
  practiceOnly: string | null;
  played: Played[];
  /** True while the explanation of the last answer is showing. */
  reviewing: boolean;
  finished: boolean;
  server: ServerResult | null;
  serverError: string | null;
}

interface DrillState {
  stats: Record<string, DrillStats>;
  loaded: boolean;
  set: DrillSet | null;
  starting: boolean;
  loadStats(): Promise<void>;
  start(kind: string, level: Level, seed?: number): Promise<void>;
  /** The question on screen. */
  question(): { q: DrillQuestion; index: number; level: Level } | null;
  answer(answer: Record<string, string>): CheckResult | null;
  next(): Promise<void>;
  quit(): void;
}

let repo: DrillRepository = createDrillRepository();
const now = () => Date.now();

/** Results of the last questions that share the final level: what the level rule looks at next. */
function trailingAtLevel(final: readonly { level: Level; correct: boolean }[]): boolean[] {
  const level = final.at(-1)!.level;
  const out: boolean[] = [];
  for (let i = final.length - 1; i >= 0 && final[i].level === level; i--) out.unshift(final[i].correct);
  return out;
}

/** Longest run of right answers in a list. */
export function longestRun(results: readonly boolean[]): number {
  let best = 0;
  let run = 0;
  for (const r of results) {
    run = r ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export const useDrillStore = create<DrillState>()((set, get) => ({
  stats: {},
  loaded: false,
  set: null,
  starting: false,

  async loadStats() {
    const rows = await repo.all();
    set({ stats: Object.fromEntries(rows.map((r) => [r.kind, r])), loaded: true });
  },

  async start(kindId, level, seed) {
    const kind = drillKind(kindId);
    if (!kind) return;
    set({ starting: true });
    let setId: string | null = null;
    let practiceOnly: string | null = null;
    let s = seed;
    const account = useAccountStore.getState();
    if (seed !== undefined) practiceOnly = 'A replayed set from a link: practice only, no XP.';
    else if (kind.runsEngine) practiceOnly = 'This drill runs the simulator for every question, so it is graded in your browser and earns no practice XP.';
    else if (account.status !== 'signed-in') practiceOnly = account.status === 'guest' ? 'Sign in to earn practice XP for the weekly board.' : null;
    else {
      try {
        const r = await api<{ set: { id: string; seed: number } }>('POST', `/drills/${kind.id}/sets`, { level });
        setId = r.set.id;
        s = r.set.seed;
      } catch (e) {
        practiceOnly = e instanceof ApiError ? `${e.message} This set is practice only.` : 'Could not reach the server: this set is practice only.';
      }
    }
    set({
      starting: false,
      set: { kind: kind.id, seed: s ?? newSeed(), startLevel: level, setId, practiceOnly, played: [], reviewing: false, finished: false, server: null, serverError: null },
    });
  },

  question() {
    const st = get().set;
    const kind = st && drillKind(st.kind);
    if (!st || !kind || st.finished) return null;
    const index = st.reviewing ? st.played.length - 1 : st.played.length;
    // The level comes from the same replay the server runs, so the two can never disagree.
    const level = replaySet(kind, st.seed, st.startLevel, st.played.map((p) => p.answer)).at(index)!.level;
    return { q: questionAt(kind, st.seed, index, level), index, level };
  },

  answer(answer) {
    const st = get().set;
    const cur = get().question();
    if (!st || !cur || st.reviewing) return null;
    const check = checkAnswer(cur.q, answer);
    set({ set: { ...st, played: [...st.played, { level: cur.level, answer, check }], reviewing: true } });
    return check;
  },

  async next() {
    const st = get().set;
    if (!st || !st.reviewing) return;
    if (st.played.length < SET_SIZE) {
      set({ set: { ...st, reviewing: false } });
      return;
    }
    const kind = drillKind(st.kind)!;
    const final = replaySet(kind, st.seed, st.startLevel, st.played.map((p) => p.answer));
    const results = final.map((r) => r.correct);
    // Save this browser's record first: it must not depend on the server answering.
    const old = get().stats[st.kind] ?? emptyDrillStats(st.kind, now());
    const last = final.at(-1)!;
    const updated: DrillStats = {
      ...old,
      sets: old.sets + 1,
      answered: old.answered + SET_SIZE,
      correct: old.correct + results.filter(Boolean).length,
      bestStreak: Math.max(old.bestStreak, longestRun(results)),
      level: nextLevel(last.level, trailingAtLevel(final)),
      updatedAt: now(),
    };
    await repo.put(updated);
    set({ stats: { ...get().stats, [st.kind]: updated }, set: { ...st, reviewing: false, finished: true } });
    if (!st.setId) return;
    try {
      const r = await api<{ set: { xp: number; earned: number }; practiceToday: number; cap: number }>('POST', `/drill-sets/${st.setId}/finish`, {
        answers: st.played.map((p) => p.answer),
      });
      set({ set: { ...get().set!, server: { xp: r.set.xp, earned: r.set.earned, practiceToday: r.practiceToday, cap: r.cap } } });
    } catch (e) {
      set({ set: { ...get().set!, serverError: e instanceof ApiError ? e.message : 'Could not reach the server, so this set earned no XP.' } });
    }
  },

  quit() {
    set({ set: null });
  },
}));

/** Tests: use an in-memory repository and a clean store. */
export function resetDrillStore(r: DrillRepository) {
  repo = r;
  useDrillStore.setState({ stats: {}, loaded: false, set: null, starting: false });
}
