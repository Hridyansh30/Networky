// The slice of Cloudflare D1's API the server uses, written out here so the
// server depends on an interface, not on Cloudflare.
//
//   production: the real D1 binding (env.DB) already has this shape.
//   tests and local dev: server/db/sqlite.ts implements it on node:sqlite.
//
// Two D1 facts shape every query in this folder:
//   - There are no interactive transactions (no BEGIN ... COMMIT across
//     awaits). db.batch([...]) is the unit of atomicity: all statements
//     commit together or none do.
//   - Statements in a batch run in order, so a later statement can read
//     what an earlier one wrote.

export type SqlValue = string | number | null;

export interface RunResult {
  meta: { changes: number };
}

export interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<RunResult>;
}

export interface Db {
  prepare(sql: string): Statement;
  /** Runs every statement in order inside one transaction. */
  batch(statements: Statement[]): Promise<RunResult[]>;
}
