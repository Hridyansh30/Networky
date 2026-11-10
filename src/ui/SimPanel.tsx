import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG } from '../model/catalog';
import { isValidIPv4 } from '../model/ip';
import { useSimStore } from '../store/simStore';
import { useTopologyStore } from '../store/topologyStore';
import type { LogKind } from '../engine/simulation';

const STATUS_TEXT = {
  pending: 'in progress',
  success: 'success',
  unreachable: 'unreachable',
  'ttl-exceeded': 'TTL exceeded',
  lost: 'lost',
  refused: 'refused',
  prohibited: 'blocked by an ACL',
} as const;

export function SimPanel() {
  const topology = useTopologyStore((s) => s.topology);
  const selection = useTopologyStore((s) => s.selection);
  useSimStore((s) => s.version); // re-render on every tick
  const playing = useSimStore((s) => s.playing);
  const speed = useSimStore((s) => s.speed);
  const lastTrace = useSimStore((s) => s.lastTrace);
  const sim = useSimStore((s) => s.sim);
  const actions = useSimStore.getState();

  const sources = Object.values(topology.devices).filter((d) => CATALOG[d.kind].l3);
  const [source, setSource] = useState('');
  const [dest, setDest] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);

  // Default the source to the selected device when it can send IP.
  useEffect(() => {
    if (selection?.type === 'device' && CATALOG[topology.devices[selection.id]?.kind]?.l3) setSource(selection.id);
  }, [selection, topology.devices]);
  const sourceId = topology.devices[source] ? source : sources[0]?.id ?? '';

  // Play: one tick every `speed` ms until the wire is empty.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => useSimStore.getState().step(), speed);
    return () => clearInterval(timer);
  }, [playing, speed]);

  // Every IP in the network, for the destination picker.
  const knownIps = useMemo(
    () =>
      Object.values(topology.interfaces)
        .filter((i) => i.ipv4)
        .map((i) => ({ ip: i.ipv4!.address, owner: `${topology.devices[i.deviceId].hostname} ${i.name}` })),
    [topology],
  );

  const destOk = isValidIPv4(dest);
  const log = onlySelected && selection?.type === 'device' ? sim.log.filter((e) => e.deviceId === selection.id) : sim.log;

  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log.length]);

  return (
    <div className="sim">
      <div className="sim-controls">
        <form
          className="ping-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (sourceId && destOk) actions.ping(sourceId, dest.trim());
          }}
        >
          <label>
            From
            <select value={sourceId} onChange={(e) => setSource(e.target.value)} aria-label="Ping source">
              {sources.length === 0 && <option value="">add a PC, server or router</option>}
              {sources.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.hostname}
                </option>
              ))}
            </select>
          </label>
          <label>
            To
            <input list="known-ips" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="IP address" aria-label="Destination IP" />
            <datalist id="known-ips">
              {knownIps.map((k) => (
                <option key={k.ip + k.owner} value={k.ip}>
                  {k.owner}
                </option>
              ))}
            </datalist>
          </label>
          <button type="submit" disabled={!sourceId || !destOk}>
            Ping
          </button>
          <button type="button" disabled={!sourceId || !destOk} onClick={() => actions.trace(sourceId, dest.trim())}>
            Traceroute
          </button>
        </form>

        <div className="transport">
          <button onClick={() => actions.step()} disabled={sim.isIdle()} title="Move every frame one cable forward">
            Step
          </button>
          <button onClick={() => actions.setPlaying(!playing)} disabled={sim.isIdle() && !playing}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <label className="speed">
            Speed
            <input
              type="range"
              min={150}
              max={1500}
              step={50}
              value={1650 - speed}
              onChange={(e) => actions.setSpeed(1650 - Number(e.target.value))}
              aria-label="Speed"
            />
          </label>
          <button onClick={() => actions.reset('Simulation reset: ARP and MAC tables cleared.')}>Reset</button>
          <span className="muted">
            tick {sim.tick} · {sim.inFlight.length} frame{sim.inFlight.length === 1 ? '' : 's'} on the wire
          </span>
        </div>

        <ul className="pings">
          {sim.pings.slice(-6).map((p) => (
            <li key={p.id} className={`ping ping-${p.status}`}>
              <strong>{topology.devices[p.sourceDeviceId]?.hostname}</strong> → {p.destination}
              {p.ttl !== 64 && ` (TTL ${p.ttl})`}: <span className="ping-status">{STATUS_TEXT[p.status]}</span>
              {p.detail && <span className="muted"> · {p.detail}</span>}
            </li>
          ))}
        </ul>

        {lastTrace && (
          <div className="trace">
            <strong>
              traceroute {topology.devices[lastTrace.source]?.hostname ?? '?'} → {lastTrace.destination}
            </strong>
            <ol>
              {lastTrace.hops.map((h) => (
                <li key={h.ttl}>
                  {h.address ?? '*'} <span className="muted">{h.status === 'time-exceeded' ? '' : `(${h.status})`}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <div className="sim-log">
        <div className="log-head">
          <strong>Event log</strong>
          <label className="muted small">
            <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> only the selected device
          </label>
        </div>
        <ol ref={logRef}>
          {log.length === 0 && <li className="muted">Pick a source and a destination IP, then press Ping. Use Step to go one cable at a time.</li>}
          {log.map((e, idx) => (
            <li key={idx} className={`log log-${e.kind as LogKind}`}>
              <span className="tick">{e.tick}</span> {e.text}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
