// The quality bar every problem must clear, for every seed tested:
//   - the problem validates (ids, requirements, check params)
//   - the start network does NOT solve it (otherwise there is nothing to do)
//   - the reference solution scores 100%
//   - every wrong solution fails at least one test
// CI runs this on every problem; a randomized problem runs it on many seeds.
import { registry, type CheckRegistry } from '../grading/checks';
import { grade, solved } from '../grading/grade';
import { instantiate } from './params';
import { validateSpec, type ProblemSpec } from './spec';

export function verifyProblem(spec: ProblemSpec, seeds: readonly (number | undefined)[] = [undefined], checks: CheckRegistry = registry()): string[] {
  const problems: string[] = [];
  for (const seed of spec.params ? seeds.filter((s) => s !== undefined) : [undefined]) {
    const at = seed === undefined ? spec.slug : `${spec.slug} seed ${seed}`;
    let p;
    try {
      p = instantiate(spec, seed);
    } catch (e) {
      problems.push(`${at}: ${(e as Error).message}`);
      continue;
    }
    for (const e of validateSpec(p, checks)) problems.push(`${at}: ${e}`);
    if (problems.length) continue;
    if (solved(grade(p.start(p.values), p, { checks, seed }))) problems.push(`${at}: the start network already solves it`);
    const ref = grade(p.reference(p.values), p, { checks, seed });
    if (!solved(ref)) problems.push(`${at}: the reference scores ${ref.score}/${ref.max}: ${ref.tests.filter((t) => !t.pass).map((t) => `${t.id} (${t.detail})`).join('; ')}`);
    p.wrong.forEach((w, i) => {
      if (solved(grade(w(p.values), p, { checks, seed }))) problems.push(`${at}: wrong solution #${i + 1} passes every test; add a test that catches it`);
    });
  }
  return problems;
}
