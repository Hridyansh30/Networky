// The project being edited (its name and where it is saved) and the list of
// saved projects. Storage goes through the ProjectRepository interface only.

import { create } from 'zustand';
import { EXAMPLES, type Example } from '../model/examples';
import { createRepository, type ProjectRepository, type ProjectSummary } from '../storage/projectRepository';
import { useTopologyStore } from './topologyStore';

interface ProjectState {
  repo: ProjectRepository;
  /** Saved id of the open project; undefined until first saved. */
  id?: string;
  name: string;
  /** The lab this project started from, if any (shows its exercises). */
  lab?: string;
  /** Set while a problem's network is in the workspace (see problemStore). Its saving is automatic. */
  problem?: string;
  /** Topology at the last save, to know if there are unsaved changes. */
  savedTopology: unknown;
  savedLayout: unknown;
  projects: ProjectSummary[];
  loading: boolean;

  refresh(): Promise<void>;
  newProject(): void;
  openLab(example: Example): void;
  open(id: string): Promise<boolean>;
  save(): Promise<void>;
  rename(name: string): void;
  isDirty(): boolean;
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  repo: createRepository(),
  name: 'Untitled',
  savedTopology: useTopologyStore.getState().topology,
  savedLayout: useTopologyStore.getState().layout,
  projects: [],
  loading: false,

  async refresh() {
    set({ loading: true });
    try {
      set({ projects: await get().repo.list() });
    } finally {
      set({ loading: false });
    }
  },

  newProject() {
    useTopologyStore.getState().replaceAll({ topology: undefined, layout: undefined });
    const t = useTopologyStore.getState();
    set({ id: undefined, name: 'Untitled', lab: undefined, problem: undefined, savedTopology: t.topology, savedLayout: t.layout });
  },

  openLab(example) {
    const file = example.build();
    useTopologyStore.getState().replaceAll(file);
    const t = useTopologyStore.getState();
    set({ id: undefined, name: example.name, lab: example.name, problem: undefined, savedTopology: t.topology, savedLayout: t.layout });
  },

  async open(id) {
    const p = await get().repo.get(id);
    if (!p) return false;
    useTopologyStore.getState().replaceAll(p.file);
    const t = useTopologyStore.getState();
    set({ id: p.id, name: p.name, problem: undefined, lab: EXAMPLES.some((e) => e.name === p.name) ? p.name : undefined, savedTopology: t.topology, savedLayout: t.layout });
    return true;
  },

  async save() {
    const { topology, layout } = useTopologyStore.getState();
    const saved = await get().repo.save({ id: get().id, name: get().name, file: { topology, layout } });
    set({ id: saved.id, name: saved.name, savedTopology: topology, savedLayout: layout });
    await get().refresh();
  },

  rename(name) {
    set({ name: name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) || 'Untitled' });
  },

  isDirty() {
    const t = useTopologyStore.getState();
    return t.topology !== get().savedTopology || t.layout !== get().savedLayout;
  },
}));

export function labByName(name: string | undefined): Example | undefined {
  return EXAMPLES.find((e) => e.name === name);
}
