// Grading one answer. Pure: the same question and answer always give the
// same verdict, so the browser and the server agree.

import { parseField, parseIPv6Any } from './answers';
import type { CheckResult, DrillQuestion, FieldResult } from './types';

export function checkAnswer(q: DrillQuestion, answer: Readonly<Record<string, string>>): CheckResult {
  const fields: Record<string, FieldResult> = {};
  if (q.type === 'choice') {
    const given = answer.choice ?? '';
    fields.choice = { correct: given === q.expected.choice, expected: q.expected.choice };
    if (given && !q.choices.includes(given)) fields.choice.problem = 'Not one of the options.';
  } else {
    for (const f of q.fields) {
      const expected = q.expected[f.id];
      const parsed = parseField(f.format, answer[f.id] ?? '');
      if (!parsed.ok) {
        fields[f.id] = { correct: false, expected, problem: parsed.problem };
        continue;
      }
      if (f.format === 'ipv6') {
        // Shortening: the same address written differently is a near miss, worth saying so.
        const same = parseIPv6Any(parsed.value);
        const correct = parsed.value === expected;
        fields[f.id] = { correct, expected };
        if (!correct && same.ok && same.value === expected) fields[f.id].problem = 'Same address, but not the shortest standard form (RFC 5952).';
        continue;
      }
      fields[f.id] = { correct: parsed.value === expected, expected };
    }
  }
  return { correct: Object.values(fields).every((f) => f.correct), fields };
}
