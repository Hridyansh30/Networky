import { href, navigate } from '../../app/router';
import { useProjectStore } from '../../store/projectStore';
import { useSimStore } from '../../store/simStore';
import { useTopologyStore } from '../../store/topologyStore';
import { CommitField } from '../CommitField';
import { confirmAction } from '../Confirm';
import { Icon, Logo } from '../icons';
import { exportFile, openFileDialog } from '../openFile';
import { ThemeToggle } from '../TopNav';

export async function saveProject() {
  try {
    await useProjectStore.getState().save();
    const { id } = useProjectStore.getState();
    if (id) navigate({ page: 'workspace', projectId: id }, true);
    useTopologyStore.getState().notify('Saved in this browser', 'info');
  } catch (e) {
    useTopologyStore.getState().notify(`Could not save: ${e instanceof Error ? e.message : e}`);
  }
}

export function TopBar() {
  const name = useProjectStore((s) => s.name);
  useTopologyStore((s) => s.topology);
  useTopologyStore((s) => s.layout);
  const dirty = useProjectStore((s) => s.isDirty)();
  const canUndo = useTopologyStore((s) => s.past.length > 0);
  const canRedo = useTopologyStore((s) => s.future.length > 0);
  const mode = useSimStore((s) => s.mode);
  const setMode = useSimStore((s) => s.setMode);

  const confirmDiscard = async () => !dirty || confirmAction({ title: 'Discard unsaved changes?', message: `“${name}” has changes you haven't saved. Save first to keep them.`, confirmLabel: 'Discard changes', danger: true });

  return (
    <header className="topbar">
      <a className="brand" href={href({ page: 'projects' })} title="Back to projects">
        <Logo size={26} />
      </a>
      <div className="project-name">
        <CommitField
          value={name}
          ariaLabel="Project name"
          onCommit={(v) => {
            useProjectStore.getState().rename(v);
            return null;
          }}
        />
        <span className={`save-state ${dirty ? 'dirty' : ''}`}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
      </div>
      <div className="topbar-group">
        <button
          className="btn sm ghost"
          onClick={async () => {
            if (!(await confirmDiscard())) return;
            useProjectStore.getState().newProject();
            navigate({ page: 'workspace' }, true);
          }}
          title="New empty network"
        >
          <Icon.Plus size={16} /> New
        </button>
        <button
          className="btn sm ghost"
          onClick={async () => {
            if ((await confirmDiscard()) && (await openFileDialog())) navigate({ page: 'workspace' }, true);
          }}
          title="Open a .networky.json file"
        >
          <Icon.Folder size={16} /> Open
        </button>
        <button className="btn sm ghost" onClick={saveProject} title="Save in this browser (Ctrl+S)">
          <Icon.Save size={16} /> Save
        </button>
        <button className="btn sm ghost" onClick={() => exportFile(name)} title="Download as a file you can share">
          <Icon.Download size={16} /> Export
        </button>
      </div>
      <div className="topbar-group">
        <button className="icon-btn" onClick={() => useTopologyStore.getState().undo()} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon.Undo />
        </button>
        <button className="icon-btn" onClick={() => useTopologyStore.getState().redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Icon.Redo />
        </button>
      </div>
      <span className="spacer" />
      <div className="mode-switch" role="radiogroup" aria-label="Mode">
        <button role="radio" aria-checked={mode === 'realtime'} className={mode === 'realtime' ? 'on' : ''} onClick={() => setMode('realtime')} title="Converged network; everything answers instantly">
          <Icon.Clock size={16} /> Realtime
        </button>
        <button role="radio" aria-checked={mode === 'simulation'} className={mode === 'simulation' ? 'on' : ''} onClick={() => setMode('simulation')} title="Watch packets hop by hop">
          <Icon.Play size={14} /> Simulation
        </button>
      </div>
      <ThemeToggle />
    </header>
  );
}
