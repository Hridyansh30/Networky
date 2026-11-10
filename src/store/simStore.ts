// Holds the running Simulation. The engine object is mutable (it's a
// simulation clock), so the store keeps a `version` number that bumps after
// every change; components select `version` to re-render.
//
// Changing the topology (not just moving a device) power-cycles the
// simulation: tables are cleared, like rebooting every device.

import { create } from 'zustand';
import { Simulation } from '../engine/simulation';
import { traceroute, type TraceHop } from '../engine/traceroute';
import { useTopologyStore } from './topologyStore';

interface SimState {
  sim: Simulation;
  version: number;
  playing: boolean;
  /** ms per tick when playing */
  speed: number;
  lastTrace: { source: string; destination: string; hops: TraceHop[] } | null;
  ping(sourceDeviceId: string, destination: string): void;
  trace(sourceDeviceId: string, destination: string): void;
  step(): void;
  setPlaying(playing: boolean): void;
  setSpeed(ms: number): void;
  reset(note?: string): void;
}

export const useSimStore = create<SimState>()((set, get) => {
  const bump = () => set((s) => ({ version: s.version + 1 }));
  return {
    sim: new Simulation(useTopologyStore.getState().topology),
    version: 0,
    playing: false,
    speed: 700,
    lastTrace: null,

    ping(source, destination) {
      get().sim.ping(source, destination);
      set({ playing: true });
      bump();
    },

    trace(source, destination) {
      // traceroute runs to completion on a scratch copy of the network state,
      // so it doesn't clutter the animation. Its result is shown as a table.
      const scratch = new Simulation(useTopologyStore.getState().topology);
      const hops = traceroute(scratch, source, destination);
      set({ lastTrace: { source, destination, hops } });
      bump();
    },

    step() {
      const { sim } = get();
      if (sim.isIdle()) {
        set({ playing: false });
        return;
      }
      sim.step();
      if (sim.isIdle()) set({ playing: false });
      bump();
    },

    setPlaying(playing) {
      set({ playing: playing && !get().sim.isIdle() });
    },

    setSpeed(speed) {
      set({ speed });
    },

    reset(note) {
      const sim = new Simulation(useTopologyStore.getState().topology);
      if (note) sim.log.push({ tick: 0, kind: 'info', text: note });
      set({ sim, playing: false });
      bump();
    },
  };
});

// Any topology edit resets the simulation. Layout moves don't.
useTopologyStore.subscribe((state, prev) => {
  if (state.topology !== prev.topology) {
    useSimStore.getState().reset('Network changed: every device restarted with empty ARP and MAC tables.');
  }
});
