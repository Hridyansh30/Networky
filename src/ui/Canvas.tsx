import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type IsValidConnection,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { connectionProblem } from '../model/ops';
import type { DeviceKind } from '../model/types';
import { useTopologyStore } from '../store/topologyStore';
import { DeviceNode, type DeviceNodeType } from './DeviceNode';
import { LinkEdge, type LinkEdgeType } from './LinkEdge';
import { DRAG_TYPE } from './Palette';

const nodeTypes = { device: DeviceNode };
const edgeTypes = { link: LinkEdge };

/**
 * React Flow wants nodes[] and edges[]. We DERIVE them from the topology
 * instead of storing them, so the model never depends on the UI library.
 */
export function Canvas() {
  const topology = useTopologyStore((s) => s.topology);
  const layout = useTopologyStore((s) => s.layout);
  const selection = useTopologyStore((s) => s.selection);
  const cable = useTopologyStore((s) => s.cable);
  const { screenToFlowPosition } = useReactFlow();

  // React Flow measures nodes and writes the sizes back through onNodesChange.
  // Keeping nodes in local state preserves those measurements between re-derives.
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

  const onNodesChange = useCallback((changes: NodeChange<DeviceNodeType>[]) => {
    const store = useTopologyStore.getState();
    for (const c of changes) {
      if (c.type === 'position' && c.position) store.moveDevice(c.id, c.position);
    }
    // Selection and removal are owned by the store; apply only the rest locally.
    setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type !== 'select' && c.type !== 'remove'), nds));
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (c.sourceHandle && c.targetHandle) useTopologyStore.getState().connect(c.sourceHandle, c.targetHandle);
  }, []);

  // Grey out impossible targets while dragging a cable.
  const isValidConnection = useCallback<IsValidConnection>(
    (c) =>
      !!c.sourceHandle &&
      !!c.targetHandle &&
      connectionProblem(useTopologyStore.getState().topology, c.sourceHandle, c.targetHandle, cable) === null,
    [cable],
  );

  // A dropped cable that isValidConnection rejected: tell the user why.
  const onConnectEnd = useCallback(
    (_e: MouseEvent | TouchEvent, state: { isValid: boolean | null; fromHandle: { id?: string | null } | null; toHandle: { id?: string | null } | null }) => {
      if (state.isValid === false && state.fromHandle?.id && state.toHandle?.id) {
        const s = useTopologyStore.getState();
        const why = connectionProblem(s.topology, state.fromHandle.id, state.toHandle.id, s.cable);
        if (why) s.notify(why);
      }
    },
    [],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const kind = e.dataTransfer.getData(DRAG_TYPE) as DeviceKind;
      if (!kind) return;
      e.preventDefault();
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      useTopologyStore.getState().addDevice(kind, { x: p.x - 70, y: p.y - 30 });
    },
    [screenToFlowPosition],
  );

  const select = useTopologyStore((s) => s.select);

  return (
    <main className="canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
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
        onEdgeClick={(_, e) => select({ type: 'link', id: e.id })}
        onPaneClick={() => select(null)}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable position="top-right" />
      </ReactFlow>
      {Object.keys(topology.devices).length === 0 && (
        <div className="empty">Drag a device here from the left, or click one to add it.</div>
      )}
    </main>
  );
}
