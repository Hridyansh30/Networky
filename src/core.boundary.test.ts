// The core is the code that both the browser and the phase 6 judge run:
// model, engine, grading, problems. For the two to give the same verdict it
// must be a pure function of its inputs, and for the judge to run it on
// Cloudflare Workers it must not touch the DOM or browser storage.
//
// This test walks the imports from the judge's entry points and fails if the
// core reaches outside its folders, imports a package other than the few it
// is allowed, or reads the clock or Math.random. A lint rule would do the
// same job; a test needs no new tool and runs in the CI we already have.

import { describe, expect, it } from 'vitest';

/** Every source file, by path relative to src/ (e.g. 'model/ops.ts'). Vite reads them at test time. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>).map(([k, v]) => [k.slice(2), v]),
);

/** Where the judge starts. Everything these import, transitively, is core. */
const ENTRY_POINTS = [
  'grading/gradeProblem.ts',
  'grading/hints.ts',
  'problems/catalog/index.ts',
  'problems/xp.ts',
  'problems/predict.ts',
  'problems/verify.ts',
  'model/serialize.ts',
];

/** Folders (and single files) the core may live in. */
const CORE = ['model/', 'engine/', 'grading/', 'problems/', 'apps/client.ts', 'apps/html.ts', 'zodConfig.ts'];

/** Browser glue inside core folders: allowed to exist, never reachable from an entry point. */
const BROWSER_ONLY = ['grading/gradeClient.ts', 'grading/worker.ts'];

const PACKAGES = new Set(['zod', 'immer']);

/** Things that make a result depend on when or where it ran. */
const IMPURE: [RegExp, string][] = [
  [/\bMath\.random\s*\(/, 'Math.random'],
  [/\bDate\.now\s*\(/, 'Date.now'],
  [/\bnew Date\s*\(\s*\)/, 'new Date() (reads the clock)'],
  [/\bperformance\.now\s*\(/, 'performance.now'],
  [/\b(window|document|localStorage|sessionStorage|indexedDB|navigator)\./, 'a browser global'],
];

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function importsOf(file: string): string[] {
  const code = SOURCES[file];
  const out: string[] = [];
  for (const m of code.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^'"]*?from\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)) {
    if (m[1]) continue; // `import type` is erased at build time
    out.push(m[2] ?? m[3]);
  }
  return out;
}

/** Joins a relative import onto the importing file's folder: ('a/b/c.ts', '../d') -> 'a/d'. */
function join(from: string, spec: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function resolveLocal(from: string, spec: string): string {
  const base = join(from, spec);
  const found = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((c) => c in SOURCES);
  if (!found) throw new Error(`cannot resolve ${spec} from ${from}`);
  return found;
}

function walk(): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [...ENTRY_POINTS];
  while (queue.length) {
    const f = queue.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    for (const spec of importsOf(f)) {
      if (spec.startsWith('.')) queue.push(resolveLocal(f, spec));
      else packages.set(spec, f);
    }
  }
  return { files, packages };
}

describe('the core (code the judge runs)', () => {
  const { files, packages } = walk();
  const rel = [...files];

  it('stays inside its folders', () => {
    const outside = rel.filter((f) => !CORE.some((c) => f === c || f.startsWith(c)));
    expect(outside).toEqual([]);
  });

  it('never reaches browser glue', () => {
    expect(rel.filter((f) => BROWSER_ONLY.includes(f))).toEqual([]);
  });

  it('imports only zod and immer', () => {
    const bad = [...packages].filter(([p]) => !PACKAGES.has(p)).map(([p, f]) => `${p} (in ${f})`);
    expect(bad).toEqual([]);
  });

  it('never reads the clock, Math.random or browser globals', () => {
    const found: string[] = [];
    for (const f of files) {
      const code = stripComments(SOURCES[f]);
      for (const [re, what] of IMPURE) if (re.test(code)) found.push(`${f}: ${what}`);
    }
    expect(found).toEqual([]);
  });

  it('is a real walk, not an empty one', () => {
    expect(rel).toContain('engine/simulation.ts');
    expect(rel).toContain('grading/grade.ts');
    expect(rel.length).toBeGreaterThan(40);
  });
});
