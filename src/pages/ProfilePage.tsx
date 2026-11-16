import { useEffect, useState } from 'react';
import { href } from '../app/router';
import { api, ApiError } from '../api/client';
import type { OwnProfile, PublicProfile } from '../api/types';
import { drillKind } from '../drills';
import { useAccountStore } from '../store/accountStore';
import { TopNav } from '../ui/TopNav';
import { DifficultyPill } from './ProblemsPage';

type Load = { state: 'loading' } | { state: 'off' } | { state: 'missing' } | { state: 'error'; message: string } | { state: 'ok'; profile: PublicProfile; own: OwnProfile | null };

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The last 53 weeks as a grid, one square per UTC day, darker for more
 * activity. Only days are shown, never times: an hour-by-hour picture would
 * tell strangers when someone sleeps.
 */
export function ActivityCalendar({ activity, today }: { activity: PublicProfile['activity']; today: number }) {
  const counts = new Map(activity.map((a) => [a.day, a.n]));
  const end = today - (today % DAY);
  const endDow = (new Date(end).getUTCDay() + 6) % 7; // Monday = 0
  const start = end - (52 * 7 + endDow) * DAY;
  const cells: { day: string; n: number; col: number; row: number }[] = [];
  for (let t = start, i = 0; t <= end; t += DAY, i++) {
    const day = new Date(t).toISOString().slice(0, 10);
    cells.push({ day, n: counts.get(day) ?? 0, col: Math.floor(i / 7), row: i % 7 });
  }
  const max = Math.max(1, ...cells.map((c) => c.n));
  const shade = (n: number) => (n === 0 ? 0 : n <= max / 4 ? 1 : n <= max / 2 ? 2 : n <= (3 * max) / 4 ? 3 : 4);
  const total = activity.reduce((s, a) => s + a.n, 0);
  const months = cells.filter((c) => c.row === 0 && c.day.slice(8) <= '07');
  const size = 11;
  const gap = 3;
  return (
    <figure className="calendar">
      <svg viewBox={`0 0 ${53 * (size + gap) + 30} ${7 * (size + gap) + 18}`} role="img" aria-label={`${total} graded submits and drill sets in the last year`}>
        {months.map((m) => (
          <text key={m.day} x={30 + m.col * (size + gap)} y={10} className="calendar-month">
            {MONTHS.at(Number(m.day.slice(5, 7)) - 1)}
          </text>
        ))}
        {['Mon', 'Wed', 'Fri'].map((d, i) => (
          <text key={d} x={0} y={18 + (i * 2 + 1) * (size + gap) - 3} className="calendar-month">
            {d}
          </text>
        ))}
        {cells.map((c) => (
          <rect key={c.day} x={30 + c.col * (size + gap)} y={16 + c.row * (size + gap)} width={size} height={size} rx={2} className={`cal-${shade(c.n)}`}>
            <title>{`${c.day}: ${c.n === 0 ? 'nothing' : `${c.n} ${c.n === 1 ? 'activity' : 'activities'}`}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="muted small">
        {total === 0 ? 'No submissions yet.' : `${total} graded submits and drill sets in the last year.`} Days are UTC.
      </figcaption>
    </figure>
  );
}

function Bar({ label, solved, total }: { label: React.ReactNode; solved: number; total: number }) {
  return (
    <div className="profile-bar">
      <span>{label}</span>
      <span className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={solved}>
        <span style={{ width: `${total ? (100 * solved) / total : 0}%` }} />
      </span>
      <span className="small">
        {solved} / {total}
      </span>
    </div>
  );
}

/** XP per week, problems and practice stacked: a small picture of keeping at it. */
function XpWeeks({ days }: { days: OwnProfile['private']['xpByDay'] }) {
  if (!days.length) return <p className="muted small">No XP yet.</p>;
  const weekOf = (d: string) => {
    const t = Date.parse(d);
    return t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
  };
  const weeks = new Map<number, { problem: number; practice: number }>();
  for (const d of days) {
    const w = weeks.get(weekOf(d.day)) ?? { problem: 0, practice: 0 };
    w.problem += d.problem;
    w.practice += d.practice;
    weeks.set(weekOf(d.day), w);
  }
  const rows = [...weeks].sort((a, b) => a[0] - b[0]).slice(-12);
  const max = Math.max(...rows.map(([, w]) => w.problem + w.practice));
  return (
    <div className="xp-weeks" role="table" aria-label="XP per week, last 12 weeks">
      {rows.map(([w, v]) => (
        <div key={w} className="xp-week" role="row" title={`Week of ${new Date(w).toISOString().slice(0, 10)}: ${v.problem} problem XP, ${v.practice} practice XP`}>
          <span className="small muted" role="cell">
            {new Date(w).toISOString().slice(5, 10)}
          </span>
          <span className="xp-week-bar" role="cell">
            <span className="xp-week-problem" style={{ width: `${(100 * v.problem) / max}%` }} />
            <span className="xp-week-practice" style={{ width: `${(100 * v.practice) / max}%` }} />
          </span>
          <span className="small" role="cell">
            {v.problem + v.practice}
          </span>
        </div>
      ))}
      <p className="muted small">
        <span className="key key-problem" /> problems <span className="key key-practice" /> practice (drills)
      </p>
    </div>
  );
}

function OwnerHalf({ own, onVisibility }: { own: OwnProfile; onVisibility(v: OwnProfile['visibility']): void }) {
  const p = own.private;
  return (
    <section className="card profile-private" aria-labelledby="private-head">
      <div className="card-body">
        <div className="profile-private-head">
          <h2 id="private-head">Only you can see this</h2>
          <label className="small">
            <input type="checkbox" checked={own.visibility === 'hidden'} onChange={(e) => onVisibility(e.target.checked ? 'hidden' : 'public')} /> Hide my profile from others
          </label>
        </div>
        {own.visibility === 'hidden' && <p className="muted small">Your profile is hidden: others get "not found", and the leaderboard shows you as "Hidden learner" without a link.</p>}
        <div className="profile-tiles">
          <div>
            <b>{p.submits}</b>
            <span className="muted small">graded submits</span>
          </div>
          <div>
            <b>{p.acceptance === null ? '–' : `${Math.round(p.acceptance * 100)}%`}</b>
            <span className="muted small">passed on submit</span>
          </div>
          <div>
            <b>{p.hintsUsed}</b>
            <span className="muted small">hint levels opened</span>
          </div>
          <div>
            <b>{p.solutionsOpened}</b>
            <span className="muted small">solutions opened</span>
          </div>
        </div>
        <div className="profile-cols">
          <div>
            <h3>XP per week</h3>
            <XpWeeks days={p.xpByDay} />
          </div>
          <div>
            <h3>Pick up where you left off</h3>
            {p.unsolved.length ? (
              <ul className="plain">
                {p.unsolved.map((u) => (
                  <li key={u.slug}>
                    <a href={href({ page: 'problem', slug: u.slug })}>{u.title}</a> <span className="muted small">{u.topic}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing tried and left unsolved.</p>
            )}
            <h3>Drill practice</h3>
            {p.practice.length ? (
              <ul className="plain">
                {p.practice.map((d) => (
                  <li key={d.kind}>
                    {drillKind(d.kind)?.title ?? d.kind}: {Math.round((100 * d.correct) / d.answered)}% right over {d.sets} {d.sets === 1 ? 'set' : 'sets'}, {d.xp} XP
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">
                No drill sets on your account yet. <a href={href({ page: 'drills' })}>Try one.</a>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** #/u/<handle>. */
export function ProfilePage({ handle }: { handle: string }) {
  const status = useAccountStore((s) => s.status);
  const me = useAccountStore((s) => s.me);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const isMe = status === 'signed-in' && me?.user?.handle.toLowerCase() === handle.toLowerCase();

  useEffect(() => {
    void useAccountStore.getState().load();
  }, []);
  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unavailable') return setLoad({ state: 'off' });
    let live = true;
    setLoad({ state: 'loading' });
    // Your own page: one private call (it includes the public half). Anyone else's: the public, cacheable one.
    const req = isMe
      ? api<OwnProfile>('GET', '/me/profile').then((own) => ({ state: 'ok' as const, profile: own.profile, own }))
      : api<{ profile: PublicProfile }>('GET', `/users/${encodeURIComponent(handle)}`).then((r) => ({ state: 'ok' as const, profile: r.profile, own: null }));
    req.then(
      (l) => live && setLoad(l),
      (e: unknown) => live && setLoad(e instanceof ApiError && e.status === 404 ? { state: 'missing' } : { state: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [status, handle, isMe]);

  const setVisibility = async (visibility: OwnProfile['visibility']) => {
    if (load.state !== 'ok' || !load.own) return;
    await api('PUT', '/me/visibility', { visibility });
    setLoad({ ...load, own: { ...load.own, visibility } });
  };

  return (
    <div className="page">
      <TopNav />
      <main className="content profile-page">
        {load.state === 'loading' && <p className="muted">Loading…</p>}
        {load.state === 'off' && <p className="muted">Profiles need the Networky server, and this copy has none.</p>}
        {load.state === 'missing' && (
          <p className="muted">
            No public profile called @{handle}. <a href={href({ page: 'leaderboard' })}>See the leaderboard.</a>
          </p>
        )}
        {load.state === 'error' && <p className="callout error">{load.message}</p>}
        {load.state === 'ok' && (
          <>
            <header className="profile-head">
              {load.profile.avatarUrl ? <img src={load.profile.avatarUrl} alt="" width={72} height={72} referrerPolicy="no-referrer" /> : <span className="account-initial lg">{load.profile.handle.slice(0, 1).toUpperCase()}</span>}
              <div>
                <h1>{load.profile.displayName}</h1>
                <p className="muted">
                  @{load.profile.handle} · learning since {load.profile.memberSince}
                </p>
              </div>
            </header>
            <div className="profile-tiles">
              <div>
                <b>{load.profile.xp}</b>
                <span className="muted small">XP · level {load.profile.level.level}</span>
              </div>
              <div>
                <b>{load.profile.rank ? `#${load.profile.rank}` : '–'}</b>
                <span className="muted small">{load.profile.rank ? 'all-time rank' : 'not ranked until a first solve'}</span>
              </div>
              <div>
                <b>
                  {load.profile.solvedCount} / {load.profile.problemCount}
                </b>
                <span className="muted small">problems solved</span>
              </div>
            </div>
            <section className="card" aria-label="Activity">
              <div className="card-body">
                <h2>Activity</h2>
                <ActivityCalendar activity={load.profile.activity} today={Date.now()} />
              </div>
            </section>
            <div className="profile-cols">
              <section className="card" aria-label="Solved by difficulty and topic">
                <div className="card-body">
                  <h2>Solved</h2>
                  {load.profile.byDifficulty.map((d) => (
                    <Bar key={d.difficulty} label={<DifficultyPill d={d.difficulty} />} solved={d.solved} total={d.total} />
                  ))}
                  <h3>By topic</h3>
                  {load.profile.byTopic.map((t) => (
                    <Bar key={t.topic} label={t.topic} solved={t.solved} total={t.total} />
                  ))}
                </div>
              </section>
              <section className="card" aria-label="Solved problems">
                <div className="card-body">
                  <h2>Problems solved</h2>
                  {load.profile.solved.length ? (
                    <ul className="plain profile-solved">
                      {load.profile.solved.map((s) => (
                        <li key={s.slug}>
                          <a href={href({ page: 'problem', slug: s.slug })}>{s.title}</a> <DifficultyPill d={s.difficulty} /> <span className="muted small">{s.day}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small">None yet.</p>
                  )}
                </div>
              </section>
            </div>
            {load.own && <OwnerHalf own={load.own} onVisibility={(v) => void setVisibility(v)} />}
          </>
        )}
      </main>
    </div>
  );
}
