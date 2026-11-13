// Turning a problem with {{placeholders}} into one concrete variant.
//
// A randomized problem writes its statement, hints and test params with
// placeholders like {{lan}} or {{vlan.staff}}; `params(rng)` decides the
// values for one seed. Substitution is plain text replacement from an
// allow-list of keys: no expressions, no templates that run code, nothing
// evaluated. An unknown key is an author bug and throws.

import type { CheckCall, TestCase } from '../grading/types';
import { rng } from './random';
import type { Params, ProblemSpec } from './spec';

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_.]{0,40})\s*\}\}/g;
const WHOLE = /^\{\{\s*([A-Za-z][A-Za-z0-9_.]{0,40})\s*\}\}$/;

export function fill(text: string, params: Params): string {
  return text.replace(PLACEHOLDER, (_, key: string) => {
    if (!Object.hasOwn(params, key)) throw new Error(`unknown placeholder {{${key}}}`);
    return String(params[key]);
  });
}

/** Fill every string inside a check's params. A string that is ONLY a placeholder keeps the value's type (a VLAN number stays a number). */
function fillValue(v: unknown, params: Params): unknown {
  if (typeof v === 'string') {
    const whole = WHOLE.exec(v);
    if (whole) {
      if (!Object.hasOwn(params, whole[1])) throw new Error(`unknown placeholder {{${whole[1]}}}`);
      return params[whole[1]];
    }
    return fill(v, params);
  }
  if (Array.isArray(v)) return v.map((x) => fillValue(x, params));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillValue(x, params)]));
  return v;
}

const fillCheck = (c: CheckCall, params: Params): CheckCall => ({ kind: c.kind, params: fillValue(c.params, params) });

/**
 * The concrete problem for one seed: placeholders filled, networks built for
 * these values. Problems without `params` come back unchanged (seed ignored).
 */
export function instantiate(spec: ProblemSpec, seed?: number): ProblemSpec & { seed?: number; values: Params } {
  if (!spec.params) return { ...spec, values: {} };
  if (seed === undefined) throw new Error(`${spec.slug} is randomized: it needs a seed`);
  const values = spec.params(rng(seed));
  return {
    ...spec,
    params: undefined,
    seed,
    values,
    statement: fill(spec.statement, values),
    requirements: spec.requirements.map((r) => ({ ...r, text: fill(r.text, values), hints: r.hints.map((h) => fill(h, values)) as [string, string, string] })),
    tests: spec.tests.map((t): TestCase => ({ ...t, check: fillCheck(t.check, values) })),
    start: () => spec.start(values),
    reference: () => spec.reference(values),
    wrong: spec.wrong.map((w) => () => w(values)),
  };
}
