import { Background, ConnectionMode, MiniMap, ReactFlow, applyNodeChanges, useReactFlow, useUpdateNodeInternals, useViewport, type Connection, type IsValidConnection, type NodeChange } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isHostKind } from '../../model/catalog';
import { connectionProblem } from '../../model/ops';
import { useUiStore } from '../../store/uiStore';
import type { DeviceKind } from '../../model/types';
import { useTopologyStore } from '../../store/topologyStore';
import { Icon } from '../icons';
import { PROTOCOLS } from '../protocols';
import { DeviceNode, type DeviceNodeType } from './DeviceNode';
import { DRAG_TYPE } from './LeftPanel';
import { LinkEdge, type LinkEdgeType } from './LinkEdge';

const nodeTypes = { device: DeviceNode };
const edgeTypes = { link: LinkEdge };
type Tool = 'select' | 'pan';

/**
 * React Flow wants nodes[] and edges[]. We DERIVE them from the topology
 * instead of storing them, so the model never depends on the UI library.
 */
export function Canvas() {
  const topology = useTopologyStore((s) => s.topology);
  const layout = useTopologyStore((s) => s.layout);
  const selection = useTopologyStore((s) => s.selection);
  const cable = useTopologyStore((s) => s.cable);
  const select = useTopologyStore((s) => s.select);
  const flow = useReactFlow();
  const [tool, setTool] = useState<Tool>('select');

  // React Flow measures nodes and writes sizes back through onNodesChange.
  // Local state keeps those measurements between re-derives.
  const [nodes, setNodes] = useState<DeviceNodeType[]>([]);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return Object.values(topology.devices).map((d) => ({
        ...old.get(d.id),
        id: d.id,
        type: 'device' as const,
        position: layout[d.id] ?? { x: 0, y: 0 },
        data: { deviceId: d.id },
        selected: selection?.type === 'device' && selection.id === d.id,
      }));
    });
  }, [topology.devices, layout, selection]);

  const edges = useMemo<LinkEdgeType[]>(
    () =>
      Object.values(topology.links).map((l) => ({
        id: l.id,
        type: 'link' as const,
        source: topology.interfaces[l.a].deviceId,
        sourceHandle: l.a,
        target: topology.interfaces[l.b].deviceId,
        targetHandle: l.b,
        data: { linkId: l.id },
        selected: selection?.type === 'link' && selection.id === l.id,
      })),
    [topology.links, topology.interfaces, selection],
  );

  // A freshly opened project: frame it once its nodes are drawn.
  const deviceCount = Object.keys(topology.devices).length;
  const generation = useTopologyStore((s) => s.generation);
  useEffect(() => {
    const t = setTimeout(() => flow.fitView({ maxZoom: 1.1, padding: 0.2, duration: 200 }), 60);
    return () => clearTimeout(t);
  }, [generation, flow]);

  // A replaced network can reuse device ids with different ports (a problem's
  // "Start over" rebuilds the same hostnames with new port ids). React Flow
  // caches each node's handles by node id, so tell it to measure them again;
  // otherwise the cables have no handle to attach to and are not drawn.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(Object.keys(useTopologyStore.getState().topology.devices));
  }, [generation, updateNodeInternals]);

  const onNodesChange = useCallback((changes: NodeChange<DeviceNodeType>[]) => {
    const store = useTopologyStore.getState();
    for (const c of changes) if (c.type === 'position' && c.position) store.moveDevice(c.id, c.position);
    // Selection and removal belong to the store; apply only the rest locally.
    setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type !== 'select' && c.type !== 'remove'), nds));
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (c.sourceHandle && c.targetHandle) useTopologyStore.getState().connect(c.sourceHandle, c.targetHandle);
  }, []);

  // Grey out impossible targets while dragging a cable.
  const isValidConnection = useCallback<IsValidConnection>(
    (c) => !!c.sourceHandle && !!c.targetHandle && connectionProblem(useTopologyStore.getState().topology, c.sourceHandle, c.targetHandle, cable) === null,
    [cable],
  );

  // A dropped cable that isValidConnection rejected: say why.
  const onConnectEnd = useCallback((_e: MouseEvent | TouchEvent, state: { isValid: boolean | null; fromHandle: { id?: string | null } | null; toHandle: { id?: string | null } | null }) => {
    if (state.isValid === false && state.fromHandle?.id && state.toHandle?.id) {
      const s = useTopologyStore.getState();
      const why = connectionProblem(s.topology, state.fromHandle.id, state.toHandle.id, s.cable);
      if (why) s.notify(why);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const kind = e.dataTransfer.getData(DRAG_TYPE) as DeviceKind;
      if (!kind) return;
      e.preventDefault();
      const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      useTopologyStore.getState().addDevice(kind, { x: p.x - 50, y: p.y - 45 });
    },
    [flow],
  );

  return (
    <div className="canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        onNodeDragStart={() => useTopologyStore.getState().beginMove()}
        onNodeClick={(_, n) => select({ type: 'device', id: n.id })}
        onNodeDoubleClick={(_, n) => {
          const d = useTopologyStore.getState().topology.devices[n.id];
          if (d) useUiStore.getState().openWindow(n.id, isHostKind(d.kind) ? 'desktop' : d.kind === 'hub' ? 'config' : 'cli');
        }}
        zoomOnDoubleClick={false}
        onEdgeClick={(_, e) => select({ type: 'link', id: e.id })}
        onPaneClick={() => select(null)}
        nodesDraggable={tool === 'select'}
        nodesConnectable={tool === 'select'}
        panOnDrag={tool === 'pan' ? true : [1, 2]}
        deleteKeyCode={null}
        minZoom={0.2}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ maxZoom: 1.1, padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        className={tool === 'pan' ? 'tool-pan' : ''}
      >
        <Background gap={28} size={1.4} />
        <MiniMap pannable zoomable position="bottom-right" className="minimap" nodeBorderRadius={10} style={{ width: 150, height: 100 }} />
      </ReactFlow>
      <CanvasToolbar tool={tool} setTool={setTool} />
      <Legend />
      {deviceCount === 0 && (
        <div className="canvas-empty">
          <Icon.Network size={34} />
          <h3>Your network is empty</h3>
          <p>Drag a device from the left panel, or click one to drop it here. Then drag from one port dot to another to cable them. Double-click a device to open its window.</p>
        </div>
      )}
    </div>
  );
}

