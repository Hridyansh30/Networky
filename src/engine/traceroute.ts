// traceroute is just ping with a growing TTL. TTL=1 dies at the first router,
// which answers "time exceeded" and so reveals itself; TTL=2 reveals the
// second router, and so on, until the destination itself replies.

import type { Simulation } from './simulation';

export interface TraceHop {
  ttl: number;
  address?: string; // who answered
  status: 'time-exceeded' | 'reached' | 'unreachable' | 'no-answer';
}

export function traceroute(sim: Simulation, sourceDeviceId: string, destination: string, maxHops = 16): TraceHop[] {
  const hops: TraceHop[] = [];
  for (let ttl = 1; ttl <= maxHops; ttl++) {
    const ping = sim.ping(sourceDeviceId, destination, { ttl, seq: ttl });
    sim.run();
    const from = ping.respondent; // works for IPv4 and IPv6
    if (ping.status === 'ttl-exceeded') hops.push({ ttl, address: from, status: 'time-exceeded' });
    else if (ping.status === 'success') {
      hops.push({ ttl, address: from ?? destination, status: 'reached' });
      break;
    } else if (ping.status === 'unreachable') {
      hops.push({ ttl, address: from, status: 'unreachable' });
      break;
    } else hops.push({ ttl, status: 'no-answer' });
  }
  return hops;
}
