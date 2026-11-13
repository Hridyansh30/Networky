import { useState } from 'react';
import { href } from '../app/router';
import { EXAMPLES } from '../model/examples';
import { problemBySlug, TRACKS } from '../problems/catalog';
import { statusOf, trackProgress } from '../problems/stats';
import { Icon } from '../ui/icons';
import { DifficultyPill } from './ProblemsPage';
import { useProgress } from '../ui/TopNav';
import { PROTOCOLS } from '../ui/protocols';
import { TopNav } from '../ui/TopNav';
import { LabCard } from './ProjectsPage';

const LEVELS = ['All', 'Beginner', 'Intermediate', 'Advanced'] as const;

export function LearnPage() {
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('All');
  const [topic, setTopic] = useState<string | null>(null);
  const topics = [...new Set(EXAMPLES.flatMap((e) => e.topics))].sort();
  const { progress } = useProgress();
  const labs = EXAMPLES.filter((e) => (level === 'All' || e.level === level) && (!topic || e.topics.includes(topic)));

  return (
    <div className="page">
      <TopNav />
      <main className="content">
        <div className="page-head">
          <div>
            <h1>Learn</h1>
            <p className="muted">Follow a track stage by stage, or open a lab and explore. Every problem stays open: the track only suggests an order.</p>
          </div>
        </div>
        <section className="tracks" aria-label="Learning path">
          {TRACKS.map((t, i) => {
            const tp = trackProgress(progress, t);
            return (
              <article key={t.id} className="track card">
                <header className="track-head">
                  <span className="track-stage">Stage {i + 1}</span>
                  <h2>{t.title}</h2>
                  <span className="muted small">
                    {tp.solved} of {tp.total} solved
                  </span>
                </header>
                <p className="muted">{t.description}</p>
                <span className="bar track-bar" role="progressbar" aria-label={`${t.title} progress`} aria-valuemin={0} aria-valuemax={tp.total} aria-valuenow={tp.solved}>
                  <span style={{ width: `${(100 * tp.solved) / Math.max(1, tp.total)}%` }} />
                </span>
                <ol className="track-steps">
                  {t.slugs.map((slug) => {
                    const p = problemBySlug(slug)!;
                    const st = statusOf(progress, slug);
                    return (
                      <li key={slug} className={`${st} ${slug === tp.next ? 'next' : ''}`}>
                        <span className="path-dot">{st === 'solved' && <Icon.Check size={13} />}</span>
                        <a href={href({ page: 'problem', slug })}>{p.title}</a>
                        <DifficultyPill d={p.difficulty} />
                      </li>
                    );
                  })}
                </ol>
              </article>
            );
          })}
        </section>
        <div className="page-head sub">
          <div>
            <h2 id="labs">Labs</h2>
            <p className="muted">Each lab opens a ready-made network with exercises. Run them, predict the result, then switch to Simulation to watch why.</p>
          </div>
        </div>
        <div className="learn-filters">
          <div className="seg" role="radiogroup" aria-label="Level">
            {LEVELS.map((l) => (
              <button key={l} role="radio" aria-checked={level === l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
                {l}
              </button>
            ))}
          </div>
          <div className="topic-filter" role="group" aria-label="Topic">
            {topics.map((t) => {
              const color = PROTOCOLS.find((p) => p.label === t)?.color;
              return (
                <button key={t} className={`topic ${topic === t ? 'on' : ''}`} aria-pressed={topic === t} onClick={() => setTopic(topic === t ? null : t)} style={color ? { ['--c' as string]: color } : undefined}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>
        <div className="card-grid wide">
          {labs.map((e) => (
            <LabCard key={e.name} lab={e} detailed />
          ))}
          {!labs.length && <p className="muted">No labs match those filters.</p>}
        </div>
      </main>
    </div>
  );
}
