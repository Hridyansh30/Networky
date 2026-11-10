import { useReactFlow } from '@xyflow/react';
import { CATALOG, DEVICE_KINDS } from '../model/catalog';
import { useTopologyStore } from '../store/topologyStore';
import { KIND_BADGE } from './deviceStyle';

export const DRAG_TYPE = 'application/networky-device';

export function Palette() {
  const addDevice = useTopologyStore((s) => s.addDevice);
  const { screenToFlowPosition } = useReactFlow();

  // Click adds at the middle of the canvas; drag-and-drop adds where you drop.
  const addAtCenter = (kind: (typeof DEVICE_KINDS)[number]) => {
    const canvas = document.querySelector('.canvas')!.getBoundingClientRect();
    const jitter = () => Math.round((Math.random() - 0.5) * 80);
    const p = screenToFlowPosition({ x: canvas.left + canvas.width / 2, y: canvas.top + canvas.height / 2 });
    addDevice(kind, { x: p.x - 70 + jitter(), y: p.y - 30 + jitter() });
  };

  return (
    <aside className="palette">
      <h2>Devices</h2>
      {DEVICE_KINDS.map((kind) => (
        <button
          key={kind}
          className={`tile kind-${kind}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, kind);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => addAtCenter(kind)}
          title={`Drag onto the canvas, or click to add. Works at layer ${CATALOG[kind].layer}.`}
        >
          <span className="badge">{KIND_BADGE[kind]}</span>
          <span>
            {CATALOG[kind].label}
            <small>L{CATALOG[kind].layer} · {CATALOG[kind].ports.length} ports</small>
          </span>
        </button>
      ))}
      <p className="hint">Drag from one port dot to another to cable them with the cable type chosen in the toolbar.</p>
    </aside>
  );
}
