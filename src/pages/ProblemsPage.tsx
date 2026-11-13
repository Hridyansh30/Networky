// The problem list (Kavya's final light mockup, minus everything that does
// not exist yet: see docs/deferred.md). Every number on it is real: counts
// from the catalog, progress and XP from this browser's saved progress.

import { useEffect, useMemo, useRef, useState } from 'react';
import { href, navigate } from '../app/router';
import { dailyProblem, PROBLEMS, problemNumber, TOPICS, TRACKS } from '../problems/catalog';
import type { Difficulty, ProblemSpec } from '../problems/spec';
import { learnerStats, statusOf, trackProgress, type Status } from '../problems/stats';
import { DeviceIcon, Icon } from '../ui/icons';
import { TopNav, useProgress } from '../ui/TopNav';
import { EXAMPLES } from '../model/examples';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};
const RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };
type Sort = 'default' | 'difficulty' | 'title';

export function DifficultyPill({ d }: { d: Difficulty }) {
  return <span className={`diff diff-${d}`}>{LABEL[d]}</span>;
}

function StatusCell({ status }: { status: Status }) {
  if (status === 'solved')
    return (
      <span className="status solved">
        <Icon.Check size={16} /> Solved
      </span>
    );
  if (status === 'attempted') return <span className="status attempted">Attempted</span>;
  return (
    <span className="status todo" aria-label="Not started">
      —
    </span>
  );
}

/** Router and two switches, drawn with the app's own device icons. */
function HeaderArt() {
  return (
    <svg className="problems-art" viewBox="0 0 320 170" aria-hidden="true">
      <defs>
        <radialGradient id="pa-glow" cx="50%" cy="55%" r="50%">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="100" rx="160" ry="70" fill="url(#pa-glow)" />
      <path d="M160 58 70 120M160 58l90 62" className="hero-link" />
      <g transform="translate(120 8)">
        <DeviceIcon kind="router" size={80} />
      </g>
      <g transform="translate(36 92)">
        <DeviceIcon kind="switch" size={68} />
      </g>
      <g transform="translate(216 92)">
        <DeviceIcon kind="switch" size={68} />
      </g>
    </svg>
  );
}

function untilMidnight(now: Date): string {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
}

