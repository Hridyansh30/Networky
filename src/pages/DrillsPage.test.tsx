// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRILL_KINDS, SET_SIZE } from '../drills';
import { resetAccountStore } from '../store/accountStore';
import { MemoryDrills } from '../storage/drillRepository';
import { resetDrillStore, useDrillStore } from '../store/drillStore';
import { DrillSetPage, DrillsPage } from './DrillsPage';

let repo: MemoryDrills;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

beforeEach(() => {
  repo = new MemoryDrills();
  resetDrillStore(repo);
  resetAccountStore();
});
afterEach(cleanup);

describe('Drills page', () => {
  it('lists every drill kind, with no record until one is played', async () => {
    render(<DrillsPage />);
    await settle();
    for (const k of DRILL_KINDS) expect(screen.getByRole('heading', { name: k.title })).toBeTruthy();
    expect(screen.getAllByText('Not tried yet.')).toHaveLength(DRILL_KINDS.length);
  });

  it('plays a whole set as a guest: right answers climb the levels, and the record is saved in this browser', async () => {
    render(<DrillSetPage kind="same-subnet" level={1} seed={12345} />);
    await settle();
    expect(screen.getByText(/practice only, no XP/)).toBeTruthy();
    for (let i = 0; i < SET_SIZE; i++) {
      const cur = useDrillStore.getState().question()!;
      expect(screen.getByText(`Question ${i + 1} of ${SET_SIZE} · Level ${cur.level}`)).toBeTruthy();
      if (cur.q.type !== 'choice') throw new Error('choice expected');
      fireEvent.click(screen.getByRole('button', { name: cur.q.expected.choice }));
      expect(screen.getByText('Right.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: i < SET_SIZE - 1 ? 'Next question' : 'Finish the set' }));
      await settle();
    }
    expect(screen.getByRole('heading', { name: `${SET_SIZE} of ${SET_SIZE} right` })).toBeTruthy();
    expect(screen.getByText('Levels: 1 → 1 → 1 → 2 → 2 → 2 → 3 → 3 → 3 → 3')).toBeTruthy();
    const [saved] = await repo.all();
    expect(saved).toMatchObject({ kind: 'same-subnet', sets: 1, answered: 10, correct: 10, bestStreak: 10, level: 3 });
  });

  it('shows the answer and why a typed answer could not be read', async () => {
    render(<DrillSetPage kind="subnet-range" level={1} seed={7} />);
    await settle();
    fireEvent.change(screen.getByLabelText('Network address'), { target: { value: '010.0.0.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('Not quite.')).toBeTruthy();
    expect(screen.getByText(/leading zeros/)).toBeTruthy();
  });

  it('ignores tampered records in browser storage', async () => {
    repo.putRaw('mask-cidr', { kind: 'mask-cidr', sets: 1, answered: 10, correct: 99, bestStreak: 1, level: 1, updatedAt: 0 });
    render(<DrillsPage />);
    await settle();
    expect(screen.getAllByText('Not tried yet.')).toHaveLength(DRILL_KINDS.length);
  });
});
