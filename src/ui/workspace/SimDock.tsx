// The bottom dock: send pings and TCP tests, play the simulation one hop at a
// time, filter protocols, read every hop in the event list, see the
// network's configuration issues and (for labs) the exercises.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Probe } from '../../engine/plugin';
import { isHostKind } from '../../model/catalog';
import { labByName, useProjectStore } from '../../store/projectStore';
import { validate } from '../../model/validate';
import { useSimStore } from '../../store/simStore';
import { useTopologyStore } from '../../store/topologyStore';
import { Icon } from '../icons';
import { PROTOCOLS, protocolInfo, protocolOfTag } from '../protocols';

type DockTab = 'events' | 'issues' | 'lab';

export function SimDock() {
  const mode = useSimStore((s) => s.mode);
  const lab = labByName(useProjectStore((s) => s.lab));
  const topology = useTopologyStore((s) => s.topology);
  const issues = useMemo(() => validate(topology), [topology]);
  const [tab, setTab] = useState<DockTab>('events');
  const [open, setOpen] = useState(true);
  usePlayback();

  const tabs: [DockTab, string, number | undefined][] = [
    ['events', mode === 'simulation' ? 'Event list' : 'Results', undefined],
    ['issues', 'Issues', issues.length],
    ...(lab ? ([['lab', 'Lab exercises', lab.exercises.length]] as [DockTab, string, number][]) : []),
  ];
  const current = tabs.some(([t]) => t === tab) ? tab : 'events';

  return (
    <section className={`dock ${open ? '' : 'collapsed'}`} aria-label="Simulation">
      <header className="dock-head">
        <div className="tabs" role="tablist">
          {tabs.map(([t, label, n]) => (
            <button
              key={t}
              role="tab"
              aria-selected={current === t}
              className={current === t ? 'on' : ''}
              onClick={() => {
                setTab(t);
                setOpen(true);
              }}
            >
              {label}
              {n !== undefined && <span className={`count ${t === 'issues' && issues.some((i) => i.severity === 'error') ? 'bad' : ''}`}>{n}</span>}
            </button>
          ))}
        </div>
        {mode === 'simulation' && <PlayControls />}
        <button className="icon-btn sm" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse panel' : 'Expand panel'} title={open ? 'Collapse' : 'Expand'}>
          <Icon.ChevronDown size={18} style={{ transform: open ? undefined : 'rotate(180deg)' }} />
        </button>
      </header>
      {open && (
        <div className="dock-body">
          {current === 'events' && <EventsPane />}
          {current === 'issues' && <IssuesPane issues={issues} />}
          {current === 'lab' && lab && <LabPane />}
        </div>
      )}
    </section>
  );
}

/** Steps the simulation on a timer while playing. */
function usePlayback() {
  const playing = useSimStore((s) => s.playing);
  const speed = useSimStore((s) => s.speed);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => useSimStore.getState().step(), 1000 / speed);
    return () => clearInterval(timer);
  }, [playing, speed]);
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

function PlayControls() {
  const playing = useSimStore((s) => s.playing);
  const speed = useSimStore((s) => s.speed);
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const st = useSimStore.getState();
  const idle = sim.isIdle();
  return (
    <div className="play" role="group" aria-label="Playback">
      <button className="icon-btn" onClick={() => st.setPlaying(!playing)} disabled={idle && !playing} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Icon.Pause /> : <Icon.Play />}
      </button>
      <button className="icon-btn" onClick={() => st.step()} disabled={idle} title="Move every frame one hop" aria-label="Step forward">
        <Icon.Step />
      </button>
      <button className="icon-btn" onClick={() => st.reset()} title="Clear the event list and restart" aria-label="Reset simulation">
        <Icon.Reset />
      </button>
      <button className="btn sm ghost" onClick={() => st.reset({ watchBoot: true })} title="Restart every device and watch STP, routing protocols and DHCP start up">
        <Icon.Zap size={15} /> Watch boot
      </button>
      <label className="speed" title="Hops per second">
        <span className="muted small">Speed</span>
        <select value={speed} onChange={(e) => st.setSpeed(Number(e.target.value))} aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <span className="muted small tick">{idle ? 'idle' : `${sim.inFlight.length} in flight`}</span>
    </div>
  );
}

function EventsPane() {
  const mode = useSimStore((s) => s.mode);
  return (
    <div className={`events ${mode}`}>
      <div className="events-side">
        <SendForm />
        <ProbeResults />
      </div>
      {mode === 'simulation' ? (
        <div className="events-main">
          <ProtocolFilters />
          <EventTable />
        </div>
      ) : (
        <div className="events-main realtime-note">
          <Icon.Zap size={22} />
          <p>
            <b>Realtime mode.</b> The network is already converged and pings finish instantly. Switch to <b>Simulation</b> at the top to watch each frame hop from port to port and open any of them by OSI layer.
          </p>
        </div>
      )}
    </div>
  );
}

