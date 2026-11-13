import { describe, expect, it } from 'vitest';
import { registry } from '../../grading/checks';
import { instantiate } from '../params';
import { validateSpec } from '../spec';
import { verifyProblem } from '../verify';
import { dailyProblem, PROBLEMS, problemBySlug, TOPICS, TRACKS } from '.';

const checks = registry();
const SEEDS = Array.from({ length: 25 }, (_, i) => i * 7919 + 1);

describe('catalog', () => {
  it('has unique slugs that never collide', () => {
    expect(new Set(PROBLEMS.map((p) => p.slug)).size).toBe(PROBLEMS.length);
  });

  it('holds 36 problems: 15 easy, 14 medium, 7 hard, and every topic is used', () => {
    const count = (d: string) => PROBLEMS.filter((p) => p.difficulty === d).length;
    expect([PROBLEMS.length, count('easy'), count('medium'), count('hard')]).toEqual([36, 15, 14, 7]);
    expect(PROBLEMS.filter((p) => p.type === 'predict')).toHaveLength(6);
    for (const t of TOPICS) expect(PROBLEMS.some((p) => p.topic === t), t).toBe(true);
  });

  it('randomizes most hard problems and explains every problem', () => {
    expect(PROBLEMS.filter((p) => p.difficulty === 'hard' && p.params).length).toBeGreaterThanOrEqual(3);
    // A predict problem explains each question instead of having one solution text.
    for (const p of PROBLEMS) expect(p.type === 'predict' ? p.questions?.every((q) => q.explanation) : p.solution, p.slug).toBeTruthy();
  });

  it.each(PROBLEMS.map((p) => [p.slug, p] as const))('%s clears the quality bar', (_, p) => {
    expect(verifyProblem(p, SEEDS, checks)).toEqual([]);
  });

  it.each(PROBLEMS.map((p) => [p.slug, p] as const))('%s uses a known topic, lays out every start device, and fills every placeholder', (_, p) => {
    expect(TOPICS).toContain(p.topic);
    const v = instantiate(p, p.params ? 42 : undefined);
    expect(validateSpec(v, checks)).toEqual([]);
    const t = v.start(v.values);
    for (const id of Object.keys(t.devices)) {
      expect(id, 'device ids must be hostnames (Draft stableIds)').toBe(t.devices[id].hostname);
      expect(p.layout?.[id], `${id} has a position`).toBeDefined();
    }
    const text = [v.statement, ...v.requirements.flatMap((r) => [r.text, ...r.hints]), ...(v.questions ?? []).flatMap((q) => [q.prompt, q.explanation, q.traffic.to])].join('\n');
    expect(text).not.toMatch(/\{\{/);
  });

  it('puts every problem in exactly one track, and tracks only name real problems', () => {
    const inTracks = TRACKS.flatMap((t) => t.slugs);
    for (const s of inTracks) expect(problemBySlug(s), s).toBeDefined();
    expect([...inTracks].sort()).toEqual(PROBLEMS.map((p) => p.slug).sort());
  });

  it('picks the same daily problem all day and moves on the next day', () => {
    const a = dailyProblem(new Date(2026, 10, 12, 0, 1));
    expect(dailyProblem(new Date(2026, 10, 12, 23, 59)).slug).toBe(a.slug);
    const week = new Set(Array.from({ length: 14 }, (_, i) => dailyProblem(new Date(2026, 10, 12 + i)).slug));
    expect(week.size).toBeGreaterThan(1);
  });
});
