import { href, navigate } from '../app/router';
import { dailyProblem, PROBLEMS, TRACKS } from '../problems/catalog';
import { continueWith, learnerStats, statusOf, trackProgress } from '../problems/stats';
import { useProjectStore } from '../store/projectStore';
import { DeviceIcon, Icon } from '../ui/icons';
import { openFileDialog } from '../ui/openFile';
import { TopNav, useProgress } from '../ui/TopNav';
import { DifficultyPill, ProgressRing, useNow } from './ProblemsPage';

const FEATURES = [
  {
    icon: Icon.Zap,
    title: 'Design',
    text: 'Drag devices onto a canvas and cable them together.',
  },
  {
    icon: Icon.Play,
    title: 'Simulate',
    text: 'Watch every frame hop from port to port, one step at a time.',
  },
  {
    icon: Icon.Terminal,
    title: 'Configure',
    text: 'Use a Cisco-style CLI or the forms. Both change the same device.',
  },
  {
    icon: Icon.Code,
    title: 'Solve',
    text: 'Test-graded problems from easy to hard. Run is free; Submit checks hidden tests too.',
  },
];

/** The picture on the landing page: a router, two switches and four hosts. */
function HeroArt() {
  const nodes = [
    { kind: 'router' as const, x: 250, y: 40 },
    { kind: 'switch' as const, x: 110, y: 170 },
    { kind: 'switch' as const, x: 390, y: 170 },
    { kind: 'pc' as const, x: 30, y: 310 },
    { kind: 'laptop' as const, x: 190, y: 310 },
    { kind: 'server' as const, x: 310, y: 310 },
    { kind: 'pc' as const, x: 470, y: 310 },
  ];
  const links = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]];
  const c = (i: number) => ({ x: nodes[i].x + 40, y: nodes[i].y + 40 });
  return (
    <svg className="hero-art" viewBox="0 0 560 420" role="img" aria-label="A small network: a router connected to two switches, each with two computers">
      <defs>
        <radialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="280" cy="220" rx="290" ry="210" fill="url(#hero-glow)" />
      {links.map(([a, b], k) => (
        <g key={k}>
          <line x1={c(a).x} y1={c(a).y} x2={c(b).x} y2={c(b).y} className="hero-link" />
          <circle r="5" className="hero-packet" style={{ animationDelay: `${k * 0.45}s` }}>
            <animateMotion dur="2.7s" repeatCount="indefinite" begin={`${k * 0.45}s`} path={`M${c(a).x},${c(a).y} L${c(b).x},${c(b).y}`} />
          </circle>
        </g>
      ))}
      {nodes.map((n, k) => (
        <g key={k} transform={`translate(${n.x} ${n.y})`}>
          <DeviceIcon kind={n.kind} size={80} />
        </g>
      ))}
    </svg>
  );
}

export function HomePage() {
  const start = () => {
    useProjectStore.getState().newProject();
    navigate({ page: 'workspace' });
  };
  const open = async () => {
    if (await openFileDialog()) navigate({ page: 'workspace' });
  };

  const { progress, loaded } = useProgress();
  const returning = loaded && Object.keys(progress).length > 0;

  return (
    <div className="page">
      <TopNav />
      <main className="home">
        {returning && <Dashboard />}
        {!returning && (
          <section className="hero">
            <div className="hero-text">
              <span className="chip">
                <Icon.Terminal size={16} /> Network simulator
              </span>
              <h1>
                Networky
                <span>
                  Build, simulate, <em>learn</em>
                </span>
              </h1>
              <p className="lead">Solve hands-on networking problems in a real simulator. Configure devices like Cisco gear, run the tests, and watch every packet find its way, from a first ping to OSPF and NAT.</p>
              <div className="hero-actions">
                <a className="btn btn-primary btn-lg" href={href({ page: 'problem', slug: PROBLEMS[0].slug })}>
                  <Icon.Code /> Solve your first problem
                </a>
                <button className="btn btn-lg" onClick={start}>
                  <Icon.Plus /> Open playground
                </button>
                <button className="btn btn-lg" onClick={open}>
                  <Icon.Folder /> Open file
                </button>
                <a className="btn btn-ghost btn-lg" href={href({ page: 'learn' })}>
                  <Icon.Book /> Learning path
                </a>
              </div>
            </div>
            <HeroArt />
          </section>
        )}
        <section className="features" aria-label="What you can do">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <span className="feature-icon">
                <f.icon size={22} />
              </span>
              <div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}


/** For someone who has started: progress, where to continue, today's challenge. Every number is real. */
function Dashboard() {
  const { progress } = useProgress();
  const now = useNow(60_000);
  const stats = learnerStats(progress, PROBLEMS);
  const next = continueWith(progress, PROBLEMS);
  const track = TRACKS.find((t) => trackProgress(progress, t).next);
  const suggestion = next ?? (track ? PROBLEMS.find((p) => p.slug === trackProgress(progress, track).next) : undefined);
  const daily = dailyProblem(now);
  return (
    <section className="dashboard" aria-label="Your learning">
      <h1 className="dash-title">Welcome back</h1>
      <div className="dash-grid">
        <article className="rail-card">
          <h2>Your Progress</h2>
          <div className="progress-body">
            <ProgressRing value={stats.solved} max={stats.total} />
            <ul className="progress-facts">
              <li>
                <b>{stats.solved}</b> of {stats.total} solved
              </li>
              <li>
                <b>Lv. {stats.level.level}</b> · {stats.xp} XP
              </li>
              <li className="muted small">
                Easy {stats.byDifficulty.easy.solved}/{stats.byDifficulty.easy.total} · Medium {stats.byDifficulty.medium.solved}/{stats.byDifficulty.medium.total} · Hard {stats.byDifficulty.hard.solved}/{stats.byDifficulty.hard.total}
              </li>
            </ul>
          </div>
        </article>
        <article className="rail-card">
          <h2>{next ? 'Continue learning' : 'Up next'}</h2>
          {suggestion ? (
            <>
              <p className="daily-title">{suggestion.title}</p>
              <div className="daily-tags">
                <DifficultyPill d={suggestion.difficulty} />
                <span className="pill">{suggestion.topic}</span>
                {statusOf(progress, suggestion.slug) === 'attempted' && <span className="pill">In progress</span>}
              </div>
              <a className="btn btn-primary" href={href({ page: 'problem', slug: suggestion.slug })}>
                {next ? 'Continue' : 'Start'} <Icon.ArrowRight size={16} />
              </a>
            </>
          ) : (
            <>
              <p>You have solved every problem so far. New ones are on the way.</p>
              <a className="btn" href={href({ page: 'workspace' })}>
                Open the playground
              </a>
            </>
          )}
        </article>
        <article className="rail-card daily">
          <h2>
            <Icon.Spark size={20} className="daily-icon" /> Daily Challenge
          </h2>
          <p className="daily-title">{daily.title}</p>
          <div className="daily-tags">
            <DifficultyPill d={daily.difficulty} />
            <span className="pill">{daily.topic}</span>
            {statusOf(progress, daily.slug) === 'solved' && <span className="pill">Solved</span>}
          </div>
          <a className="btn btn-primary" href={href({ page: 'problem', slug: daily.slug })}>
            Solve now <Icon.ArrowRight size={16} />
          </a>
        </article>
      </div>
    </section>
  );
}
