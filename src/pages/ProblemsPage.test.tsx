// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROBLEMS } from '../problems/catalog';
import { emptyProgress, MemoryProgress } from '../storage/progressRepository';
import { resetProblemStore, useProblemStore } from '../store/problemStore';
import { ProblemsPage } from './ProblemsPage';

let repo: MemoryProgress;

beforeEach(() => {
  repo = new MemoryProgress();
  resetProblemStore(repo);
  location.hash = '#/problems';
});
afterEach(cleanup);

async function renderPage() {
  render(<ProblemsPage />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const rows = () => screen.getAllByRole('row').slice(1); // minus the header

describe('Problems page', () => {
  it('lists every problem with the real count and nothing invented', async () => {
    await renderPage();
    expect(rows()).toHaveLength(PROBLEMS.length);
    expect(screen.getByText(`${PROBLEMS.length} problems so far. More are on the way.`)).toBeTruthy();
    // Cut until they are real (docs/deferred.md).
    for (const gone of ['Acceptance', 'Contests', 'Interview Prep', 'Upgrade', 'Discuss', 'Compete']) expect(screen.queryByText(new RegExp(gone))).toBeNull();
  });

  it('filters by topic chip, difficulty and search', async () => {
    await renderPage();
    fireEvent.click(within(screen.getByRole('group', { name: 'Topic' })).getByRole('button', { name: 'Routing' }));
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Route between two sites')]);
    fireEvent.click(within(screen.getByRole('group', { name: 'Topic' })).getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'hard' } });
    expect(rows()).toHaveLength(PROBLEMS.filter((p) => p.difficulty === 'hard').length);
    fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'vlan' } });
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Same subnet, no ping')]);
    fireEvent.change(screen.getByLabelText('Search problems'), { target: { value: 'zzz' } });
    expect(screen.getByText('No problems match those filters.')).toBeTruthy();
  });

  it('shows saved progress: solved status, the ring and XP', async () => {
    await repo.put({ ...emptyProgress('first-ping', 1), solved: true, best: 1 });
    await renderPage();
    const row = rows().find((r) => r.textContent?.includes('Your first ping'))!;
    expect(within(row).getByText('Solved')).toBeTruthy();
    expect(screen.getByRole('img', { name: `1 of ${PROBLEMS.length} problems solved` })).toBeTruthy();
    expect(screen.getByText('10 XP')).toBeTruthy();
    expect(useProblemStore.getState().loaded).toBe(true);
  });

  it('Random opens an unsolved problem', async () => {
    for (const p of PROBLEMS.slice(1)) await repo.put({ ...emptyProgress(p.slug, 1), solved: true, best: 1 });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Random/ }));
    expect(location.hash).toBe(`#/problems/${PROBLEMS[0].slug}`);
  });

  it('Ctrl+K focuses the search', async () => {
    await renderPage();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText('Search problems'));
  });
});
