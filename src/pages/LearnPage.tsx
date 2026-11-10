import { useState } from 'react';
import { EXAMPLES } from '../model/examples';
import { PROTOCOLS } from '../ui/protocols';
import { TopNav } from '../ui/TopNav';
import { LabCard } from './ProjectsPage';

const LEVELS = ['All', 'Beginner', 'Intermediate', 'Advanced'] as const;

export function LearnPage() {
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('All');
  const [topic, setTopic] = useState<string | null>(null);
  const topics = [...new Set(EXAMPLES.flatMap((e) => e.topics))].sort();
  const labs = EXAMPLES.filter((e) => (level === 'All' || e.level === level) && (!topic || e.topics.includes(topic)));

  return (
    <div className="page">
      <TopNav />
      <main className="content">
        <div className="page-head">
          <div>
            <h1>Learn</h1>
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