export function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function ProblemsPage() {
  const { progress } = useProgress();
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | 'all'>('all');
  const [sort, setSort] = useState<Sort>('default');
  const search = useRef<HTMLInputElement>(null);
  const now = useNow(30_000);

  // Ctrl+K / Cmd+K focuses the search, like the mockup's hint says.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const topics = TOPICS.filter((t) => PROBLEMS.some((p) => p.topic === t));
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = PROBLEMS.filter((p) => (!topic || p.topic === topic) && (difficulty === 'all' || p.difficulty === difficulty) && (!q || p.title.toLowerCase().includes(q) || p.topic.toLowerCase().includes(q)));
    if (sort === 'difficulty') return [...list].sort((a, b) => RANK[a.difficulty] - RANK[b.difficulty]);
    if (sort === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [query, topic, difficulty, sort]);

  const stats = learnerStats(progress, PROBLEMS);
  const daily = dailyProblem(now);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  const random = () => {
    const pool = rows.filter((p) => statusOf(progress, p.slug) !== 'solved');
    const from = pool.length ? pool : rows.length ? rows : PROBLEMS;
    const pick = from[Math.floor(Math.random() * from.length)];
    navigate({ page: 'problem', slug: pick.slug });
  };

  return (
    <div className="page">
      <TopNav />
      <main className="problems-layout">
        <div className="problems-main">
          <section className="problems-head">
            <div>
              <p className="eyebrow">Practice · Configure · Simulate</p>
              <h1>
                Computer Networking <span className="accent-text">Problems</span>
              </h1>
              <p className="muted lead-sm">Solve hands-on, test-based challenges and master computer networks with a real network simulator.</p>
            </div>
            <HeaderArt />
          </section>

          <section className="entry-cards" aria-label="Ways to learn">
            <EntryCard to={href({ page: 'learn' })} icon={<Icon.Layers size={26} />} title="Learning Path" text={`${TRACKS.length} stage-wise tracks, from first ping to IPv6`} />
            <EntryCard to={`${href({ page: 'learn' })}`} icon={<Icon.Flask size={26} />} title="Labs" text={`${EXAMPLES.length} guided, ready-made network scenarios`} />
            <EntryCard to={href({ page: 'workspace' })} icon={<Icon.Play size={24} />} title="Playground" text="Build any network you like, no tests attached" />
          </section>

          <section className="problem-filters" aria-label="Filter problems">
            <label className="search problem-search">
              <Icon.Search size={18} />
              <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search problems…" aria-label="Search problems" maxLength={80} />
              <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
            </label>
            <label className="select-wrap">
              <span className="sr-only">Difficulty</span>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | 'all')} aria-label="Difficulty">
                <option value="all">Difficulty: All</option>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    Difficulty: {LABEL[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-wrap">
              <span className="sr-only">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
                <option value="default">Sort: Path order</option>
                <option value="difficulty">Sort: Difficulty</option>
                <option value="title">Sort: Title</option>
              </select>
            </label>
            <button className="btn" onClick={random} title="Open a random problem you haven't solved">
              <Icon.Shuffle size={18} /> Random
            </button>
          </section>

          <div className="topic-chips" role="group" aria-label="Topic">
            <button className={`tchip ${topic === null ? 'on' : ''}`} aria-pressed={topic === null} onClick={() => setTopic(null)}>
              All
            </button>
            {topics.map((t) => (
              <button key={t} className={`tchip ${topic === t ? 'on' : ''}`} aria-pressed={topic === t} onClick={() => setTopic(topic === t ? null : t)}>
                {t}
              </button>
            ))}
          </div>

          <div className="problem-table-wrap">
            <table className="problem-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Title</th>
                  <th>Topic</th>
                  <th>Difficulty</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <ProblemRow key={p.slug} p={p} status={statusOf(progress, p.slug)} />
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="muted pad">No problems match those filters.</p>}
          </div>
          <p className="muted small table-foot">{PROBLEMS.length} problems so far. More are on the way.</p>
        </div>

        <aside className="problems-rail" aria-label="Your progress">
          <section className="rail-card">
            <h2>Your Progress</h2>
            <div className="progress-body">
              <ProgressRing value={stats.solved} max={stats.total} />
              <ul className="progress-facts">
                <li>
                  <Icon.Check size={16} className="ok" /> <b>{stats.solved}</b> Solved
                </li>
                <li>
                  <Icon.Code size={16} /> <b>{stats.total}</b> Total
                </li>
                <li>
                  <Icon.Layers size={16} /> <b>{topics.length}</b> Topics
                </li>
                <li>
                  <Icon.Bars size={16} /> <b>Lv. {stats.level.level}</b> {stats.xp} XP
                </li>
              </ul>
            </div>
            <div className="diff-bars">
              {DIFFICULTIES.map((d) => {
                const b = stats.byDifficulty[d];
                return (
                  <div key={d} className={`diff-bar diff-${d}`}>
                    <span>{LABEL[d]}</span>
                    <span className="bar">
                      <span
                        style={{
                          width: b.total ? `${(100 * b.solved) / b.total}%` : 0,
                        }}
                      />
                    </span>
                    <span className="muted">
                      {b.solved}/{b.total}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rail-card">
            <div className="rail-head">
              <h2>Learning Path</h2>
              <a href={href({ page: 'learn' })}>
                View path <Icon.ArrowRight size={14} />
              </a>
            </div>
            <ol className="path-list">
              {(() => {
                const currentIdx = TRACKS.findIndex((t) => trackProgress(progress, t).solved < t.slugs.length);
                return TRACKS.map((t, i) => {
                  const tp = trackProgress(progress, t);
                  const done = tp.solved === tp.total;
                  return (
                    <li key={t.id} className={`${done ? 'done' : ''} ${i === currentIdx ? 'current' : ''}`}>
                      <span className="path-dot">{done && <Icon.Check size={13} />}</span>
                      <a href={tp.next ? href({ page: 'problem', slug: tp.next }) : href({ page: 'learn' })}>{t.title}</a>
                      <span className="muted small">
                        {tp.solved}/{tp.total}
                      </span>
                    </li>
                  );
                });
              })()}
            </ol>
          </section>

          <section className="rail-card daily">
            <div className="rail-head">
              <h2>
                <Icon.Spark size={20} className="daily-icon" /> Daily Challenge
              </h2>
              <span className="pill">{untilMidnight(now)}</span>
            </div>
            <p className="daily-title">{daily.title}</p>
            <div className="daily-tags">
              <DifficultyPill d={daily.difficulty} />
              <span className="pill">{daily.topic}</span>
              {statusOf(progress, daily.slug) === 'solved' && (
                <span className="status solved">
                  <Icon.Check size={14} /> Solved
                </span>
              )}
            </div>
            <a className="btn btn-primary" href={href({ page: 'problem', slug: daily.slug })}>
              Solve now <Icon.ArrowRight size={16} />
            </a>
          </section>
        </aside>
      </main>
    </div>
  );
}

function EntryCard({ to, icon, title, text }: { to: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <a className="entry-card" href={to}>
      <span className="entry-icon">{icon}</span>
      <span className="entry-text">
        <b>{title}</b>
        <span className="muted small">{text}</span>
      </span>
      <span className="entry-go" aria-hidden="true">
        <Icon.ArrowRight size={16} />
      </span>
    </a>
  );
}

function ProblemRow({ p, status }: { p: ProblemSpec; status: Status }) {
  const to = href({ page: 'problem', slug: p.slug });
  return (
    <tr>
      <td className="num">{problemNumber(p.slug)}</td>
      <td>
        <a className="problem-title" href={to}>
          {p.title}
        </a>
        {p.params && (
          <span className="pill variant-pill" title="Every attempt is a different network">
            Randomized
          </span>
        )}
        {p.type === 'predict' && (
          <span className="pill variant-pill" title="Nothing to configure: say what the traffic will do, then watch it">
            Predict
          </span>
        )}
      </td>
      <td className="muted">{p.topic}</td>
      <td>
        <DifficultyPill d={p.difficulty} />
      </td>
      <td>
        <StatusCell status={status} />
      </td>
      <td className="go">
        <a className="icon-btn sm play" href={to} aria-label={`Open ${p.title}`}>
          <Icon.Play size={14} />
        </a>
      </td>
    </tr>
  );
}

export function ProgressRing({ value, max }: { value: number; max: number }) {
  const pct = max ? (100 * value) / max : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 128 128" role="img" aria-label={`${value} of ${max} problems solved`}>
      <circle cx="64" cy="64" r={r} className="ring-bg" />
      {value > 0 && <circle cx="64" cy="64" r={r} className="ring-fg" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 64 64)" />}
      <text x="64" y="70" textAnchor="middle" className="ring-text">
        {pct >= 10 || pct === 0 ? Math.round(pct) : pct.toFixed(1)}%
      </text>
    </svg>
  );
}
