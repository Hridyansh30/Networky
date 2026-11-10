import { describe, expect, it } from 'vitest';
import { smallLan } from '../model/testing';
import { MemoryRepository } from './projectRepository';

const file = () => ({ topology: smallLan().t, layout: { PC0: { x: 1, y: 2 } } });

describe('ProjectRepository contract (memory implementation)', () => {
  it('saves, lists newest first, loads back exactly', async () => {
    const repo = new MemoryRepository();
    const original = file();
    const a = await repo.save({ name: 'First', file: original });
    await new Promise((r) => setTimeout(r, 2));
    const b = await repo.save({ name: 'Second', file: file() });
    expect((await repo.list()).map((p) => p.id)).toEqual([b.id, a.id]);
    const got = await repo.get(a.id);
    expect(got?.file).toEqual(original);
    expect(got?.deviceCount).toBe(3);
  });

  it('updates in place, keeps the star, renames, deletes', async () => {
    const repo = new MemoryRepository();
    const a = await repo.save({ name: 'Lab', file: file() });
    await repo.setStarred(a.id, true);
    await repo.save({ id: a.id, name: 'Lab v2', file: file() });
    expect(await repo.list()).toMatchObject([{ id: a.id, name: 'Lab v2', starred: true }]);
    await repo.rename(a.id, '  Renamed\u0000 ');
    expect((await repo.get(a.id))?.name).toBe('Renamed');
    await repo.delete(a.id);
    expect(await repo.list()).toEqual([]);
  });

  it('gives empty names a default and caps long ones', async () => {
    const repo = new MemoryRepository();
    expect((await repo.save({ name: '   ', file: file() })).name).toBe('Untitled');
    expect((await repo.save({ name: 'x'.repeat(500), file: file() })).name).toHaveLength(80);
  });
});
