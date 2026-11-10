import { BaseEdge, getStraightPath, type Edge, type EdgeProps } from '@xyflow/react';
import { memo, useEffect, useRef } from 'react';
import type { Transmission } from '../engine/packets';
import { useSimStore } from '../store/simStore';
import { useTopologyStore } from '../store/topologyStore';

export type LinkEdgeType = Edge<{ linkId: string }, 'link'>;

const CABLE_STYLE = {
  'copper-straight': { stroke: 'var(--cable-copper)', strokeDasharray: undefined },
  'copper-cross': { stroke: 'var(--cable-copper)', strokeDasharray: '6 4' },
  fiber: { stroke: 'var(--cable-fiber)', strokeDasharray: undefined },
  serial: { stroke: 'var(--cable-serial)', strokeDasharray: '2 3' },
} as const;

/** A point `d` px from (x1,y1) towards (x2,y2). */
function along(x1: number, y1: number, x2: number, y2: number, d: number) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  return { x: x1 + ((x2 - x1) / len) * d, y: y1 + ((y2 - y1) / len) * d };
}

function LinkEdgeView({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<LinkEdgeType>) {
  const link = useTopologyStore((s) => (data ? s.topology.links[data.linkId] : undefined));
  const a = useTopologyStore((s) => (link ? s.topology.interfaces[link.a] : undefined));
  const b = useTopologyStore((s) => (link ? s.topology.interfaces[link.b] : undefined));
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const speed = useSimStore((s) => s.speed);
  if (!link || !a || !b) return null;
  const onWire = sim.inFlight.filter((tx) => tx.linkId === link.id);

  const style = CABLE_STYLE[link.cable];
  const dotA = along(sourceX, sourceY, targetX, targetY, 18);
  const dotB = along(targetX, targetY, sourceX, sourceY, 18);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ ...style, strokeWidth: selected ? 3.5 : 2 }}
        interactionWidth={16}
      />
      {/* Link-state lights, like the LEDs next to a real port */}
      <circle cx={dotA.x} cy={dotA.y} r={5} className={a.adminUp ? 'led led-up' : 'led led-down'} />
      <circle cx={dotB.x} cy={dotB.y} r={5} className={b.adminUp ? 'led led-up' : 'led led-down'} />
      {onWire.map((tx, idx) => (
        <Packet key={tx.id} tx={tx} path={path} forward={tx.fromIf === link.a} durationMs={speed * 0.85} offset={idx * 6} />
      ))}
    </>
  );
}

export const LinkEdge = memo(LinkEdgeView);

/**
 * A frame travelling along the cable. Each tick mounts new Packet elements
 * (keyed by transmission id), and each one plays its motion once.
 * SMIL's begin="indefinite" + beginElement() starts it at mount time.
 */
function Packet({ tx, path, forward, durationMs, offset }: { tx: Transmission; path: string; forward: boolean; durationMs: number; offset: number }) {
  const motion = useRef<SVGAnimateMotionElement>(null);
  useEffect(() => {
    motion.current?.beginElement();
  }, []);
  const sim = useSimStore((s) => s.sim);
  const tag = sim.tagOf(tx.frame);
  return (
    <g className={`packet packet-${tag}`} transform={`translate(0 ${offset})`}>
      <title>{sim.describe(tx.frame.payload)}</title>
      <rect x={-9} y={-6} width={18} height={12} rx={2} />
      <path d="M-9 -6 L0 1 L9 -6" fill="none" />
      <animateMotion
        ref={motion}
        begin="indefinite"
        dur={`${durationMs}ms`}
        fill="freeze"
        path={path}
        keyPoints={forward ? '0.12;0.78' : '0.88;0.22'}
        keyTimes="0;1"
        calcMode="linear"
      />
    </g>
  );
}