function SendForm() {
  const topology = useTopologyStore((s) => s.topology);
  const selection = useTopologyStore((s) => s.selection);
  const sources = Object.values(topology.devices)
    .filter((d) => isHostKind(d.kind) || d.kind === 'router')
    .sort((a, b) => a.hostname.localeCompare(b.hostname, undefined, { numeric: true }));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'ping' | 'tcp'>('ping');
  const [port, setPort] = useState('80');
  const selected = selection?.type === 'device' && sources.some((d) => d.id === selection.id) ? selection.id : '';
  const source = topology.devices[from] ? from : selected || sources[0]?.id || '';

  if (!sources.length) return <p className="muted small">Add a PC, laptop, server or router to send traffic.</p>;
  return (
    <form
      className="send-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!to.trim()) return;
        useSimStore.getState().send({ kind, sourceDeviceId: source, destination: to.trim(), port: kind === 'tcp' ? Number(port) : undefined });
      }}
    >
      <div className="seg" role="radiogroup" aria-label="Traffic type">
        <button type="button" role="radio" aria-checked={kind === 'ping'} className={kind === 'ping' ? 'on' : ''} onClick={() => setKind('ping')}>
          Ping
        </button>
        <button type="button" role="radio" aria-checked={kind === 'tcp'} className={kind === 'tcp' ? 'on' : ''} onClick={() => setKind('tcp')}>
          TCP
        </button>
      </div>
      <select value={source} onChange={(e) => setFrom(e.target.value)} aria-label="Source device">
        {sources.map((d) => (
          <option key={d.id} value={d.id}>
            {d.hostname}
          </option>
        ))}
      </select>
      <Icon.ArrowRight size={16} className="muted" />
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="destination IP" aria-label="Destination address" maxLength={45} />
      {kind === 'tcp' && <input value={port} onChange={(e) => setPort(e.target.value)} className="narrow" aria-label="TCP port" inputMode="numeric" />}
      <button className="btn btn-primary sm" type="submit" disabled={!to.trim()}>
        <Icon.Envelope size={15} /> Send
      </button>
    </form>
  );
}

const STATUS_TEXT: Record<Probe['status'], string> = {
  pending: 'In progress',
  success: 'Successful',
  refused: 'Refused',
  unreachable: 'Unreachable',
  prohibited: 'Prohibited',
  'ttl-exceeded': 'TTL exceeded',
  lost: 'Timed out',
};

function ProbeResults() {
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const topology = useTopologyStore((s) => s.topology);
  const probes = sim.pings.slice(-30).reverse();
  if (!probes.length) return <p className="muted small">Results of pings and TCP tests you send appear here.</p>;
  return (
    <ul className="results" aria-label="Results">
      {probes.map((p) => (
        <li key={p.id} className={`result r-${p.status}`} title={p.detail}>
          <i className="dot" />
          <span className="mono">
            {p.kind === 'tcp' ? 'TCP' : 'Ping'} {topology.devices[p.sourceDeviceId]?.hostname ?? '?'} → {p.destination}
            {p.port ? `:${p.port}` : ''}
          </span>
          <b>{STATUS_TEXT[p.status]}</b>
        </li>
      ))}
    </ul>
  );
}

function ProtocolFilters() {
  const filters = useSimStore((s) => s.filters);
  const toggle = useSimStore((s) => s.toggleFilter);
  return (
    <div className="filters" role="group" aria-label="Protocol filters">
      <span className="muted small">Show</span>
      {PROTOCOLS.map((p) => (
        <button key={p.key} className={`proto-chip ${filters[p.key] ? 'on' : ''}`} style={{ ['--c' as string]: p.color }} onClick={() => toggle(p.key)} aria-pressed={filters[p.key]} title={p.title}>
          <i />
          {p.label}
        </button>
      ))}
    </div>
  );
}

