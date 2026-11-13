import { describe, expect, it } from 'vitest';
import { emptyProgress, MemoryProgress, parseProgress } from './progressRepository';

describe('progress repository', () => {
  it('saves and reads back progress', async () => {
    const repo = new MemoryProgress();
    const p = { ...emptyProgress('first-ping', 1), hints: { reach: 1 }, best: 0.75, solved: true, submits: 2 };
    await repo.put(p);
    expect(await repo.get('first-ping')).toEqual(p);
    expect(await repo.all()).toHaveLength(1);
    await repo.delete('first-ping');
    expect(await repo.get('first-ping')).toBeNull();
  });

  it('drops tampered or malformed rows instead of trusting them', async () => {
    const repo = new MemoryProgress();
    repo.putRaw('a', { ...emptyProgress('a', 1), best: 5 }); // best above 1 = invented XP
    repo.putRaw('b', { ...emptyProgress('b', 1), hints: { r: 9 } });
    repo.putRaw('c', { ...emptyProgress('c', 1), extra: '<script>' });
    repo.putRaw('d', 'not an object');
    repo.putRaw('e', emptyProgress('e', 1));
    expect((await repo.all()).map((p) => p.slug)).toEqual(['e']);
    expect(await repo.get('a')).toBeNull();
  });

  it('refuses to save malformed progress', async () => {
    await expect(new MemoryProgress().put({ ...emptyProgress('x', 1), slug: '../etc' })).rejects.toThrow(/malformed/);
  });

  it('accepts a full valid row', () => {
    expect(parseProgress({ ...emptyProgress('x', 2), seed: 7, attempt: '{}', last: { score: 3, max: 4 } })).not.toBeNull();
  });
});
