// A D1-shaped database on Node's built-in SQLite, for tests and the local dev
// server. D1 is SQLite underneath, so the same SQL runs on both; this file
// only adapts the calling convention (D1 is async, node:sqlite is sync) and
// gives batch() the same all-or-nothing behaviour as D1.
//
// Node-only: never imported by server/worker.ts.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db, RunResult, SqlValue, Statement } from './types';

class SqliteStatement implements Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly values: SqlValue[] = [],
  ) {}

  bind(...values: SqlValue[]): Statement {
    return new SqliteStatement(this.db, this.sql, values);
  }

  runSync(): RunResult {
    const r = this.db.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(r.changes) } };
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }

  async run(): Promise<RunResult> {
    return this.runSync();
  }
}

export class SqliteDb implements Db {
  readonly raw: DatabaseSync;

  constructor(path = ':memory:') {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql: string): Statement {
    return new SqliteStatement(this.raw, sql);
  }

  async batch(statements: Statement[]): Promise<RunResult[]> {
    this.raw.exec('BEGIN');
    try {
      const out = statements.map((s) => (s as SqliteStatement).runSync());
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
}

/** Applies every migrations/*.sql file in name order, like `wrangler d1 migrations apply`. */
export function migrate(db: SqliteDb, dir = join(import.meta.dirname, '..', '..', 'migrations')): void {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) db.raw.exec(readFileSync(join(dir, f), 'utf8'));
}

/** A fresh in-memory database with the schema applied. */
export function testDb(): SqliteDb {
  const db = new SqliteDb();
  migrate(db);
  return db;
}
