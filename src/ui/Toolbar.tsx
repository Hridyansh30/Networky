import { useRef } from 'react';
import { CABLES, CABLE_TYPES } from '../model/catalog';
import { EXAMPLES } from '../model/examples';
import { useTopologyStore } from '../store/topologyStore';

export function Toolbar() {
  const cable = useTopologyStore((s) => s.cable);
  const canUndo = useTopologyStore((s) => s.past.length > 0);
  const canRedo = useTopologyStore((s) => s.future.length > 0);
  const counts = useTopologyStore((s) => `${Object.keys(s.topology.devices).length} devices · ${Object.keys(s.topology.links).length} cables`);
  const s = useTopologyStore.getState;
  const fileInput = useRef<HTMLInputElement>(null);

  const download = () => {
    const blob = new Blob([s().save()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'network.networky.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <header className="toolbar">
      <strong className="brand">Networky</strong>
      <div className="group" role="radiogroup" aria-label="Cable type">
        <span className="muted">Cable:</span>
        {CABLE_TYPES.map((c) => (
          <button key={c} role="radio" aria-checked={cable === c} className={`cable-btn cable-${c} ${cable === c ? 'active' : ''}`} onClick={() => s().setCable(c)}>
            {CABLES[c].label}
          </button>
        ))}
      </div>
      <div className="group">
        <button onClick={() => s().undo()} disabled={!canUndo} title="Ctrl+Z">
          Undo
        </button>
        <button onClick={() => s().redo()} disabled={!canRedo} title="Ctrl+Shift+Z">
          Redo
        </button>
        <button onClick={() => s().reset()}>New</button>
        <button onClick={download}>Save</button>
        <button onClick={() => fileInput.current?.click()}>Load</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) s().load(await file.text());
            e.target.value = '';
          }}
        />
      </div>
      <select
        className="examples"
        aria-label="Load an example network"
        value=""
        onChange={(e) => {
          const ex = EXAMPLES[Number(e.target.value)];
          if (ex) s().loadSnapshot(ex.build(), `${ex.name}: ${ex.description}`);
        }}
      >
        <option value="">Examples…</option>
        {EXAMPLES.map((ex, i) => (
          <option key={ex.name} value={i}>
            {ex.name}
          </option>
        ))}
      </select>
      <span className="muted counts">{counts}</span>
    </header>
  );
}
