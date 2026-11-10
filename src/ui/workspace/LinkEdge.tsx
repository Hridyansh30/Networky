import { BaseEdge, EdgeLabelRenderer, useInternalNode, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react';
import { memo, useEffect, useRef } from 'react';
import type { Transmission } from '../../engine/packets';
import { shortPortName } from '../../model/catalog';
import { useSimStore } from '../../store/simStore';
import { useTopologyStore } from '../../store/topologyStore';
import { protocolOfTag } from '../protocols';
import { portState } from './portState';

export type LinkEdgeType = Edge<{ linkId: string }, 'link'>;

const CABLE_STYLE = {
  'copper-straight': { stroke: 'var(--cable-copper)', strokeDasharray: undefined },
  'copper-cross': { stroke: 'var(--cable-copper)', strokeDasharray: '7 5' },
  fiber: { stroke: 'var(--cable-fiber)', strokeDasharray: undefined },
  serial: { stroke: 'var(--cable-serial)', strokeDasharray: '2 4' },
} as const;

/** A point `d` px from (x1,y1) towards (x2,y2). */
function along(x1: number, y1: number, x2: number, y2: number, d: number) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  return { x: x1 + ((x2 - x1) / len) * d, y: y1 + ((y2 - y1) / len) * d };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxOf(n: InternalNode | undefined): Box | null {
  if (!n) return null;
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width ?? 112, h: n.measured.height ?? 100 };
}

/**
 * Where the line from box `a`'s centre towards box `b`'s centre leaves box `a`.
 * Cables meet the edge of a device's box, so they never cross its icon, its
 * hostname or its address.
 */
export function boxExit(a: Box, b: Box): { x: number; y: number } {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = b.x + b.w / 2 - cx;
  const dy = b.y + b.h / 2 - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const scale = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function LinkEdgeView({ id, source, target, data, selected }: EdgeProps<LinkEdgeType>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const link = useTopologyStore((s) => (data ? s.topology.links[data.linkId] : undefined));
  const a = useTopologyStore((s) => (link ? s.topology.interfaces[link.a] : undefined));
  const b = useTopologyStore((s) => (link ? s.topology.interfaces[link.b] : undefined));
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const speed = useSimStore((s) => s.speed);
  const filters = useSimStore((s) => s.filters);
  const mode = useSimStore((s) => s.mode);
  const box1 = boxOf(sourceNode);
  const box2 = boxOf(targetNode);
  if (!link || !a || !b || !box1 || !box2) return null;

  // Cables run between device boxes (not the port handles, which are only for
  // starting a new cable). Canvas builds every edge with link.a at `source`.
  const s1 = boxExit(box1, box2);
  const s2 = boxExit(box2, box1);
  const path = `M ${s1.x},${s1.y} L ${s2.x},${s2.y}`;
  const ledA = along(s1.x, s1.y, s2.x, s2.y, 6);
  const ledB = along(s2.x, s2.y, s1.x, s1.y, 6);
  const length = Math.hypot(s2.x - s1.x, s2.y - s1.y);
  const tagAt = Math.min(34, length / 3);
  const labelA = along(s1.x, s1.y, s2.x, s2.y, tagAt);
  const labelB = along(s2.x, s2.y, s1.x, s1.y, tagAt);
  const onWire = mode === 'simulation' ? sim.inFlight.filter((tx) => tx.linkId === link.id && filters[protocolOfTag(sim.tagOf(tx.frame))]) : [];

  return (
    <>
      <BaseEdge id={id} path={path} style={{ ...CABLE_STYLE[link.cable], strokeWidth: selected ? 4 : 2.25 }} interactionWidth={18} />
      <circle cx={ledA.x} cy={ledA.y} r={5.5} className={`led led-${portState(sim, a)}`} />
      <circle cx={ledB.x} cy={ledB.y} r={5.5} className={`led led-${portState(sim, b)}`} />
      <EdgeLabelRenderer>
        <div className="port-tag" style={{ transform: `translate(-50%, -50%) translate(${labelA.x}px, ${labelA.y}px)` }}>
          {shortPortName(a.name)}
        </div>
        <div className="port-tag" style={{ transform: `translate(-50%, -50%) translate(${labelB.x}px, ${labelB.y}px)` }}>
          {shortPortName(b.name)}
        </div>
      </EdgeLabelRenderer>
      {onWire.map((tx, idx) => (
        <Envelope key={tx.id} tx={tx} path={path} forward={tx.fromIf === link.a} durationMs={900 / speed} offset={idx * 7} />
      ))}
    </>
  );
}

export const LinkEdge = memo(LinkEdgeView);

/**
 * A frame moving along the cable, drawn as an envelope in its protocol's
 * colour. Each step mounts new envelopes (keyed by transmission id) and each
 * plays its motion once: begin="indefinite" + beginElement() at mount.
 */
function Envelope({ tx, path, forward, durationMs, offset }: { tx: Transmission; path: string; forward: boolean; durationMs: number; offset: number }) {
  const motion = useRef<SVGAnimateMotionElement>(null);
  useEffect(() => {
    motion.current?.beginElement();
  }, []);
  const sim = useSimStore((s) => s.sim);
  const proto = protocolOfTag(sim.tagOf(tx.frame));
  return (
    <g className="envelope" style={{ color: `var(--proto-${proto})` }} transform={`translate(0 ${offset})`}>
      <title>{sim.describe(tx.frame.payload)}</title>
      <g>
        <rect x={-11} y={-7.5} width={22} height={15} rx={3} />
        <path d="M-11 -7 L0 1.5 L11 -7" />
        <animateMotion ref={motion} begin="indefinite" dur={`${durationMs}ms`} fill="freeze" path={path} keyPoints={forward ? '0.1;0.8' : '0.9;0.2'} keyTimes="0;1" calcMode="linear" />
      </g>
    </g>
  );
}