function EventTable() {
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const filters = useSimStore((s) => s.filters);
  const setOpenHop = useSimStore((s) => s.setOpenHop);
  const topology = sim.topology;
  const end = useRef<HTMLTableRowElement>(null);
  const rows = sim.hops.filter((h) => filters[protocolOfTag(h.tag)]);
  const shown = rows.slice(-500);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' }); // newer browsers return a Promise here: keep it out of the effect's return
  }, [rows.length]);

  if (!rows.length)
    return (
      <div className="events-empty muted">
        <Icon.Envelope size={22} />
        <p>No events yet. Send a ping, then press Play or Step. Every hop a frame makes shows up here; click one to open it.</p>
      </div>
    );
  return (
    <div className="table-wrap events-table">
      {rows.length > shown.length && <p className="muted small">Showing the last {shown.length} of {rows.length} events.</p>}
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th title="Simulated time: one tick per hop, shown as milliseconds">Time</th>
            <th>From</th>
            <th>To</th>
            <th>Protocol</th>
            <th>Info</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((h) => {
            const p = protocolInfo(protocolOfTag(h.tag));
            return (
              <tr key={h.index} className="clickable" onClick={() => setOpenHop(h.index)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenHop(h.index)}>
                <td className="muted">{h.index + 1}</td>
                <td className="mono">{(h.tick / 1000).toFixed(3)}s</td>
                <td>{topology.devices[h.fromDevice]?.hostname}</td>
                <td>{topology.devices[h.toDevice]?.hostname}</td>
                <td>
                  <span className="proto-pill" style={{ ['--c' as string]: p.color }}>
                    {h.tag === 'icmp-error' ? 'ICMP err' : p.label}
                  </span>
                </td>
                <td className="info">{sim.describe(h.frame.payload)}</td>
              </tr>
            );
          })}
          <tr ref={end} aria-hidden="true" />
        </tbody>
      </table>
    </div>
  );
}

function IssuesPane({ issues }: { issues: ReturnType<typeof validate> }) {
  const select = useTopologyStore((s) => s.select);
  if (!issues.length)
    return (
      <div className="events-empty ok">
        <Icon.Check size={22} />
        <p>No configuration issues found.</p>
      </div>
    );
  return (
    <ul className="issues">
      {issues.map((i, k) => (
        <li key={k} className={`issue ${i.severity}`}>
          {i.severity === 'error' ? <Icon.Alert size={17} /> : <Icon.Info size={17} />}
          <span>{i.message}</span>
          {i.deviceIds[0] && (
            <button className="btn sm ghost" onClick={() => select({ type: 'device', id: i.deviceIds[0] })}>
              Show
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

const EXPECT_TEXT: Record<string, string> = { success: 'should succeed', unreachable: 'should be unreachable', prohibited: 'should be blocked by an ACL', refused: 'should be refused', lost: 'should time out' };

function LabPane() {
  const lab = labByName(useProjectStore((s) => s.lab))!;
  const topology = useTopologyStore((s) => s.topology);
  const [results, setResults] = useState<Record<number, Probe['status']>>({});
  const byName = (n: string) => Object.values(topology.devices).find((d) => d.hostname === n)?.id;
  useEffect(() => {
    setResults({});
  }, [topology]);

  return (
    <div className="lab-pane">
      <p className="muted">{lab.description}</p>
      <ol className="exercises">
        {lab.exercises.map((x, k) => {
          const got = results[k];
          const pass = got !== undefined && got === x.expect;
          return (
            <li key={k} className={got === undefined ? '' : pass ? 'pass' : 'fail'}>
              <div>
                <b className="mono">
                  {x.kind === 'tcp' ? 'TCP' : 'ping'} {x.from} → {x.to}
                  {x.port ? `:${x.port}` : ''}
                </b>{' '}
                <span className="muted">{EXPECT_TEXT[x.expect]}</span>
                <p className="small">{x.why}</p>
                {got !== undefined && <p className="small">{pass ? '✓ As expected.' : `✗ Got “${STATUS_TEXT[got]}”. Check the configuration, or this is the change the lab asks you to make.`}</p>}
              </div>
              <button
                className="btn sm"
                disabled={!byName(x.from)}
                onClick={() => {
                  const p = useSimStore.getState().send({ kind: x.kind, sourceDeviceId: byName(x.from)!, destination: x.to, port: x.port });
                  if (useSimStore.getState().mode === 'realtime') setResults((r) => ({ ...r, [k]: p.status }));
                  else waitFor(p, (status) => setResults((r) => ({ ...r, [k]: status })));
                }}
              >
                <Icon.Play size={14} /> Run
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** In simulation mode a probe finishes only as you play; report when it does. */
function waitFor(p: Probe, done: (s: Probe['status']) => void) {
  const sim = useSimStore.getState().sim;
  const unsub = useSimStore.subscribe((state) => {
    if (state.sim !== sim) return unsub(); // network restarted: this probe is gone
    if (p.status !== 'pending') {
      unsub();
      done(p.status);
    }
  });
}
