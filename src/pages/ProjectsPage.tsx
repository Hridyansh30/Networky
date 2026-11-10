import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../app/router';
import { EXAMPLES, type Example } from '../model/examples';
import { serialize, type NetworkyFile } from '../model/serialize';
import { useProjectStore } from '../store/projectStore';
import type { ProjectSummary } from '../storage/projectRepository';
import { confirmAction } from '../ui/Confirm';
import { Icon } from '../ui/icons';
import { downloadFile, openFileDialog } from '../ui/openFile';
import { TopNav } from '../ui/TopNav';
import { TopologyThumbnail } from '../ui/TopologyThumbnail';
import { useTopologyStore } from '../store/topologyStore';

const ago = (t: number) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

export function ProjectsPage() {
  const projects = useProjectStore((s) => s.projects);
  const loading = useProjectStore((s) => s.loading);
  const [query, setQuery] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  useEffect(() => {
    void useProjectStore.getState().refresh();
  }, []);

  const q = query.trim().toLowerCase();
  const shown = projects.filter((p) => (!starredOnly || p.starred) && (!q || p.name.toLowerCase().includes(q)));
  const labs = EXAMPLES.filter((e) => !q || e.name.toLowerCase().includes(q) || e.topics.some((t) => t.toLowerCase().includes(q)));

  const start = () => {
    useProjectStore.getState().newProject();
    navigate({ page: 'workspace' });
  };

  return (
    <div className="page">
      <TopNav />
      <main className="content">
        <div className="page-head">
          <div>
            <h1>Projects</h1>
            <p className="muted">Networks you saved in this browser, and sample labs to start from.</p>
          </div>
          <div className="page-actions">
            <label className="search">
              <Icon.Search size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects and labs" aria-label="Search projects and labs" />
            </label>
            <button className="btn" onClick={async () => (await openFileDialog()) && navigate({ page: 'workspace' })}>
              <Icon.Folder size={17} /> Open file
            </button>
            <button className="btn btn-primary" onClick={start}>
              <Icon.Plus size={17} /> New project
            </button>
          </div>
        </div>

        <section className="block">
          <div className="block-head">
            <h2>Recent projects</h2>
            <div className="seg" role="radiogroup" aria-label="Filter">
              <button role="radio" aria-checked={!starredOnly} className={!starredOnly ? 'on' : ''} onClick={() => setStarredOnly(false)}>
                All
              </button>
              <button role="radio" aria-checked={starredOnly} className={starredOnly ? 'on' : ''} onClick={() => setStarredOnly(true)}>
                <Icon.Star size={14} /> Starred
              </button>
            </div>
          </div>
          {loading && !projects.length ? (
            <p className="muted">Loading…</p>
          ) : shown.length ? (
            <div className="card-grid">
              {shown.map((p) => (
                <ProjectCard key={p.id} p={p} />
              ))}
            </div>
          ) : (
            <div className="empty-card">
              <Icon.Folder size={30} />
              <p>{projects.length ? 'No projects match.' : 'No saved projects yet. Build a network and press Save: it stays in this browser.'}</p>
              {!projects.length && (
                <button className="btn btn-primary" onClick={start}>
                  <Icon.Plus size={17} /> New project
                </button>
              )}
            </div>
          )}
        </section>

        <section className="block">
          <div className="block-head">
            <h2>Sample labs</h2>
            <a className="btn ghost sm" href="#/learn">
              All labs with exercises <Icon.ArrowRight size={15} />
            </a>
          </div>
          <div className="card-grid">
            {labs.map((e) => (
              <LabCard key={e.name} lab={e} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function ProjectCard({ p }: { p: ProjectSummary }) {
  const [file, setFile] = useState<NetworkyFile | null>(null);
  const repo = useProjectStore((s) => s.repo);
  const refresh = useProjectStore((s) => s.refresh);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  useEffect(() => {
    let live = true;
    repo.get(p.id).then((x) => live && setFile(x?.file ?? null));
    return () => {
      live = false;
    };
  }, [repo, p.id, p.updatedAt]);

  const open = () => navigate({ page: 'workspace', projectId: p.id });
  const notify = useTopologyStore.getState().notify;

  return (
    <article className="card project-card">
      <button className="card-thumb" onClick={open} aria-label={`Open ${p.name}`}>
        {file ? <TopologyThumbnail topology={file.topology} layout={file.layout} /> : <div className="thumb" />}
      </button>
      <div className="card-body">
        {renaming ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await repo.rename(p.id, name.trim() || p.name);
              setRenaming(false);
              await refresh();
            }}
          >
            <input autoFocus value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} onBlur={() => setRenaming(false)} aria-label="New name" />
          </form>
        ) : (
          <h3>
            <button className="text-btn" onClick={open}>
              {p.name}
            </button>
          </h3>
        )}
        <p className="muted small">
          {p.deviceCount} devices · edited {ago(p.updatedAt)}
        </p>
      </div>
      <div className="card-actions">
        <button
          className={`icon-btn sm ${p.starred ? 'starred' : ''}`}
          onClick={async () => {
            await repo.setStarred(p.id, !p.starred);
            await refresh();
          }}
          aria-label={p.starred ? 'Unstar' : 'Star'}
          title={p.starred ? 'Unstar' : 'Star'}
        >
          <Icon.Star size={16} filled={p.starred} />
        </button>
        <button className="icon-btn sm" onClick={() => setRenaming(true)} aria-label="Rename" title="Rename">
          <Icon.Edit size={16} />
        </button>
        <button
          className="icon-btn sm"
          onClick={async () => {
            const full = await repo.get(p.id);
            if (!full) return notify('Project not found');
            downloadFile(serialize(full.file), p.name);
          }}
          aria-label="Export"
          title="Download as a file"
        >
          <Icon.Download size={16} />
        </button>
        <button
          className="icon-btn sm danger-text"
          onClick={async () => {
            if (!(await confirmAction({ title: `Delete “${p.name}”?`, message: 'The project is removed from this browser. This cannot be undone. Export it first if you want a copy.', confirmLabel: 'Delete project', danger: true }))) return;
            await repo.delete(p.id);
            if (useProjectStore.getState().id === p.id) useProjectStore.setState({ id: undefined });
            await refresh();
          }}
          aria-label="Delete"
          title="Delete"
        >
          <Icon.Trash size={16} />
        </button>
      </div>
    </article>
  );
}


export function LabCard({ lab, detailed }: { lab: Example; detailed?: boolean }) {
  const file = useMemo(() => lab.build(), [lab]);
  const open = () => {
    useProjectStore.getState().openLab(lab);
    navigate({ page: 'workspace' });
  };
  return (
    <article className={`card lab-card ${detailed ? 'detailed' : ''}`}>
      <button className="card-thumb" onClick={open} aria-label={`Open lab: ${lab.name}`}>
        <TopologyThumbnail topology={file.topology} layout={file.layout} height={detailed ? 170 : 140} />
      </button>
      <div className="card-body">
        <div className="lab-meta">
          <span className={`level level-${lab.level.toLowerCase()}`}>{lab.level}</span>
          <span className="muted small">
            <Icon.Clock size={14} /> {lab.minutes} min
          </span>
        </div>
        <h3>
          <button className="text-btn" onClick={open}>
            {lab.name}
          </button>
        </h3>
        <p className="muted small clamp">{lab.description}</p>
        <div className="topics">
          {lab.topics.map((t) => (
            <span key={t} className="topic">
              {t}
            </span>
          ))}
        </div>
        {detailed && (
          <>
            <h4 className="small">Try it</h4>
            <ul className="try">
              {lab.exercises.map((x, k) => (
                <li key={k} className="small">
                  <span className="mono">
                    {x.kind === 'tcp' ? 'TCP' : 'ping'} {x.from} → {x.to}
                    {x.port ? `:${x.port}` : ''}
                  </span>{' '}
                  <span className="muted">({x.expect})</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="card-actions">
        <button className="btn btn-primary sm" onClick={open}>
          Open lab <Icon.ArrowRight size={15} />
        </button>
      </div>
    </article>
  );
}
