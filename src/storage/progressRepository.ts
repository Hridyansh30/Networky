// Where a learner's problem progress is saved: the network they are working
// on, hints unlocked, best score, solved or not.
//
// Same repository pattern as projects (projectRepository.ts), and a separate
// IndexedDB database, so a bug in one can never corrupt the other:
//
//   today:  IndexedDbProgress, in the browser
//   tests:  MemoryProgress
//   phase 6: an HTTP repository behind accounts, same interface
//
// Everything read back is validated with zod and the saved network goes
// through deserialize() when it is opened. Browser storage can be edited by
// other scripts or by hand, so a bad row is dropped, never trusted.

import { z } from 'zod';

export interface ProblemProgress {
  slug: string;
  /** The problem version this attempt was made against. */
  specVersion: number;
  /** Randomized problems: the variant being worked on. */
  seed?: number;
  /** The learner's network as a .networky.json string. */
  attempt?: string;
  /** Hints unlocked per requirement id. */
  hints: Record<string, number>;
  /** Best hinted score ever, as a fraction 0..1. Never goes down. */
  best: number;
  solved: boolean;
  /** The solution was opened before the first solve (no XP). */
  solutionFirst: boolean;
  solutionOpened: boolean;
  submits: number;
  failedSubmits: number;
  /**
   * Predict problems: the outcome chosen per question id in the current
   * attempt. An answer is final once given (the explanation is shown).
   */
  answers?: Record<string, string>;
  /** Predict problems: the fraction right on the first complete attempt. This is what earns XP. */
  firstTry?: number;
  /** The last Submit's hinted score. */
  last?: { score: number; max: number };
  updatedAt: number;
}

const MAX_ATTEMPT_BYTES = 2_000_000;
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const count = z.number().int().min(0).max(1_000_000);

const schema = z
  .object({
    slug,
    specVersion: z.number().int().min(1),
    seed: z.number().int().min(0).max(0xffffffff).optional(),
    attempt: z.string().max(MAX_ATTEMPT_BYTES).optional(),
    hints: z.record(z.string().max(64), z.number().int().min(0).max(3)).refine((h) => Object.keys(h).length <= 50),
    best: z.number().min(0).max(1),
    solved: z.boolean(),
    solutionFirst: z.boolean(),
    solutionOpened: z.boolean(),
    submits: count,
    failedSubmits: count,
    answers: z
      .record(z.string().max(64), z.enum(['success', 'refused', 'unreachable', 'prohibited', 'ttl-exceeded', 'lost']))
      .refine((a) => Object.keys(a).length <= 20)
      .optional(),
    firstTry: z.number().min(0).max(1).optional(),
    last: z.object({ score: count, max: count }).strict().optional(),
    updatedAt: z.number().int().min(0),
  })
  .strict();

/** A stored row, or null when it is malformed (then it is ignored). */
export function parseProgress(row: unknown): ProblemProgress | null {
  const r = schema.safeParse(row);
  return r.success ? (r.data as ProblemProgress) : null;
}

export function emptyProgress(slug: string, specVersion: number): ProblemProgress {
  return { slug, specVersion, hints: {}, best: 0, solved: false, solutionFirst: false, solutionOpened: false, submits: 0, failedSubmits: 0, updatedAt: Date.now() };
}

export interface ProgressRepository {
  all(): Promise<ProblemProgress[]>;
  get(slug: string): Promise<ProblemProgress | null>;
  put(progress: ProblemProgress): Promise<void>;
  delete(slug: string): Promise<void>;
}

function checked(p: ProblemProgress): ProblemProgress {
  const ok = parseProgress(p);
  if (!ok) throw new Error('Refusing to save malformed progress');
  return ok;
}

export class MemoryProgress implements ProgressRepository {
  private rows = new Map<string, unknown>();
  async all() {
    return [...this.rows.values()].map(parseProgress).filter((p): p is ProblemProgress => p !== null);
  }
  async get(s: string) {
    return parseProgress(this.rows.get(s));
  }
  async put(p: ProblemProgress) {
    this.rows.set(p.slug, structuredClone(checked(p)));
  }
  async delete(s: string) {
    this.rows.delete(s);
  }
  /** Tests only: store anything, as a tampering script could. */
  putRaw(key: string, row: unknown) {
    this.rows.set(key, row);
  }
}

const DB = 'networky-progress';
const STORE = 'progress';

export class IndexedDbProgress implements ProgressRepository {
  private db: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB) {
    this.db = new Promise((resolve, reject) => {
      const req = factory.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slug' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const req = work(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async all() {
    const rows = await this.run('readonly', (s) => s.getAll() as IDBRequest<unknown[]>);
    return rows.map(parseProgress).filter((p): p is ProblemProgress => p !== null);
  }
  async get(s: string) {
    return parseProgress(await this.run('readonly', (st) => st.get(s) as IDBRequest<unknown>));
  }
  async put(p: ProblemProgress) {
    const row = checked(p);
    await this.run('readwrite', (s) => s.put(row));
  }
  async delete(s: string) {
    await this.run('readwrite', (st) => st.delete(s));
  }
}

export function createProgressRepository(): ProgressRepository {
  try {
    if (typeof indexedDB !== 'undefined') return new IndexedDbProgress();
  } catch {
    /* fall through */
  }
  return new MemoryProgress();
}
