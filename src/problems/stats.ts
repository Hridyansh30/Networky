// What the Problems page, Home and the XP bar show about the learner, all
// derived from saved progress plus the catalog. Pure functions, so every
// number on screen is tested and nothing is stored twice.

import type { ProblemProgress } from '../storage/progressRepository';
import type { Track } from './catalog';
import type { Difficulty, ProblemSpec } from './spec';
import { levelOf, totalXp, type Level } from './xp';

export type Status = 'solved' | 'attempted' | 'todo';
type Progress = Readonly<Record<string, ProblemProgress>>;

export function statusOf(progress: Progress, slug: string): Status {
  const p = progress[slug];
  if (!p) return 'todo';
  if (p.solved) return 'solved';
  return p.submits > 0 || p.hints && Object.keys(p.hints).length > 0 ? 'attempted' : 'todo';
}

export interface LearnerStats {
  solved: number;
  total: number;
  byDifficulty: Record<Difficulty, { solved: number; total: number }>;
  xp: number;
  level: Level;
}

export function learnerStats(progress: Progress, problems: readonly ProblemSpec[]): LearnerStats {
  const byDifficulty: LearnerStats['byDifficulty'] = { easy: { solved: 0, total: 0 }, medium: { solved: 0, total: 0 }, hard: { solved: 0, total: 0 } };
  let solved = 0;
  for (const spec of problems) {
    byDifficulty[spec.difficulty].total++;
    if (progress[spec.slug]?.solved) {
      solved++;
      byDifficulty[spec.difficulty].solved++;
    }
  }
  // XP only for problems that are in the catalog: a stale or invented row adds nothing.
  const xp = totalXp(problems.filter((s) => progress[s.slug]?.solved).map((s) => ({ difficulty: s.difficulty, best: progress[s.slug].best, solutionFirst: progress[s.slug].solutionFirst })));
  return { solved, total: problems.length, byDifficulty, xp, level: levelOf(xp) };
}

export function trackProgress(progress: Progress, track: Track): { solved: number; total: number; next?: string } {
  const solved = track.slugs.filter((s) => progress[s]?.solved).length;
  return { solved, total: track.slugs.length, next: track.slugs.find((s) => !progress[s]?.solved) };
}

/** The unsolved problem touched most recently: "Continue learning". */
export function continueWith(progress: Progress, problems: readonly ProblemSpec[]): ProblemSpec | undefined {
  return problems
    .filter((s) => progress[s.slug] && !progress[s.slug].solved)
    .sort((a, b) => progress[b.slug].updatedAt - progress[a.slug].updatedAt)[0];
}
