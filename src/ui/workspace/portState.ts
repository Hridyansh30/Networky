import type { Simulation } from '../../engine/simulation';
import type { Interface } from '../../model/types';

export type PortState = 'free' | 'up' | 'down' | 'blocking';

/** What a port's LED shows: no cable, link up, link down, or STP blocking. */
export function portState(sim: Simulation, i: Interface): PortState {
  if (!i.linkId) return 'free';
  const live = sim.topology.interfaces[i.id] ?? i;
  if (!sim.isUp(live)) return 'down';
  return sim.portStatus(live) === 'blocking' ? 'blocking' : 'up';
}
