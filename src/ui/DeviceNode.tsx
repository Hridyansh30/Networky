import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { memo } from 'react';
import { shortPortName } from '../model/catalog';
import { useTopologyStore } from '../store/topologyStore';
import { KIND_BADGE } from './deviceStyle';

export type DeviceNodeType = Node<{ deviceId: string }, 'device'>;

function DeviceNodeView({ data, selected }: NodeProps<DeviceNodeType>) {
  const device = useTopologyStore((s) => s.topology.devices[data.deviceId]);
  const interfaces = useTopologyStore((s) => s.topology.interfaces);
  if (!device) return null;

  const ports = device.interfaceIds.map((id) => interfaces[id]);
  const ips = ports.filter((p) => p.ipv4).map((p) => `${p.ipv4!.address}/${p.ipv4!.prefixLength}`);

  return (
    <div className={`device kind-${device.kind} ${selected ? 'selected' : ''}`}>
      <div className="device-head">
        <span className="badge">{KIND_BADGE[device.kind]}</span>
        <span className="hostname">{device.hostname}</span>
      </div>
      <div className="device-ips">{ips.length ? ips.slice(0, 2).join(', ') + (ips.length > 2 ? ' …' : '') : ' '}</div>
      {ports.map((p, i) => {
        const state = !p.linkId ? 'free' : p.adminUp ? 'up' : 'down';
        return (
          <Handle
            key={p.id}
            id={p.id}
            type="source"
            position={Position.Bottom}
            isConnectable={!p.linkId}
            className={`port port-${state} port-${p.portType}`}
            style={{ left: `${((i + 1) / (ports.length + 1)) * 100}%` }}
            title={`${p.name} (${p.portType})${p.linkId ? ' · connected' : ' · free'}`}
          >
            <span className="port-label">{shortPortName(p.name)}</span>
          </Handle>
        );
      })}
    </div>
  );
}

export const DeviceNode = memo(DeviceNodeView);
