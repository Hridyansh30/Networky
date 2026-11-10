// The running simulation, and the two ways of looking at it:
//
//   Realtime   the network is always converged (STP settled, routes learned,
//              DHCP leases handed out). Pings and CLI commands finish at once.
//   Simulation the same network, but packets you send move one hop per step
//              so you can watch them, and the event list records every hop.
//
// The engine object is mutable (it is a clock), so the store keeps a
// `version` number that bumps after every change; components select it to
// re-render. Any topology edit power-cycles the network.

import { create } from 'zustand';
import type { Probe, ProbeRequest } from '../engine/plugin';
import { DEFAULT_PLUGINS } from '../engine/plugins';
import { Simulation } from '../engine/simulation';
import { traceroute, type TraceHop } from '../engine/traceroute';
import type { Topology } from '../model/types';
import { PROTOCOLS, type ProtocolKey } from '../ui/protocols';
import { useTopologyStore } from './topologyStore';

export type SimMode = 'realtime' | 'simulation';

interface SimState {
  mode: SimMode;
  /** The simulation shown on the canvas and in the tables. */
  sim: Simulation;
  version: number;
  playing: boolean;
  /** 1 = one hop per second; 4 = four hops per second */
  speed: number;
  filters: Record<ProtocolKey, boolean>;
  /** Event (hop) whose PDU details are open. */
  openHop: number | null;

  setMode(mode: SimMode): void;
  /** Ping or TCP test from the simulation panel: animated in simulation mode. */
  send(request: ProbeRequest): Probe;
  /** For the CLI and the Desktop prompt: always runs to completion. */
  probeNow(request: ProbeRequest): Probe;
  traceNow(deviceId: string, destination: string): TraceHop[];
  /** A converged copy of the network, for commands in simulation mode. */
  realtimeSim(): Simulation;
  step(): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  toggleFilter(key: ProtocolKey): void;
  setOpenHop(index: number | null): void;
  /** Restart the network. `watchBoot` shows STP, routing and DHCP starting up. */
  reset(opts?: { watchBoot?: boolean; note?: string }): void;
}

const converged = (t: Topology) => new Simulation(t, DEFAULT_PLUGINS).boot().run(5000);

/** A converged network with a clean event list: what Simulation mode starts from. */
function quietStart(t: Topology): Simulation {
  const sim = converged(t);
  sim.hops = [];
  sim.log = [];
  return sim;
}

let realtimeCache: { topology: Topology; sim: Simulation } | null = null;

export const useSimStore = create<SimState>()((set, get) => {
  const bump = () => set((s) => ({ version: s.version + 1 }));
  const topology = () => useTopologyStore.getState().topology;

  return {
    mode: 'realtime',
    sim: converged(topology()),
    version: 0,
    playing: false,
    speed: 2,
    filters: Object.fromEntries(PROTOCOLS.map((p) => [p.key, true])) as Record<ProtocolKey, boolean>,
    openHop: null,

    setMode(mode) {
      if (mode === get().mode) return;
      set({ mode, playing: false, openHop: null, sim: mode === 'simulation' ? quietStart(topology()) : converged(topology()) });
      bump();
    },

    realtimeSim() {
      const t = topology();
      if (get().mode === 'realtime') return get().sim;
      if (realtimeCache?.topology !== t) realtimeCache = { topology: t, sim: converged(t) };
      return realtimeCache.sim;
    },

    send(request) {
      const { mode, sim } = get();
      const p = sim.probe(request);
      if (mode === 'realtime') sim.run(5000);
      else set({ playing: true });
      bump();
      return p;
    },

    probeNow(request) {
      const sim = get().realtimeSim();
      const p = sim.probe(request);
      sim.run(5000);
      bump();
      return p;
    },

    traceNow(deviceId, destination) {
      // traceroute runs on a scratch copy so it doesn't fill the event list
      return traceroute(converged(topology()), deviceId, destination);
    },

    step() {
      const { sim } = get();
      if (sim.isIdle()) return set({ playing: false });
      sim.step();
      if (sim.isIdle()) set({ playing: false });
      bump();
    },

    setPlaying(playing) {
      set({ playing: playing && !get().sim.isIdle() });
    },

    setSpeed(speed) {
      set({ speed: Math.min(8, Math.max(0.25, speed)) });
    },

    toggleFilter(key) {
      set((s) => ({ filters: { ...s.filters, [key]: !s.filters[key] } }));
    },

    setOpenHop(openHop) {
      set({ openHop });
    },

    reset(opts = {}) {
      const t = topology();
      let sim: Simulation;
      if (get().mode === 'realtime') sim = converged(t);
      else if (opts.watchBoot) sim = new Simulation(t, DEFAULT_PLUGINS).boot();
      else sim = quietStart(t);
      if (opts.note) sim.log.push({ tick: 0, kind: 'info', text: opts.note });
      set({ sim, playing: !!opts.watchBoot && !sim.isIdle(), openHop: null });
      bump();
    },
  };
});

// Any topology edit restarts the network. Moving a device does not.
useTopologyStore.subscribe((state, prev) => {
  if (state.topology !== prev.topology) {
    realtimeCache = null;
    useSimStore.getState().reset({ note: 'Network changed: every device restarted.' });
  }
});
