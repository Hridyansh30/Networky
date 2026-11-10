// A device's terminal: the simulated IOS CLI on routers and switches, the
// command prompt on PCs, laptops and servers. Scrollback, history and the CLI
// mode live in terminalStore, so switching devices or tabs keeps them.

import { useEffect, useRef, useState } from 'react';
import { completions } from '../../cli/ios';
import { isHostKind } from '../../model/catalog';
import { useTerminalStore } from '../../store/terminalStore';
import { useTopologyStore } from '../../store/topologyStore';
import { Icon } from '../icons';

const HOST_COMMANDS = ['arp', 'connect', 'help', 'ipconfig', 'ping', 'tracert'];

export function Terminal({ deviceId }: { deviceId: string }) {
  const term = useTerminalStore((s) => s.terminals[deviceId]) ?? useTerminalStore.getState().get(deviceId);
  const store = useTerminalStore.getState();
  const device = useTopologyStore((s) => s.topology.devices[deviceId]);
  useTopologyStore((s) => s.topology); // the prompt shows the hostname, which can change
  const [input, setInput] = useState('');
  const [historyAt, setHistoryAt] = useState<number | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = screen.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [term.lines.length]);

  useEffect(() => {
    setInput('');
    setHistoryAt(null);
  }, [deviceId]);

  if (!device) return null;
  const host = isHostKind(device.kind);
  const promptText = store.promptOf(deviceId);

  const submit = () => {
    const line = input;
    setInput('');
    setHistoryAt(null);
    if (host && /^\s*(cls|clear)\s*$/i.test(line)) return store.clear(deviceId);
    store.run(deviceId, line);
  };

  const complete = () => {
    const options = host
      ? input.includes(' ')
        ? []
        : HOST_COMMANDS.filter((c) => c.startsWith(input.trim().toLowerCase()))
      : completions(term.session, useTopologyStore.getState().topology, input);
    if (options.length === 1) {
      const keep = /\s$/.test(input) ? input : input.replace(/\S*$/, '');
      setInput(`${keep}${options[0]} `);
    } else if (options.length > 1) {
      store.print(deviceId, [promptText + input, options.join('  ')]);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const { history } = term;
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const at = historyAt === null ? history.length - 1 : Math.max(0, historyAt - 1);
      setHistoryAt(at);
      setInput(history[at]);
    } else if (e.key === 'ArrowDown' && historyAt !== null) {
      e.preventDefault();
      const at = historyAt + 1;
      if (at >= history.length) {
        setHistoryAt(null);
        setInput('');
      } else {
        setHistoryAt(at);
        setInput(history[at]);
      }
    } else if (e.key === '?' && !host) {
      // IOS shows help the moment '?' is typed, without Enter
      e.preventDefault();
      store.run(deviceId, `${input}?`);
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      store.clear(deviceId);
    }
  };

  return (
    <div className="terminal" onClick={() => field.current?.focus()}>
      <div className="terminal-bar">
        <span>
          <Icon.Terminal size={15} /> {host ? `${device.hostname}: Command Prompt` : `${device.hostname}: IOS command line`}
        </span>
        <button className="icon-btn sm" title="Clear the screen (Ctrl+L)" aria-label="Clear terminal" onClick={() => store.clear(deviceId)}>
          <Icon.Trash size={15} />
        </button>
      </div>
      <div className="terminal-screen" ref={screen} role="log" aria-live="polite" aria-label={`${device.hostname} terminal output`}>
        {term.lines.map((l, k) => (
          <div key={k} className={`term-line term-${l.kind}`}>
            {l.text || ' '}
          </div>
        ))}
        <div className="term-input-row">
          <span className="term-prompt">{promptText}</span>
          <input
            ref={field}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 512))}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label={`Command for ${device.hostname}`}
          />
        </div>
      </div>
      <div className="terminal-hint">
        {host ? 'Try: ipconfig · ping 192.168.1.1 · tracert 10.0.0.1 · arp -a · help' : 'Enter to run · Tab completes · ? lists options · ↑/↓ history · abbreviations like "conf t" and "sh ip int br" work'}
      </div>
    </div>
  );
}
