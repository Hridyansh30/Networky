// The sample labs' exercises (model/examples.ts) are ping and TCP tests with
// an expected outcome, which is exactly what the reach and tcp checks are.
// This keeps the 10 existing labs working on the new grader.
import type { TestCase } from '../grading/types';
import type { Exercise } from '../model/examples';

export function exerciseToTest(x: Exercise, index: number, requirement = 'exercises'): TestCase {
  const id = `exercise-${index + 1}`;
  if (x.kind === 'tcp') return { id, requirement, points: 1, check: { kind: 'tcp', params: { from: x.from, to: x.to, port: x.port ?? 80, expect: x.expect } } };
  return { id, requirement, points: 1, check: { kind: 'reach', params: { from: x.from, to: x.to, expect: x.expect } } };
}
