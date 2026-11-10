import { useMemo, useState } from 'react';
import { validate } from '../model/validate';
import { useTopologyStore } from '../store/topologyStore';
import { IssuesPanel } from './IssuesPanel';
import { SimPanel } from './SimPanel';

export function BottomPanel() {
  const [tab, setTab] = useState<'sim' | 'issues'>('sim');
  const topology = useTopologyStore((s) => s.topology);
  const count = useMemo(() => validate(topology).length, [topology]);
  return (
    <section className="bottom">
      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'sim'} className={tab === 'sim' ? 'active' : ''} onClick={() => setTab('sim')}>
          Simulation
        </button>
        <button role="tab" aria-selected={tab === 'issues'} className={tab === 'issues' ? 'active' : ''} onClick={() => setTab('issues')}>
          Issues ({count})
        </button>
      </nav>
      <div className="tab-body">{tab === 'sim' ? <SimPanel /> : <IssuesPanel />}</div>
    </section>
  );
}
