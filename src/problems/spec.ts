// What a problem is.
//
// Built-in problems are TypeScript modules (like model/examples.ts), because
// their start network, reference solution and wrong solutions are code that
// builds topologies. validateSpec() checks everything that can be checked
// without running the network, and the problem tests run the rest.

import { z } from 'zod';
import type { CheckRegistry } from '../grading/checks';
import type { TestCase, Visibility } from '../grading/types';
import type { Layout, Topology } from '../model/types';
import type { PredictQuestion } from './predict';
import type { Rng } from './random';

/** The values one variant of a randomized problem uses, by placeholder key. */
export type Params = Readonly<Record<string, string | number>>;

export type Difficulty = 'easy' | 'medium' | 'hard';
export type ProblemType = 'configure' | 'troubleshoot' | 'predict';

export interface Requirement {
  id: string;
  /** What the learner must achieve, in one sentence. */
  text: string;
  /** Three hints, from the concept to the exact command (see M3). */
  hints: [string, string, string];
}

export interface ProblemSpec {
  /** URL id. Never rename one: progress and links use it. */
  slug: string;
  /** Bump whenever tests change, so old verdicts are never silently reinterpreted. */
  version: number;
  title: string;
  topic: string;
  difficulty: Difficulty;
  type: ProblemType;
  /** Plain text. Rendered as text, never as HTML. */
  statement: string;
  /** Empty for predict problems. */
  requirements: Requirement[];
  /** Empty for predict problems. */
  tests: TestCase[];
  /**
   * Predict problems only: the questions asked about the start network.
   * Their text and traffic may use {{key}} placeholders like everything else.
   */
  questions?: PredictQuestion[];
  /**
   * Randomized problems only: the values for one seed. Statement, hints and
   * test params may then use {{key}} placeholders (see params.ts).
   */
  params?: (rng: Rng) => Params;
  /** The network the learner opens. Built with Draft({ stableIds: true }), so device ids are hostnames. */
  start(p: Params): Topology;
  /** Where each start device sits on the canvas, by device id (= hostname). The same for every variant. */
  layout?: Layout;
  /** Plain text: how the reference solves it and why. Shown only when the solution is unlocked. */
  solution?: string;
  /** A solution that must score 100%. */
  reference(p: Params): Topology;
  /** Plausible wrong solutions; each must fail at least one test. */
  wrong: ((p: Params) => Topology)[];
}

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'lower-case letters, digits and dashes');

const staticPart = z
  .object({
    slug: id,
    version: z.number().int().min(1),
    title: z.string().min(1).max(120),
    topic: z.string().min(1).max(40),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    type: z.enum(['configure', 'troubleshoot', 'predict']),
    statement: z.string().min(1).max(4000),
    solution: z.string().min(1).max(4000).optional(),
    requirements: z
      .array(z.object({ id, text: z.string().min(1).max(300), hints: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]) }).strict())
      .max(20),
    tests: z
      .array(
        z
          .object({
            id,
            requirement: id,
            points: z.number().int().min(1).max(100),
            visibility: z.enum(['shown', 'hidden']).optional(),
            check: z.object({ kind: z.string(), params: z.unknown() }).strict(),
          })
          .strict(),
      )
      .max(60),
    questions: z
      .array(
        z
          .object({
            id,
            prompt: z.string().min(1).max(400),
            traffic: z.union([z.object({ kind: z.literal('ping'), from: z.string().min(1).max(64), to: z.string().min(1).max(45) }).strict(), z.object({ kind: z.literal('tcp'), from: z.string().min(1).max(64), to: z.string().min(1).max(45), port: z.number().int().min(1).max(65535) }).strict()]),
            choices: z.array(z.enum(['success', 'refused', 'unreachable', 'prohibited', 'ttl-exceeded', 'lost'])).min(2).max(6),
            explanation: z.string().min(1).max(1500),
          })
          .strict(),
      )
      .max(10)
      .optional(),
  })
  .passthrough();

/**
 * Every problem in a spec, as a list of messages. Empty = valid. Pass a
 * concrete variant (params.ts instantiate) for randomized problems, so the
 * filled-in test params are what gets checked.
 */
export function validateSpec(spec: ProblemSpec, checks: CheckRegistry): string[] {
  const errors: string[] = [];
  const parsed = staticPart.safeParse(spec);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  if (spec.type === 'predict') {
    // A predict problem asks questions instead of running tests.
    const qs = spec.questions ?? [];
    if (!qs.length) errors.push('a predict problem needs at least one question');
    if (new Set(qs.map((q) => q.id)).size !== qs.length) errors.push('question ids repeat');
    for (const q of qs) if (new Set(q.choices).size !== q.choices.length) errors.push(`question ${q.id}: a choice repeats`);
    if (spec.tests.length || spec.requirements.length) errors.push('a predict problem has questions, not tests or requirements');
    return errors;
  }
  if (spec.questions) errors.push('only predict problems have questions');
  if (!spec.requirements.length) errors.push('no requirements');
  if (!spec.tests.length) errors.push('no tests');
  const reqIds = new Set(spec.requirements.map((r) => r.id));
  if (reqIds.size !== spec.requirements.length) errors.push('requirement ids repeat');
  const testIds = new Set(spec.tests.map((t) => t.id));
  if (testIds.size !== spec.tests.length) errors.push('test ids repeat');
  for (const t of spec.tests) {
    if (!reqIds.has(t.requirement)) errors.push(`test ${t.id}: unknown requirement '${t.requirement}'`);
    const check = checks.get(t.check.kind);
    if (!check) {
      errors.push(`test ${t.id}: unknown check kind '${t.check.kind}'`);
      continue;
    }
    const p = check.schema.safeParse(t.check.params);
    if (!p.success) errors.push(`test ${t.id}: ${p.error.issues.map((i) => `${i.path.join('.') || 'params'} ${i.message}`).join('; ')}`);
  }
  for (const r of spec.requirements) if (!spec.tests.some((t) => t.requirement === r.id)) errors.push(`requirement ${r.id} has no test`);
  if (!spec.tests.some((t) => visibilityOf(t, spec.difficulty, checks) === 'shown')) errors.push('no test is shown: the Run button would have nothing to run');
  return errors;
}

/**
 * Tests fade as difficulty rises (the plan's "faded scaffolding"):
 *   easy    every test is shown, settings included
 *   medium  behaviour tests are shown, configuration tests are hidden
 *   hard    everything is hidden unless the problem marks a test 'shown'
 * A test's own `visibility` always wins.
 */
export function visibilityOf(test: TestCase, difficulty: Difficulty, checks: CheckRegistry): Visibility {
  if (test.visibility) return test.visibility;
  if (difficulty === 'easy') return 'shown';
  if (difficulty === 'medium') return checks.get(test.check.kind)?.behaviour ? 'shown' : 'hidden';
  return 'hidden';
}

/** What an author writes for a predict problem; the rest of ProblemSpec is filled in. */
export type PredictSpec = Omit<ProblemSpec, 'type' | 'requirements' | 'tests' | 'reference' | 'wrong' | 'questions' | 'solution'> & { questions: PredictQuestion[] };

/**
 * A predict problem: a finished network and questions about what traffic on
 * it will do. There is nothing to configure, so there are no tests, no
 * reference and no wrong solutions; verifyProblem checks the questions
 * instead (every real outcome must be among the choices offered).
 */
export function predictProblem(p: PredictSpec): ProblemSpec {
  return { ...p, type: 'predict', requirements: [], tests: [], reference: p.start, wrong: [] };
}
