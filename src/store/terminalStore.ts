// Scrollback and state of every device's terminal: the IOS CLI on routers and
// switches, the command prompt on PCs, laptops and servers. Kept outside the
// components so switching devices or tabs doesn't lose what was typed.

import { create } from 'zustand';
import { execute, newSession, prompt, type CliEnv, type CliSession } from '../cli/ios';
import { HOST_PROMPT, runHostCommand } from '../cli/hostShell';
import { isHostKind } from '../model/catalog';
import { useSimStore } from './simStore';
import { useTopologyStore } from './topologyStore';

export interface TermLine {
  text: string;
  kind: 'input' | 'output' | 'error';
}

interface Terminal {
  session: CliSession;
  lines: TermLine[];
  history: string[];
}

const MAX_LINES = 2000;
const MAX_INPUT = 512;

/** The CLI's view of the app: model ops through the undoable store, show/ping through the simulation. */
export const cliEnv: CliEnv = {
  topology: () => useTopologyStore.getState().topology,
  apply(change) {
    const store = useTopologyStore.getState();
    const next = change(store.topology); // throws TopologyError: shown as '% message'
    store.apply(({ layout }) => ({ topology: next, layout }));
  },
  sim: () => useSimStore.getState().realtimeSim(),
  probe: (req) => useSimStore.getState().probeNow(req),
  traceroute: (id, dst) => useSimStore.getState().traceNow(id, dst),
};

interface TerminalState {
  terminals: Record<string, Terminal>;
  get(deviceId: string): Terminal;
  run(deviceId: string, line: string): void;
  clear(deviceId: string): void;
  /** Show lines without running a command (Tab completion lists). */
  print(deviceId: string, lines: string[]): void;
  promptOf(deviceId: string): string;
}

function banner(deviceId: string): TermLine[] {
  const d = useTopologyStore.getState().topology.devices[deviceId];
  if (!d) return [];
  if (isHostKind(d.kind)) return [{ text: `Networky command prompt on ${d.hostname}. Type help for commands.`, kind: 'output' }, { text: '', kind: 'output' }];
  return [{ text: `${d.hostname} - simulated IOS. Type ? for help, Tab to complete.`, kind: 'output' }, { text: '', kind: 'output' }];
}

export const useTerminalStore = create<TerminalState>()((set, get) => ({
  terminals: {},

  get(deviceId) {
    return get().terminals[deviceId] ?? { session: newSession(deviceId), lines: banner(deviceId), history: [] };
  },

  promptOf(deviceId) {
    const d = useTopologyStore.getState().topology.devices[deviceId];
    if (!d) return '>';
    return isHostKind(d.kind) ? HOST_PROMPT : prompt(get().get(deviceId).session, useTopologyStore.getState().topology);
  },

  run(deviceId, rawLine) {
    const line = rawLine.slice(0, MAX_INPUT);
    const term = get().get(deviceId);
    const device = useTopologyStore.getState().topology.devices[deviceId];
    if (!device) return;
    const echo: TermLine = { text: get().promptOf(deviceId) + line, kind: 'input' };
    let session = term.session;
    let output: string[];
    if (isHostKind(device.kind)) output = runHostCommand(deviceId, line, cliEnv);
    else {
      const r = execute(session, line, cliEnv);
      session = r.session;
      output = r.output;
    }
    const lines = [...term.lines, echo, ...output.map((text): TermLine => ({ text, kind: text.startsWith('%') && !text.startsWith('%LINK') ? 'error' : 'output' }))].slice(-MAX_LINES);
    const history = line.trim() ? [...term.history.filter((h) => h !== line), line].slice(-100) : term.history;
    set((s) => ({ terminals: { ...s.terminals, [deviceId]: { session, lines, history } } }));
  },

  print(deviceId, lines) {
    const term = get().get(deviceId);
    const next = [...term.lines, ...lines.map((text): TermLine => ({ text, kind: 'output' }))].slice(-MAX_LINES);
    set((s) => ({ terminals: { ...s.terminals, [deviceId]: { ...term, lines: next } } }));
  },

  clear(deviceId) {
    set((s) => ({ terminals: { ...s.terminals, [deviceId]: { ...get().get(deviceId), lines: [] } } }));
  },
}));
