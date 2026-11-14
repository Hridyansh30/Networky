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
  handle: string;
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
