import { describe, expect, it } from 'vitest';
import { emptyProgress, type ProblemProgress } from '../storage/progressRepository';
import { PROBLEMS, TRACKS } from './catalog';
import { continueWith, learnerStats, statusOf, trackProgress } from './stats';

const row = (slug: string, patch: Partial<ProblemProgress> = {}): ProblemProgress => ({ ...emptyProgress(slug, 1), ...patch });

describe('learner stats', () => {
  it('starts at zero with the real totals', () => {
    const s = learnerStats({}, PROBLEMS);
    expect(s.solved).toBe(0);
    expect(s.total).toBe(PROBLEMS.length);
    expect(s.byDifficulty.easy.total + s.byDifficulty.medium.total + s.byDifficulty.hard.total).toBe(PROBLEMS.length);
    expect(s.xp).toBe(0);
    expect(s.level.level).toBe(1);
  });

  it('counts solves and XP, ignoring rows for problems that do not exist', () => {
    const s = learnerStats({ 'first-ping': row('first-ping', { solved: true, best: 1 }), 'static-routes': row('static-routes', { solved: true, best: 0.5 }), fake: row('fake', { solved: true, best: 1 }) }, PROBLEMS);
    expect(s.solved).toBe(2);
    expect(s.xp).toBe(10 + 10);
    expect(s.byDifficulty.medium.solved).toBe(1);
  });

  it('gives no XP for an unsolved problem, whatever its stored best says', () => {
    expect(learnerStats({ 'first-ping': row('first-ping', { solved: false, best: 1 }) }, PROBLEMS).xp).toBe(0);
  });

  it('tells solved, attempted and untouched apart', () => {
    const p = { a: row('a', { solved: true }), b: row('b', { submits: 1 }), c: row('c') };
    expect([statusOf(p, 'a'), statusOf(p, 'b'), statusOf(p, 'c'), statusOf(p, 'd')]).toEqual(['solved', 'attempted', 'todo', 'todo']);
  });

  it('follows a track and suggests its first unsolved problem', () => {
    const t = TRACKS[0];
    expect(trackProgress({ [t.slugs[0]]: row(t.slugs[0], { solved: true }) }, t)).toEqual({ solved: 1, total: t.slugs.length, next: t.slugs[1] });
  });

  it('continues with the most recently touched unsolved problem', () => {
    const p = { 'first-ping': row('first-ping', { updatedAt: 5 }), 'wrong-vlan': row('wrong-vlan', { updatedAt: 9 }), 'static-routes': row('static-routes', { updatedAt: 20, solved: true }) };
    expect(continueWith(p, PROBLEMS)?.slug).toBe('wrong-vlan');
    expect(continueWith({}, PROBLEMS)).toBeUndefined();
  });
});
