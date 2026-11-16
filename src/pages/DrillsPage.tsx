import { useEffect, useRef, useState } from 'react';
import { href, navigate } from '../app/router';
import { useApi } from '../api/useApi';
import { DRILL_KINDS, drillKind, LEVELS, SET_SIZE, type CheckResult, type DrillQuestion, type Level } from '../drills';
import { useAccountStore } from '../store/accountStore';
import { useDrillStore } from '../store/drillStore';
import { Icon } from '../ui/icons';
import { TopNav } from '../ui/TopNav';

interface Practice {
  practiceToday: number;
  cap: number;
}

/** Practice XP today against the daily cap, signed in only. */
function PracticeMeter() {
  const status = useAccountStore((s) => s.status);
  const p = useApi<Practice>(status === 'signed-in' ? '/me/practice' : null);
  if (status === 'guest') return <p className="muted small">Drills are saved in this browser. Sign in to earn practice XP for the weekly board.</p>;
  if (p.state !== 'ok') return null;
  const { practiceToday, cap } = p.data;
  return (
    <div className="practice-meter" title="Each right answer earns its level in XP (1 to 3), up to the daily cap. Practice XP counts on the weekly board; your level and the all-time board count solved problems.">
      <span className="small muted">Practice XP today</span>
      <span className="xp-track" role="progressbar" aria-label="Practice XP today" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={practiceToday}>
        <span style={{ width: `${(100 * Math.min(practiceToday, cap)) / cap}%` }} />
      </span>
      <b className="small">
        {practiceToday} / {cap}
      </b>
    </div>
  );
}