function CanvasToolbar({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
      <button className={`icon-btn ${tool === 'select' ? 'on' : ''}`} onClick={() => setTool('select')} title="Select and move (V)" aria-pressed={tool === 'select'}>
        <Icon.Cursor />
      </button>
      <button className={`icon-btn ${tool === 'pan' ? 'on' : ''}`} onClick={() => setTool('pan')} title="Pan the canvas (H). Right-drag pans in any tool." aria-pressed={tool === 'pan'}>
        <Icon.Hand />
      </button>
      <span className="toolbar-sep" />
      <button className="icon-btn" onClick={() => flow.zoomOut({ duration: 150 })} title="Zoom out" aria-label="Zoom out">
        <Icon.ZoomOut />
      </button>
      <button className="zoom-readout" onClick={() => flow.zoomTo(1, { duration: 150 })} title="Reset to 100%">
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-btn" onClick={() => flow.zoomIn({ duration: 150 })} title="Zoom in" aria-label="Zoom in">
        <Icon.ZoomIn />
      </button>
      <button className="icon-btn" onClick={() => flow.fitView({ maxZoom: 1.1, padding: 0.2, duration: 200 })} title="Fit the whole network" aria-label="Fit to screen">
        <Icon.Fit />
      </button>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      <span>
        <i className="dot up" /> Up
      </span>
      <span>
        <i className="dot down" /> Down
      </span>
      <span>
        <i className="dot blocking" /> STP blocking
      </span>
      <span className="legend-sep" />
      {PROTOCOLS.slice(0, 6).map((p) => (
        <span key={p.key} title={p.title}>
          <i className="dot" style={{ background: p.color }} /> {p.label}
        </span>
      ))}
    </div>
  );
}
