import { useEffect, useRef, useState } from 'react';
import { pduDetails } from '../../inspect/pdu';
import { useSimStore } from '../../store/simStore';
import { Icon } from '../icons';
import { protocolInfo, protocolOfTag } from '../protocols';

/**
 * One event from the list, opened: the frame broken down by OSI layer, top
 * layer first, plus the raw data. Opened by clicking a row in the event list.
 */
export function PduModal() {
  const openHop = useSimStore((s) => s.openHop);
  const sim = useSimStore((s) => s.sim);
  const setOpenHop = useSimStore((s) => s.setOpenHop);
  const [tab, setTab] = useState<'osi' | 'raw'>('osi');
  const dialog = useRef<HTMLDivElement>(null);
  const hop = openHop === null ? undefined : sim.hops.find((h) => h.index === openHop);

  useEffect(() => {
    if (!hop) return;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenHop(null);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const k = sim.hops.findIndex((h) => h.index === openHop);
        const next = sim.hops[k + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) setOpenHop(next.index);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hop, openHop, sim, setOpenHop]);

  if (!hop) return null;
  const pdu = pduDetails(sim, hop);
  const proto = protocolInfo(protocolOfTag(hop.tag));
  const k = sim.hops.findIndex((h) => h.index === openHop);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpenHop(null)}>
      <div className="modal pdu" role="dialog" aria-modal="true" aria-labelledby="pdu-title" tabIndex={-1} ref={dialog}>
        <header className="modal-head">
          <span className="proto-pill lg" style={{ ['--c' as string]: proto.color }}>
            {proto.label}
          </span>
          <div>
            <h2 id="pdu-title">PDU details · event {pdu.index + 1}</h2>
            <p className="muted small">
              {pdu.from} → {pdu.to} · at {(pdu.tick / 1000).toFixed(3)}s
            </p>
          </div>
          <span className="spacer" />
          <button className="icon-btn" disabled={k <= 0} onClick={() => setOpenHop(sim.hops[k - 1].index)} aria-label="Previous event" title="Previous event (←)">
            <Icon.ChevronRight size={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button className="icon-btn" disabled={k >= sim.hops.length - 1} onClick={() => setOpenHop(sim.hops[k + 1].index)} aria-label="Next event" title="Next event (→)">
            <Icon.ChevronRight size={18} />
          </button>
          <button className="icon-btn" onClick={() => setOpenHop(null)} aria-label="Close" title="Close (Esc)">
            <Icon.Close size={18} />
          </button>
        </header>
        <p className="pdu-summary">{pdu.summary}</p>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'osi'} className={tab === 'osi' ? 'on' : ''} onClick={() => setTab('osi')}>
            <Icon.Layers size={15} /> OSI layers
          </button>
          <button role="tab" aria-selected={tab === 'raw'} className={tab === 'raw' ? 'on' : ''} onClick={() => setTab('raw')}>
            <Icon.Table size={15} /> Raw data
          </button>
        </div>
        <div className="modal-body">
          {tab === 'osi' ? (
            <ol className="osi">
              {pdu.sections.map((s) => (
                <li key={s.layer + s.title}>
                  <span className={`layer layer-${s.layer.toLowerCase()}`}>{s.layer}</span>
                  <div className="osi-card">
                    <h4>{s.title}</h4>
                    <dl>
                      {s.fields.map((f) => (
                        <div key={f.label}>
                          <dt>{f.label}</dt>
                          <dd className="mono">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {s.inner && (
                      <div className="osi-inner">
                        <h5>{s.inner.title}</h5>
                        <dl>
                          {s.inner.fields.map((f) => (
                            <div key={f.label}>
                              <dt>{f.label}</dt>
                              <dd className="mono">{f.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <pre className="raw">{JSON.stringify(pdu.raw, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
