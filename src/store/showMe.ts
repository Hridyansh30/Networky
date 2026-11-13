// "Show me": replay a failed test's traffic on the learner's own network in
// Simulation mode, so they watch where it dies instead of reading about it.
// The check plugin says what to send (CheckPlugin.replay); this turns that
// into a ping / TCP probe or a browser visit on the visible simulation.

import { browse } from '../apps/client';
import { createDisk } from '../engine/plugins/apps/disk';
import type { ReplayAction } from '../grading/types';
import { useSimStore } from './simStore';
import { useTopologyStore } from './topologyStore';

export type ShowMeResult = { ok: true } | { ok: false; error: string };

export function showMe(action: ReplayAction): ShowMeResult {
  const t = useTopologyStore.getState().topology;
  const src = Object.values(t.devices).find((d) => d.hostname.toLowerCase() === action.from.toLowerCase());
  if (!src) return { ok: false, error: `There is no device named ${action.from} in your network.` };
  const sim = useSimStore.getState();
  sim.setMode('simulation');
  sim.reset({ note: `Show me: replaying this traffic from ${src.hostname}. Press Play or Step.` });
  if (action.kind === 'http') {
    useSimStore.getState().runApp((s) => browse(s, createDisk(), src.id, action.url));
  } else {
    useSimStore.getState().send(action.kind === 'tcp' ? { kind: 'tcp', sourceDeviceId: src.id, destination: action.to, port: action.port } : { kind: 'ping', sourceDeviceId: src.id, destination: action.to });
  }
  return { ok: true };
}
