// What a problem is.
//
// Built-in problems are TypeScript modules (like model/examples.ts), because
// their start network, reference solution and wrong solutions are code that
// builds topologies. validateSpec() checks everything that can be checked
// without running the network, and the problem tests run the rest.

import { z } from 'zod';
import type { CheckRegistry } from '../grading/checks';
import type { TestCase, Visibility } from '../grading/types';
import type { Topology } from '../model/types';

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
  requirements: Requirement[];
  tests: TestCase[];
  /** The network the learner opens. */
  start(): Topology;
  /** A solution that must score 100%. */
  reference(): Topology;
  /** Plausible wrong solutions; each must fail at least one test. */
  wrong: (() => Topology)[];
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
    requirements: z
      .array(z.object({ id, text: z.string().min(1).max(300), hints: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]) }).strict())
      .min(1)
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
      .min(1)
      .max(60),
  })
  .passthrough();

/** Every problem in a spec, as a list of messages. Empty = valid. */
export function validateSpec(spec: ProblemSpec, checks: CheckRegistry): string[] {
  const errors: string[] = [];
  const parsed = staticPart.safeParse(spec);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
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
