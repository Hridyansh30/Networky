// The app's single store. It holds the current topology + layout and an undo
// history of snapshots. Every edit goes through a model op, so the UI can never
// put the topology into a state the model would reject.
//
// Zustand stores live outside React: the phase 2 engine (or a test) can read
// useTopologyStore.getState() without rendering anything.

import { create } from 'zustand';
import * as ops from '../model/ops';
import { deserialize, serialize } from '../model/serialize';
import type { CableType, DeviceKind, Layout, Topology } from '../model/types';

export interface Snapshot {
  topology: Topology;
  layout: Layout;
}

export type Selection = { type: 'device'; id: string } | { type: 'link'; id: string } | null;

interface State extends Snapshot {
  past: Snapshot[];
  future: Snapshot[];
  selection: Selection;
  cable: CableType;
  toast: { text: string; kind: 'error' | 'info'; at: number } | null;
}

interface Actions {
  /** Runs a model op as one undo step. Shows the error as a toast if the op refuses. Returns success. */
  apply(change: (s: Snapshot) => Snapshot): boolean;
  addDevice(kind: DeviceKind, position: { x: number; y: number }): void;
  moveDevice(id: string, position: { x: number; y: number }): void;
  beginMove(): void;
  connect(ifA: string, ifB: string): void;
  deleteSelection(): void;
  select(selection: Selection): void;
  setCable(cable: CableType): void;
  undo(): void;
  redo(): void;
  reset(): void;
  save(): string;
  load(text: string): void;
  loadSnapshot(file: Snapshot, note: string): void;
  notify(text: string, kind?: 'error' | 'info'): void;
}

const HISTORY_LIMIT = 200;

const empty = (): Snapshot => ({ topology: ops.createTopology(), layout: {} });

export const useTopologyStore = create<State & Actions>()((set, get) => {
  const snapshot = (): Snapshot => ({ topology: get().topology, layout: get().layout });

  const pushHistory = () =>
    set((s) => ({ past: [...s.past, snapshot()].slice(-HISTORY_LIMIT), future: [] }));

  return {
    ...empty(),
    past: [],
    future: [],
    selection: null,
    cable: 'copper-straight',
    toast: null,

    notify(text, kind = 'error') {
      set({ toast: { text, kind, at: Date.now() } });
    },

    apply(change) {
      try {
        const next = change(snapshot());
        if (next.topology === get().topology && next.layout === get().layout) return true;
        pushHistory();
        set(next);
        return true;
      } catch (e) {
        get().notify(e instanceof Error ? e.message : String(e));
        return false;
      }
    },

    addDevice(kind, position) {
      let newId = '';
      const ok = get().apply(({ topology, layout }) => {
        const r = ops.addDevice(topology, kind);
        newId = r.deviceId;
        return { topology: r.topology, layout: { ...layout, [r.deviceId]: position } };
      });
      if (ok) set({ selection: { type: 'device', id: newId } });
    },

    // Dragging fires many position updates. beginMove() records ONE undo step
    // at drag start; moveDevice() then updates the layout without history.
    beginMove() {
      pushHistory();
    },
    moveDevice(id, position) {
      set((s) => ({ layout: { ...s.layout, [id]: position } }));
    },

    connect(ifA, ifB) {
      get().apply(({ topology, layout }) => ({ topology: ops.connect(topology, ifA, ifB, get().cable).topology, layout }));
    },

    deleteSelection() {
      const sel = get().selection;
      if (!sel) return;
      const ok = get().apply(({ topology, layout }) => {
        if (sel.type === 'link') return { topology: ops.disconnect(topology, sel.id), layout };
        const { [sel.id]: _removed, ...rest } = layout;
        return { topology: ops.removeDevice(topology, sel.id), layout: rest };
      });
      if (ok) set({ selection: null });
    },

    select(selection) {
      set({ selection });
    },

    setCable(cable) {
      set({ cable });
    },

    undo() {
      const { past } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set((s) => ({ ...prev, past: s.past.slice(0, -1), future: [snapshot(), ...s.future] }));
      dropStaleSelection();
    },

    redo() {
      const { future } = get();
      if (!future.length) return;
      const [next, ...rest] = future;
      set((s) => ({ ...next, past: [...s.past, snapshot()], future: rest }));
      dropStaleSelection();
    },

    reset() {
      pushHistory();
      set({ ...empty(), selection: null });
    },

    save() {
      return serialize(snapshot());
    },

    loadSnapshot(file, note) {
      pushHistory();
      set({ ...file, selection: null });
      get().notify(note, 'info');
    },

    load(text) {
      try {
        const file = deserialize(text);
        pushHistory();
        set({ ...file, selection: null });
        get().notify(`Loaded ${Object.keys(file.topology.devices).length} devices`, 'info');
      } catch (e) {
        get().notify(e instanceof Error ? e.message : String(e));
      }
    },
  };

  function dropStaleSelection() {
    const { selection, topology } = get();
    if (!selection) return;
    const exists = selection.type === 'device' ? topology.devices[selection.id] : topology.links[selection.id];
    if (!exists) set({ selection: null });
  }
});
