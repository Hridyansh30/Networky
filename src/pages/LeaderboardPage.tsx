import { useEffect, useState } from 'react';
import { href } from '../app/router';
import { useApi } from '../api/useApi';
import type { LeaderboardRow } from '../api/types';
import { useAccountStore } from '../store/accountStore';
import { TopNav } from '../ui/TopNav';

type Period = 'all' | 'week';

/**
 * The leaderboard. Every number on it was computed by the server from
 * graded submissions; nothing here came from a browser saying "I solved it".
 */
export function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>('all');
  const [page, setPage] = useState(0);
  const board = useApi<{ rows: LeaderboardRow[] }>(`/leaderboard?period=${period}&page=${page}`);
  const status = useAccountStore((s) => s.status);
  const me = useAccountStore((s) => s.me);
  useEffect(() => {
    if (useAccountStore.getState().status === 'signed-in') void useAccountStore.getState().refresh().catch(() => {});
  }, []);

  return (
    <div className="page">
      <TopNav />
      <main className="board-layout">
        <header className="board-head">
          <div>
            <p className="eyebrow">Ranked by XP</p>
            <h1>Leaderboard</h1>
            <p className="muted">
              XP comes from solved problems: easy 10, medium 20, hard 40, less for hints. Every solve was graded again on the server. Ties go to whoever got there first.
            </p>
          </div>
          <div className="seg" role="tablist" aria-label="Period">
            {(['all', 'week'] as const).map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={period === p}
                className={period === p ? 'active' : ''}
                onClick={() => {
                  setPeriod(p);
                  setPage(0);
                }}
              >
                {p === 'all' ? 'All time' : 'This week'}
              </button>
            ))}
          </div>
        </header>

        {status === 'signed-in' && me?.stats && (
          <p className="board-you">
            You: <b>{me.stats.xp} XP</b>, {me.rank ? <>rank <b>#{me.rank}</b> all time</> : 'not ranked until your first solve'}.
          </p>
        )}
        {status === 'guest' && <p className="board-you muted">Sign in to appear here. Progress made in this browser can be brought along once.</p>}

        {board.state === 'off' && <p className="muted pad">The leaderboard needs the Networky server, and this copy has none. Progress stays in this browser.</p>}
        {board.state === 'loading' && <p className="muted pad">Loading…</p>}
        {board.state === 'error' && <p className="callout error">{board.message}</p>}
        {board.state === 'ok' && (
          <>
            <div className="problem-table-wrap">
              <table className="problem-table board-table">
                <thead>
                  <tr>
                    <th className="num">Rank</th>
                    <th>Learner</th>
                    <th className="num">XP</th>
                    {period === 'all' && <th className="num">Solved</th>}
                  </tr>
                </thead>
                <tbody>
                  {board.data.rows.map((r) => (
                    <tr key={r.handle} className={me?.user?.handle === r.handle ? 'is-you' : ''}>
                      <td className="num">{r.rank}</td>
                      <td>
                        <span className="board-who">
                          {r.avatarUrl ? <img src={r.avatarUrl} alt="" width={24} height={24} loading="lazy" referrerPolicy="no-referrer" /> : <span className="account-initial sm">{r.handle.slice(0, 1).toUpperCase()}</span>}
                          <b>{r.displayName}</b> <span className="muted">@{r.handle}</span>
                        </span>
                      </td>
                      <td className="num">{r.xp}</td>
                      {period === 'all' && <td className="num">{r.solved}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!board.data.rows.length && (
                <p className="muted pad">
                  {page > 0 ? 'No more learners.' : period === 'week' ? 'Nobody has earned XP this week yet.' : 'Nobody has solved a problem yet.'}{' '}
                  <a href={href({ page: 'problems' })}>Be the first.</a>
                </p>
              )}
            </div>
            <div className="board-pages">
              <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button className="btn sm" disabled={board.data.rows.length < 50} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
