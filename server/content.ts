// Which problems the server knows, and the parts of them a client may see.
//
// Today every problem is "open": its full spec (hidden tests, reference,
// hints) is in the public repo and the web bundle, by the decision recorded
// in the phase 6 design. Problems written from now on can be "private": their
// secret parts live in a private repo that only the server build includes
// (see server/privateContent.ts and docs/judge.md).

import { PROBLEMS, problemBySlug } from '../src/problems/catalog';
import { instantiate } from '../src/problems/params';
import type { Difficulty, ProblemSpec } from '../src/problems/spec';
import { XP_BY_DIFFICULTY } from '../src/problems/xp';
import { CONTENT_PACK, PRIVATE_PROBLEMS } from './privateContent';

export { CONTENT_PACK };

const PRIVATE = new Map(PRIVATE_PROBLEMS.map((p) => [p.slug, p]));

/** Every problem the judge grades: open ones from the catalog, private ones merged over their public part. */
export function judgeProblem(slug: string): ProblemSpec | undefined {
  return PRIVATE.get(slug) ?? problemBySlug(slug);
}

export function allJudgeProblems(): readonly ProblemSpec[] {
  return [...PROBLEMS.filter((p) => !PRIVATE.has(p.slug)), ...PRIVATE_PROBLEMS];
}

export type Variant = ReturnType<typeof instantiate>;

export function variantOf(spec: ProblemSpec, seed: number | null): Variant {
  return instantiate(spec, seed ?? undefined);
}

export const xpBase = (d: Difficulty) => XP_BY_DIFFICULTY[d];
export const isPredict = (spec: ProblemSpec) => spec.type === 'predict';
