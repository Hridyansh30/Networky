// One problem: the statement, tests, hints and solution on the left, the
// learner's network in the same workspace as the playground (canvas,
// inspector, CLI, simulation) on the right.

import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { href, navigate } from '../app/router';
import { registry } from '../grading/checks';
import { HINT_COST } from '../grading/hints';
import type { TestCase, TestResult } from '../grading/types';
import { problemBySlug } from '../problems/catalog';
import { visibilityOf } from '../problems/spec';
import { problemXp, XP_BY_DIFFICULTY } from '../problems/xp';
import { solutionUnlocked, SOLUTION_AFTER_FAILS, useProblemStore, type Variant } from '../store/problemStore';
import { useProjectStore } from '../store/projectStore';
import { showMe } from '../store/showMe';
import { useSimStore } from '../store/simStore';
import { useTopologyStore } from '../store/topologyStore';
import { confirmAction } from '../ui/Confirm';
import { Icon, Logo } from '../ui/icons';
import { ThemeToggle, XpBar } from '../ui/TopNav';
import { Canvas } from '../ui/workspace/Canvas';
import { DeviceWindow } from '../ui/workspace/DeviceWindow';
import { Inspector } from '../ui/workspace/Inspector';
import { DevicePalette } from '../ui/workspace/LeftPanel';
import { PduModal } from '../ui/workspace/PduModal';
import { SimDock } from '../ui/workspace/SimDock';
import { DifficultyPill } from './ProblemsPage';
import { useWorkspaceShortcuts } from './WorkspacePage';

const CHECKS = registry();

/** The sentence a test shows, e.g. "ping PC1 → 10.0.2.10 succeeds". */
export function describeTest(t: TestCase): string {
  const check = CHECKS.get(t.check.kind);
  const p = check?.schema.safeParse(t.check.params);
  return check && p?.success ? check.describe(p.data) : t.id;
}

async function openProblem(slug: string): Promise<boolean> {
  if (!problemBySlug(slug)) {
    useTopologyStore.getState().notify('That problem does not exist. Pick one here.', 'info');
    navigate({ page: 'problems' }, true);
    return false;
  }
  const project = useProjectStore.getState();
  if (!project.problem && project.isDirty()) {
    const ok = await confirmAction({
      title: 'Open this problem?',
      message: `“${project.name}” in the playground has changes you haven't saved. Opening a problem replaces them.`,
      confirmLabel: 'Open problem',
      danger: true,
    });
    if (!ok) {
      navigate({ page: 'workspace', projectId: project.id }, true);
      return false;
    }
  }
  return useProblemStore.getState().open(slug);
}

// StrictMode mounts, unmounts and remounts in development. Closing is
// deferred one tick so that remount cancels it instead of closing the
// problem it is about to show; a real unmount closes it (and saves).
let openedSlug: string | null = null;
let pendingClose: ReturnType<typeof setTimeout> | undefined;

