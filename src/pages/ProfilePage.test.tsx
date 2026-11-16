// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicProfile } from '../api/types';
import { resetAccountStore } from '../store/accountStore';
import { ActivityCalendar, ProfilePage } from './ProfilePage';

const profile: PublicProfile = {
  handle: 'ada',
  displayName: 'Ada',
  avatarUrl: null,
  memberSince: '2026-11-01',
  xp: 30,
  level: { level: 1, into: 30, span: 50 },
  rank: 3,
  solvedCount: 2,
  problemCount: 36,
  byDifficulty: [{ difficulty: 'easy', solved: 2, total: 15 }],
  byTopic: [{ topic: 'Routing', solved: 1, total: 9 }],
  solved: [{ slug: 'first-ping', title: 'Your first ping', difficulty: 'easy', topic: 'IP Addressing', day: '2026-11-02' }],
  activity: [{ day: '2026-11-02', n: 3 }],
};

function server(routes: Record<string, () => Response>) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://x').pathname.replace('/api/v1', '');
    const f = routes[path];
    return Promise.resolve(f ? f() : new Response(JSON.stringify({ error: 'not_found', message: 'No.' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
  });
}
const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Engine-Version': '2' } });
const meta = json({ engineVersion: '2', problemCount: 36, ready: true, signIn: { github: true, dev: false } });
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

beforeEach(() => resetAccountStore());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Profile page', () => {
  it("someone else's profile: the public half only", async () => {
    server({ '/meta': meta, '/me': json({ user: null }), '/users/ada': json({ profile }) });
    render(<ProfilePage handle="ada" />);
    await settle();
    await settle();
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeTruthy();
    expect(screen.getByText('#3')).toBeTruthy();
    expect(screen.getByText('Your first ping')).toBeTruthy();
    expect(screen.queryByText('Only you can see this')).toBeNull();
  });

  it('a hidden or unknown handle reads as not found', async () => {
    server({ '/meta': meta, '/me': json({ user: null }) });
    render(<ProfilePage handle="ghost" />);
    await settle();
    await settle();
    expect(screen.getByText(/No public profile called @ghost/)).toBeTruthy();
  });

  it('the calendar counts only days, and says so', () => {
    render(<ActivityCalendar activity={[{ day: '2026-11-02', n: 3 }]} today={Date.UTC(2026, 10, 16, 15)} />);
    expect(screen.getByText(/3 graded submits and drill sets in the last year. Days are UTC./)).toBeTruthy();
    expect(screen.getByText('2026-11-02: 3 activities')).toBeTruthy();
    expect(document.querySelectorAll('rect')).toHaveLength(53 * 7 - 6); // 52 full weeks plus this week's Monday
  });
});