/** #/drills: every drill kind, with this browser's record and a level to start at. */
export function DrillsPage() {
  const stats = useDrillStore((s) => s.stats);
  const [levels, setLevels] = useState<Record<string, Level>>({});
  useEffect(() => {
    void useDrillStore.getState().loadStats();
    void useAccountStore.getState().load();
  }, []);

  return (
    <div className="page">
      <TopNav />
      <main className="content">
        <div className="page-head">
          <div>
            <h1>Drills</h1>
            <p className="muted">
              Sets of {SET_SIZE} short questions, made fresh every time. Three right in a row moves you up a level; two wrong moves you down. Problems teach a skill once; drills make it automatic.
            </p>
          </div>
          <PracticeMeter />
        </div>
        <section className="card-grid" aria-label="Drills">
          {DRILL_KINDS.map((k) => {
            const s = stats[k.id];
            const level = levels[k.id] ?? s?.level ?? 1;
            return (
              <article key={k.id} className="card drill-card">
                <div className="card-body">
                  <span className="chip drill-topic">{k.topic}</span>
                  <h3>{k.title}</h3>
                  <p className="muted small">{k.summary}</p>
                  {k.runsEngine && <p className="muted small">Graded in your browser by the simulator: practice only, no XP.</p>}
                  <p className="small drill-record">
                    {s && s.answered > 0 ? (
                      <>
                        {Math.round((100 * s.correct) / s.answered)}% right over {s.sets} {s.sets === 1 ? 'set' : 'sets'}, best run {s.bestStreak} <span className="muted">(this device)</span>
                      </>
                    ) : (
                      <span className="muted">Not tried yet.</span>
                    )}
                  </p>
                  <div className="seg" role="radiogroup" aria-label={`${k.title}: starting level`}>
                    {LEVELS.map((l) => (
                      <button key={l} role="radio" aria-checked={level === l} className={level === l ? 'on' : ''} title={k.levels[l]} onClick={() => setLevels({ ...levels, [k.id]: l })}>
                        Level {l}
                      </button>
                    ))}
                  </div>
                  <p className="muted small">{k.levels[level]}</p>
                </div>
                <div className="card-actions">
                  <a className="btn btn-primary sm" href={href({ page: 'drill', kind: k.id, level })}>
                    Start a set <Icon.ArrowRight size={14} />
                  </a>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}

function FieldsForm({ q, onSubmit, result, answer }: { q: Extract<DrillQuestion, { type: 'fields' }>; onSubmit(a: Record<string, string>): void; result: CheckResult | null; answer: Record<string, string> | null }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), [q]);
  const shown = answer ?? values;
  return (
    <form
      className="drill-fields"
      onSubmit={(e) => {
        e.preventDefault();
        if (!result) onSubmit(values);
      }}
    >
      {q.fields.map((f, i) => {
        const r = result?.fields[f.id];
        return (
          <label key={f.id} className={`drill-field ${r ? (r.correct ? 'right' : 'wrong') : ''}`}>
            <span>{f.label}</span>
            <input
              ref={i === 0 ? first : undefined}
              value={shown[f.id] ?? ''}
              placeholder={f.placeholder}
              readOnly={!!result}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={r ? !r.correct : undefined}
              onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
            />
            {r && !r.correct && (
              <span className="drill-expected small">
                Answer: <code>{r.expected}</code>
                {r.problem && <span className="muted"> · {r.problem}</span>}
              </span>
            )}
          </label>
        );
      })}
      {!result && (
        <button className="btn btn-primary" type="submit">
          Check
        </button>
      )}
    </form>
  );
}

function ChoiceForm({ q, onSubmit, result, answer }: { q: Extract<DrillQuestion, { type: 'choice' }>; onSubmit(a: Record<string, string>): void; result: CheckResult | null; answer: Record<string, string> | null }) {
  return (
    <div className="drill-choices" role="group" aria-label="Options">
      {q.choices.map((c) => {
        const picked = answer?.choice === c;
        const right = result && c === q.expected.choice;
        return (
          <button key={c} className={`btn drill-choice ${right ? 'right' : picked ? 'wrong' : ''}`} disabled={!!result} aria-pressed={picked} onClick={() => onSubmit({ choice: c })}>
            {c}
          </button>
        );
      })}
    </div>
  );
}

/** #/drills/<kind>?level=N[&seed=S]: one set, question by question. */
export function DrillSetPage({ kind: kindId, level, seed }: { kind: string; level: Level; seed?: number }) {
  const kind = drillKind(kindId);
  const st = useDrillStore((s) => s.set);
  const starting = useDrillStore((s) => s.starting);
  const status = useAccountStore((s) => s.status);
  useEffect(() => {
    void (async () => {
      await useAccountStore.getState().load();
      await useDrillStore.getState().loadStats();
      await useDrillStore.getState().start(kindId, level, seed);
    })();
    return () => useDrillStore.getState().quit();
  }, [kindId, level, seed]);

  if (!kind)
    return (
      <div className="page">
        <TopNav />
        <main className="content">
          <p className="callout error">No such drill.</p>
          <a href={href({ page: 'drills' })}>All drills</a>
        </main>
      </div>
    );

  const cur = useDrillStore.getState().question();
  const last = st?.reviewing ? st.played.at(-1)! : null;
  return (
    <div className="page">
      <TopNav />
      <main className="content drill-page">
        <nav className="small">
          <a href={href({ page: 'drills' })}>Drills</a> <span className="muted">/ {kind.title}</span>
        </nav>
        {(!st || starting || status === 'loading') && <p className="muted">Getting a set ready…</p>}
        {st && !starting && (
          <>
            <ol className="drill-dots" aria-label="Progress">
              {Array.from({ length: SET_SIZE }, (_, i) => {
                const p = st.played.at(i);
                return <li key={i} className={p ? (p.check.correct ? 'right' : 'wrong') : !st.reviewing && i === st.played.length ? 'now' : ''} aria-label={`Question ${i + 1}${p ? (p.check.correct ? ': right' : ': wrong') : ''}`} />;
              })}
            </ol>
            {st.practiceOnly && <p className="muted small">{st.practiceOnly}</p>}
            {cur && (
              <section className="card drill-question" aria-live="polite">
                <div className="card-body">
                  <p className="eyebrow">
                    Question {cur.index + 1} of {SET_SIZE} · Level {cur.level}
                  </p>
                  <p className="drill-prompt">{cur.q.prompt}</p>
                  {cur.q.type === 'fields' ? (
                    <FieldsForm key={`${cur.index}`} q={cur.q} result={last?.check ?? null} answer={last?.answer ?? null} onSubmit={(a) => useDrillStore.getState().answer(a)} />
                  ) : (
                    <ChoiceForm q={cur.q} result={last?.check ?? null} answer={last?.answer ?? null} onSubmit={(a) => useDrillStore.getState().answer(a)} />
                  )}
                  {last && (
                    <div className={`callout ${last.check.correct ? 'success' : 'info'}`}>
                      <b>{last.check.correct ? 'Right.' : 'Not quite.'}</b>
                      <ol className="drill-explain">
                        {cur.q.explanation.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ol>
                      <button className="btn btn-primary sm" autoFocus onClick={() => void useDrillStore.getState().next()}>
                        {st.played.length < SET_SIZE ? 'Next question' : 'Finish the set'}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}
            {st.finished && <SetSummary routeLevel={level} routeSeed={seed} />}
          </>
        )}
      </main>
    </div>
  );
}

function SetSummary({ routeLevel, routeSeed }: { routeLevel: Level; routeSeed?: number }) {
  const st = useDrillStore((s) => s.set)!;
  const right = st.played.filter((p) => p.check.correct).length;
  return (
    <section className="card drill-summary">
      <div className="card-body">
        <h2>
          {right} of {SET_SIZE} right
        </h2>
        <p className="muted small">Levels: {st.played.map((p) => p.level).join(' → ')}</p>
        {st.server && (
          <p>
            {st.server.xp > 0 ? (
              <>
                <b>+{st.server.xp} practice XP</b> for the weekly board.
              </>
            ) : st.server.earned > 0 ? (
              <>You have reached today's cap of {st.server.cap} practice XP. It resets at 00:00 UTC; keep practising if you like.</>
            ) : (
              <>No practice XP this time.</>
            )}{' '}
            <span className="muted small">
              Today: {st.server.practiceToday} / {st.server.cap}
            </span>
          </p>
        )}
        {st.serverError && <p className="callout error small">{st.serverError}</p>}
        <div className="page-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              const next = useDrillStore.getState().stats[st.kind]?.level ?? st.startLevel;
              // Same route: start here. Another level: the route change starts it (one set, never two).
              if (next === routeLevel && routeSeed === undefined) void useDrillStore.getState().start(st.kind, next);
              else navigate({ page: 'drill', kind: st.kind, level: next });
            }}
          >
            Another set
          </button>
          <a className="btn" href={href({ page: 'drills' })}>
            All drills
          </a>
          <a className="btn ghost" href={href({ page: 'drill', kind: st.kind, level: st.startLevel, seed: st.seed })} title="This exact set again, practice only. Share it to compare answers.">
            <Icon.Link size={14} /> Link to this set
          </a>
        </div>
      </div>
    </section>
  );
}
