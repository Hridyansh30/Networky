import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, SqliteDb } from '../db/sqlite';

const dir = join(import.meta.dirname, '..', '..', 'migrations');

describe('local migrations', () => {
  it('a fresh database gets every file, once', () => {
    const db = new SqliteDb();
    expect(migrate(db)).toEqual(['0001_init.sql', '0002_phase7.sql']);
    expect(migrate(db)).toEqual([]);
  });

  it('a phase 6 dev database keeps its rows and gets only the new files', () => {
    const db = new SqliteDb();
    db.raw.exec(readFileSync(join(dir, '0001_init.sql'), 'utf8'));
    db.raw.exec("INSERT INTO users (id, handle, display_name, created_at) VALUES ('u1', 'ada', 'Ada', 0)");
    expect(migrate(db)).toEqual(['0002_phase7.sql']);
    expect(db.raw.prepare('SELECT handle, profile_visibility FROM users').get()).toEqual({ handle: 'ada', profile_visibility: 'public' });
  });
});
