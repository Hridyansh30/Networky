// The GradeContext checks receive: a booted copy of the learner's network and
// a few helpers, all bounded by a step budget so a broken network (a loop, a
// storm) can never hang grading.

import type { ProbeRequest } from '../engine/plugin';
import type { Simulation } from '../engine/simulation';
import type { DropPoint, GradeContext } from './types';

/** Steps one probe may take. A ping across 15 routers needs well under 200. */
export const PROBE_STEP_BUDGET = 3000;

export function createContext(sim: Simulation): GradeContext {
  const t = sim.topology;
  const byHostname = new Map(Object.values(t.devices).map((d) => [d.hostname.toLowerCase(), d]));
  const hostnameOf = (deviceId?: string) => (deviceId ? t.devices[deviceId]?.hostname : undefined);

  return {
    sim,
    topology: t,
    device: (hostname) => byHostname.get(hostname.toLowerCase()),
    port: (device, name) => device.interfaceIds.map((id) => t.interfaces[id]).find((i) => i.name.toLowerCase() === name.toLowerCase()),
    probe(request: ProbeRequest) {
      const p = sim.probe(request);
      sim.run(PROBE_STEP_BUDGET);
      return p;
    },
    settle() {
      sim.run(PROBE_STEP_BUDGET);
    },
    dropSince(tick: number): DropPoint | undefined {
      // A 'drop' names the device that discarded the frame; a 'failure' is
      // usually the sender giving up, so it is only the fallback.
      let failure: DropPoint | undefined;
      for (let i = sim.log.length - 1; i >= 0; i--) {
        const e = sim.log.at(i)!;
        if (e.tick < tick) break;
        if (e.kind === 'drop') return { device: hostnameOf(e.deviceId), reason: e.text };
        if (e.kind === 'failure' && !failure) failure = { device: hostnameOf(e.deviceId), reason: e.text };
      }
      return failure;
    },
  };
}
