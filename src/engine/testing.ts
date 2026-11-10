// Test helpers for the engine: boot a network with every protocol and ping.
import type { Topology } from '../model/types';
import type { EnginePlugin } from './plugin';
import { DEFAULT_PLUGINS } from './plugins';
import { Simulation } from './simulation';

/** Boot a simulation with every protocol plugin and let the control plane settle. */
export function boot(t: Topology, plugins: readonly EnginePlugin[] = DEFAULT_PLUGINS): Simulation {
  return new Simulation(t, plugins).boot().run(5000);
}

/** Ping and run until the network is quiet; returns the probe. */
export function pingAndRun(sim: Simulation, from: string, to: string) {
  const p = sim.ping(from, to);
  sim.run(5000);
  return p;
}
