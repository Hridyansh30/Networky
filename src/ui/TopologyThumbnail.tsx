import type { Layout, Topology } from '../model/types';
import { DeviceIcon } from './icons';

/**
 * A small picture of a real topology, drawn from its data. Lab and project
 * cards use it, so a card can never show a device the network doesn't have.
 */
export function TopologyThumbnail({ topology, layout, height = 140 }: { topology: Topology; layout: Layout; height?: number }) {
  const devices = Object.values(topology.devices);
  if (!devices.length) return <div className="thumb thumb-empty" style={{ height }}>Empty network</div>;
  const pos = (id: string) => layout[id] ?? { x: 0, y: 0 };
  const xs = devices.map((d) => pos(d.id).x);
  const ys = devices.map((d) => pos(d.id).y);
  const pad = 90;
  const minX = Math.min(...xs) - pad / 2;
  const minY = Math.min(...ys) - pad / 2;
  const w = Math.max(...xs) - minX + pad * 1.5;
  const h = Math.max(...ys) - minY + pad * 1.5;
  const center = (id: string) => ({ x: pos(id).x + 60, y: pos(id).y + 40 });
  const iconSize = Math.max(64, Math.min(w, h) * 0.22);

  return (
    <svg className="thumb" viewBox={`${minX} ${minY} ${w} ${h}`} style={{ height }} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Network of ${devices.length} devices`}>
      {Object.values(topology.links).map((l) => {
        const a = center(topology.interfaces[l.a].deviceId);
        const b = center(topology.interfaces[l.b].deviceId);
        return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`thumb-link thumb-${l.cable}`} />;
      })}
      {devices.map((d) => {
        const c = center(d.id);
        return (
          <g key={d.id} transform={`translate(${c.x - iconSize / 2} ${c.y - iconSize / 2})`}>
            <DeviceIcon kind={d.kind} size={iconSize} />
          </g>
        );
      })}
    </svg>
  );
}
