// Drill practice saved in this browser: per drill kind, how many sets,
// answers and right answers, the best run of right answers, and the level
// reached. It is the learner's own record ("on this device"): it never
// reaches a board. Signed-in practice XP is counted by the server instead
// (server/routes/drills.ts).
//
// Its own IndexedDB database, like problem progress, so a bug here cannot
// touch anything else. Rows are validated on read: browser storage can be
// edited by hand.

import { z } from 'zod';

export interface DrillStats {
  kind: string;
  sets: number;
  answered: number;
  correct: number;
  /** Longest run of right answers in a row, across sets. */
  bestStreak: number;
  /** The level the last set ended on: where the next one starts. */
  level: 1 | 2 | 3;
  updatedAt: number;
}

const count = z.number().int().min(0).max(10_000_000);
const schema = z
  .object({
    kind: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
    sets: count,
    answered: count,
    correct: count,
    bestStreak: count,
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    updatedAt: z.number().int().min(0),
  })
  .strict()
  .refine((s) => s.correct <= s.answered, 'more right than answered');

export function parseDrillStats(row: unknown): DrillStats | null {
  const r = schema.safeParse(row);
  return r.success ? (r.data as DrillStats) : null;
}

export const emptyDrillStats = (kind: string, now: number): DrillStats => ({ kind, sets: 0, answered: 0, correct: 0, bestStreak: 0, level: 1, updatedAt: now });

export interface DrillRepository {
  all(): Promise<DrillStats[]>;
  put(stats: DrillStats): Promise<void>;
}

function checked(s: DrillStats): DrillStats {
  const ok = parseDrillStats(s);
  if (!ok) throw new Error('Refusing to save malformed drill stats');
  return ok;
}

export class MemoryDrills implements DrillRepository {
  private rows = new Map<string, unknown>();
  async all() {
    return [...this.rows.values()].map(parseDrillStats).filter((s): s is DrillStats => s !== null);
  }
  async put(s: DrillStats) {
    this.rows.set(s.kind, structuredClone(checked(s)));
  }
  /** Tests only: store anything, as a tampering script could. */
  putRaw(key: string, row: unknown) {
    this.rows.set(key, row);
  }
}

const DB = 'networky-drills';
const STORE = 'kinds';

export class IndexedDbDrills implements DrillRepository {
  private db: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB) {
    this.db = new Promise((resolve, reject) => {
      const req = factory.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'kind' });
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
    return rows.map(parseDrillStats).filter((s): s is DrillStats => s !== null);
  }
  async put(s: DrillStats) {
    const row = checked(s);
    await this.run('readwrite', (st) => st.put(row));
  }
}

export function createDrillRepository(): DrillRepository {
  try {
    if (typeof indexedDB !== 'undefined') return new IndexedDbDrills();
  } catch {
    /* fall through */
  }
  return new MemoryDrills();
}
