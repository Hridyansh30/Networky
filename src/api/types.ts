// What the API returns (server/routes/*). Kept by hand, small on purpose.

import type { Level } from '../problems/xp';
import type { GradeReport } from '../grading/types';
import type { HintedScore } from '../grading/hints';

export interface ServerProblemRow {
  slug: string;
  solved: boolean;
  solvedAt: number | null;
  best: number;
  firstTry: number | null;
  solutionOpened: boolean;
  solutionFirst: boolean;
  submits: number;
  failedSubmits: number;
  xp: number;
}

export interface Me {
  user: { handle: string; displayName: string; avatarUrl: string | null } | null;
  stats?: { xp: number; solved: number; byDifficulty: { easy: number; medium: number; hard: number }; level: Level };
  rank?: number | null;
  importedAt?: number | null;
  progress?: Record<string, ServerProblemRow>;
}

export interface ServerAnswer {
  choice: string;
  correct: boolean;
  actual: string;
  explanation: string;
}

export interface ServerAttempt {
  id: string;
  slug: string;
  specVersion: number;
  seed: number | null;
  network: string | null;
  hints: Record<string, number>;
  hintTexts: Record<string, string[]>;
  answers: Record<string, ServerAnswer>;
  progress: ServerProblemRow | null;
}

export interface SubmitResult {
  report: GradeReport;
  hinted?: HintedScore;
  progress: ServerProblemRow;
  repeated?: boolean;
}

export interface LeaderboardRow {
  rank: number;
  /** null for a learner who hid their profile: the row stays, without a name or link. */
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
  xp: number;
  solved: number | null;
}

export interface ProblemStats {
  solves: number;
  problems: Record<string, { tried: number; solvers: number; acceptance: number | null }>;
}

export interface SubmissionSummary {
  id: string;
  slug: string;
  kind: 'network' | 'predict';
  source: 'submit' | 'import';
  passed: boolean;
  score: number;
  rawScore: number;
  max: number;
  engineVersion: string;
  at: number;
}

/** GET /users/:handle (server/routes/profiles.ts). */
export interface PublicProfile {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  memberSince: string;
  xp: number;
  level: Level;
  rank: number | null;
  solvedCount: number;
  problemCount: number;
  byDifficulty: { difficulty: 'easy' | 'medium' | 'hard'; solved: number; total: number }[];
  byTopic: { topic: string; solved: number; total: number }[];
  solved: { slug: string; title: string; difficulty: 'easy' | 'medium' | 'hard'; topic: string; day: string }[];
  /** Graded submits plus finished drill sets per UTC day, last 365 days; days without activity are left out. */
  activity: { day: string; n: number }[];
}

/** GET /me/profile: the owner's own view. */
export interface OwnProfile {
  profile: PublicProfile;
  visibility: 'public' | 'hidden';
  private: {
    submits: number;
    failedSubmits: number;
    acceptance: number | null;
    hintsUsed: number;
    solutionsOpened: number;
    unsolved: { slug: string; title: string; topic: string }[];
    xpByDay: { day: string; problem: number; practice: number }[];
    practice: { kind: string; sets: number; correct: number; xp: number; answered: number }[];
  };
}
