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

/**
 * Applies the migrations/*.sql files that have not run yet, in name order,
 * and records each in `_migrations`. A local dev database made before phase 7
 * has 0001 but no record of it; that case is recognised by its users table.
 * (Production D1 runs each file once by hand: docs/server-setup.md.)
 */
export function migrate(db: SqliteDb, dir = join(import.meta.dirname, '..', '..', 'migrations')): string[] {
  db.raw.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set((db.raw.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name));
  if (!applied.size && db.raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) {
    db.raw.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run('0001_init.sql', Date.now());
    applied.add('0001_init.sql');
  }
  const ran: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    if (applied.has(f)) continue;
    db.raw.exec('BEGIN');
    try {
      db.raw.exec(readFileSync(join(dir, f), 'utf8'));
      db.raw.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
      db.raw.exec('COMMIT');
    } catch (e) {
      db.raw.exec('ROLLBACK');
      throw new Error(`migration ${f} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    ran.push(f);
  }
  return ran;
}

/** A fresh in-memory database with the schema applied. */
export function testDb(): SqliteDb {
  const db = new SqliteDb();
  migrate(db);
  return db;
}