export function ProblemPage({ slug }: { slug: string }) {
  const variant = useProblemStore((s) => s.variant);

  useEffect(() => {
    clearTimeout(pendingClose);
    if (openedSlug !== slug) {
      openedSlug = slug;
      void openProblem(slug).then((ok) => {
        if (!ok) openedSlug = null;
      });
    }
    return () => {
      pendingClose = setTimeout(() => {
        openedSlug = null;
        useProblemStore.getState().close();
      }, 0);
    };
  }, [slug]);

  const save = useCallback(() => {
    void useProblemStore.getState().flush();
    useTopologyStore.getState().notify('Your network is saved automatically', 'info');
  }, []);
  useWorkspaceShortcuts(save);

  if (!variant || variant.slug !== slug) {
    return (
      <div className="page center-page">
        <p className="muted">Opening problem…</p>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <div className="workspace problem-mode">
        <ProblemTopBar v={variant} />
        <ProblemPanel v={variant} />
        <Canvas />
        <Inspector />
        <SimDock />
        <PduModal />
        <DeviceWindow />
      </div>
    </ReactFlowProvider>
  );
}

function ProblemTopBar({ v }: { v: Variant }) {
  const grading = useProblemStore((s) => s.grading);
  const canUndo = useTopologyStore((s) => s.past.length > 0);
  const canRedo = useTopologyStore((s) => s.future.length > 0);
  const mode = useSimStore((s) => s.mode);
  const setMode = useSimStore((s) => s.setMode);
  const restart = async () => {
    const ok = await confirmAction({
      title: v.values && Object.keys(v.values).length ? 'Start a new variant?' : 'Start over?',
      message: v.values && Object.keys(v.values).length ? 'You get a fresh network with different numbers. Your current network is replaced.' : 'Your network goes back to how the problem started. Your hints and score history stay.',
      confirmLabel: 'Start over',
      danger: true,
    });
    if (ok) await useProblemStore.getState().restart();
  };
  return (
    <header className="topbar">
      <a className="brand back-to-problems" href={href({ page: 'problems' })} title="Back to problems" aria-label="Back to problems">
        <Icon.ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
        <Logo size={26} />
      </a>
      <div className="problem-name">
        <b>{v.title}</b>
        <DifficultyPill d={v.difficulty} />
        <span className="save-state">Saved automatically</span>
      </div>
      <div className="topbar-group">
        <button className="icon-btn" onClick={() => useTopologyStore.getState().undo()} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon.Undo />
        </button>
        <button className="icon-btn" onClick={() => useTopologyStore.getState().redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Icon.Redo />
        </button>
        <button className="btn sm ghost" onClick={restart} title="Back to the start network">
          <Icon.Reset size={15} /> Start over
        </button>
      </div>
      <span className="spacer" />
      <button className="btn sm" onClick={() => void useProblemStore.getState().run()} disabled={!!grading} title="Run the visible tests. Free, and changes nothing.">
        <Icon.Play size={13} /> {grading === 'run' ? 'Running…' : 'Run'}
      </button>
      <button className="btn sm btn-primary" onClick={() => void useProblemStore.getState().submit()} disabled={!!grading} title="Run every test, hidden ones included, and record the result">
        <Icon.Check size={15} /> {grading === 'submit' ? 'Grading…' : 'Submit'}
      </button>
      <div className="mode-switch" role="radiogroup" aria-label="Mode">
        <button role="radio" aria-checked={mode === 'realtime'} className={mode === 'realtime' ? 'on' : ''} onClick={() => setMode('realtime')} title="Converged network; everything answers instantly">
          <Icon.Clock size={16} /> Realtime
        </button>
        <button role="radio" aria-checked={mode === 'simulation'} className={mode === 'simulation' ? 'on' : ''} onClick={() => setMode('simulation')} title="Watch packets hop by hop">
          <Icon.Play size={14} /> Simulation
        </button>
      </div>
      <XpBar />
      <ThemeToggle />
    </header>
  );
}

type Tab = 'statement' | 'tests' | 'hints' | 'solution' | 'devices';

function ProblemPanel({ v }: { v: Variant }) {
  const [tab, setTab] = useState<Tab>('statement');
  const report = useProblemStore((s) => s.report);
  const grading = useProblemStore((s) => s.grading);
  // A finished grade opens the Tests tab, where its results are.
  const lastReport = useRef(report);
  useEffect(() => {
    if (report && report !== lastReport.current) setTab('tests');
    lastReport.current = report;
  }, [report]);

  const tabs: [Tab, string][] = [
    ['statement', 'Problem'],
    ['tests', 'Tests'],
    ['hints', 'Hints'],
    ['solution', 'Solution'],
    ['devices', 'Devices'],
  ];
  return (
    <aside className="left-panel problem-panel" aria-label="Problem">
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="left-scroll problem-scroll" aria-busy={!!grading}>
        {tab === 'statement' && <StatementTab v={v} />}
        {tab === 'tests' && <TestsTab v={v} />}
        {tab === 'hints' && <HintsTab v={v} />}
        {tab === 'solution' && <SolutionTab v={v} />}
        {tab === 'devices' && (
          <>
            <p className="muted small">Drag a device onto the canvas if the problem needs one.</p>
            <DevicePalette query="" />
          </>
        )}
      </div>
    </aside>
  );
}

const TYPE_LABEL = {
  configure: 'Configure',
  troubleshoot: 'Troubleshoot',
  predict: 'Predict',
} as const;

function StatementTab({ v }: { v: Variant }) {
  const report = useProblemStore((s) => s.report);
  return (
    <div className="statement">
      <h1>{v.title}</h1>
      <div className="statement-meta">
        <DifficultyPill d={v.difficulty} />
        <span className="pill">{v.topic}</span>
        <span className="pill">{TYPE_LABEL[v.type]}</span>
        <span className="pill" title="XP for a full solve without hints">
          {XP_BY_DIFFICULTY[v.difficulty]} XP
        </span>
        {v.seed !== undefined && (
          <span className="pill" title="Randomized: every attempt is a different network. Start over gives you a new one.">
            Randomized
          </span>
        )}
      </div>
      {/* Plain text only: problem text is never rendered as HTML. */}
      {v.statement.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
      <h3>Requirements</h3>
      <ul className="requirements">
        {v.requirements.map((r) => {
          const res = report?.requirements.find((x) => x.id === r.id);
          const state = !res ? '' : res.earned === res.max ? (report?.scope === 'submit' ? 'met' : 'met-visible') : 'unmet';
          return (
            <li key={r.id} className={state}>
              <span className="req-mark">{state.startsWith('met') ? <Icon.Check size={14} /> : null}</span>
              {r.text}
            </li>
          );
        })}
      </ul>
      <p className="muted small">
        <b>Run</b> checks the visible tests and is free. <b>Submit</b> checks everything, hidden tests included, and records your score.
      </p>
    </div>
  );
}

function TestsTab({ v }: { v: Variant }) {
  const report = useProblemStore((s) => s.report);
  const error = useProblemStore((s) => s.error);
  const progress = useProblemStore((s) => s.progress[v.slug]);
  const byId = new Map((report?.tests ?? []).map((t) => [t.id, t]));
  const shownCount = v.tests.filter((t) => visibilityOf(t, v.difficulty, CHECKS) === 'shown').length;
  const solvedNow = report?.scope === 'submit' && report.score === report.max;

  return (
    <div className="tests-tab">
      {error && (
        <div className="callout error" role="alert">
          <Icon.Alert size={16} /> {error}
        </div>
      )}
      {report && (
        <div className={`verdict ${solvedNow ? 'pass' : 'fail'}`} role="status">
          {report.scope === 'run' ? (
            <>
              <b>
                Run: {report.tests.filter((t) => t.pass).length} of {report.tests.length} visible tests pass
              </b>
              <span className="small">Hidden tests only run on Submit.</span>
            </>
          ) : solvedNow ? (
            <>
              <b>Accepted. Every test passes.</b>
              <span className="small">
                Score {progress?.last?.score ?? report.score}/{progress?.last?.max ?? report.max} after hints.{' '}
                {progress?.solutionFirst ? 'No XP: the solution was opened before solving.' : `This problem now gives you ${problemXp({ difficulty: v.difficulty, best: progress?.best ?? 0, solutionFirst: false })} XP.`}
              </span>
            </>
          ) : (
            <>
              <b>
                {report.tests.filter((t) => t.pass).length} of {report.tests.length} tests pass
              </b>
              <span className="small">
                Score {report.score}/{report.max}. Fix the failing tests and submit again.
              </span>
            </>
          )}
        </div>
      )}
      {report?.networkError && <div className="callout error">{report.networkError}</div>}
      {!report && (
        <p className="muted small">
          {shownCount} of {v.tests.length} tests are visible. Press Run to check them.
        </p>
      )}
      <ol className="test-list">
        {v.tests.map((t) => (
          <TestRow key={t.id} t={t} shown={visibilityOf(t, v.difficulty, CHECKS) === 'shown'} result={byId.get(t.id)} />
        ))}
      </ol>
    </div>
  );
}

function TestRow({ t, shown, result }: { t: TestCase; shown: boolean; result?: TestResult }) {
  const state = !result ? 'idle' : result.pass ? 'pass' : 'fail';
  const replay = shown && result && !result.pass ? CHECKS.get(t.check.kind)?.replay : undefined;
  return (
    <li className={`test ${state}`}>
      <span className="test-mark" aria-label={state === 'idle' ? 'Not run' : state === 'pass' ? 'Passed' : 'Failed'}>
        {state === 'pass' ? <Icon.Check size={14} /> : state === 'fail' ? <Icon.Close size={13} /> : null}
      </span>
      <div className="test-body">
        <div className="test-title">
          {shown ? (
            describeTest(t)
          ) : (
            <span className="muted">
              <Icon.Lock size={13} /> Hidden test
            </span>
          )}
          <span className="test-points">{t.points} pt</span>
        </div>
        {shown && result && !result.pass && <p className="test-detail">{result.detail}</p>}
        {replay && (
          <button
            className="btn sm"
            onClick={() => {
              const params = CHECKS.get(t.check.kind)!.schema.parse(t.check.params);
              const r = showMe(replay(params as never));
              if (!r.ok) useTopologyStore.getState().notify(r.error);
            }}
            title="Replay this test's traffic in Simulation mode and watch where it stops"
          >
            <Icon.Play size={12} /> Show me
          </button>
        )}
      </div>
    </li>
  );
}

function HintsTab({ v }: { v: Variant }) {
  const progress = useProblemStore((s) => s.progress[v.slug]);
  const used = progress?.hints ?? {};
  return (
    <div className="hints-tab">
      <p className="muted small">Each hint costs {HINT_COST * 100}% of that requirement's points. Try first: the hints go from the idea to the exact command.</p>
      {v.requirements.map((r) => {
        const n = used[r.id] ?? 0;
        return (
          <section key={r.id} className="hint-group">
            <h4>{r.text}</h4>
            <ol>
              {r.hints.slice(0, n).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol>
            {n < r.hints.length && (
              <button className="btn sm" onClick={() => void useProblemStore.getState().unlockHint(r.id)}>
                <Icon.Bulb size={14} /> Show hint {n + 1} of {r.hints.length}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SolutionTab({ v }: { v: Variant }) {
  const progress = useProblemStore((s) => s.progress[v.slug]);
  if (!solutionUnlocked(progress)) {
    const left = SOLUTION_AFTER_FAILS - (progress?.failedSubmits ?? 0);
    return (
      <div className="solution-locked">
        <Icon.Lock size={28} />
        <p>
          The solution unlocks when you solve the problem, or after {left} more failed {left === 1 ? 'submit' : 'submits'}.
        </p>
        <p className="muted small">Struggling a little first is what makes it stick. The hints are a cheaper way out.</p>
      </div>
    );
  }
  if (!progress?.solutionOpened) {
    return (
      <div className="solution-locked">
        <Icon.Eye size={28} />
        {progress?.solved ? (
          <p>You solved it. Compare your answer with the reference.</p>
        ) : (
          <p>
            Opening the solution before you solve the problem means it gives you <b>no XP</b>, even if you submit afterwards.
          </p>
        )}
        <button className="btn btn-primary" onClick={() => void useProblemStore.getState().openSolution()}>
          Show solution
        </button>
      </div>
    );
  }
  return (
    <div className="solution">
      {v.solution ? v.solution.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : <p className="muted">This problem has no written explanation, but you can load the reference network.</p>}
      <button
        className="btn"
        onClick={async () => {
          const ok = await confirmAction({
            title: 'Load the reference network?',
            message: 'It replaces your network on the canvas. Undo brings yours back.',
            confirmLabel: 'Load reference',
            danger: true,
          });
          if (ok) useProblemStore.getState().loadReference();
        }}
      >
        <Icon.Download size={15} /> Load reference network
      </button>
    </div>
  );
}
