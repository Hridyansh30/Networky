import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { CATALOG, shortPortName } from '../../model/catalog';
import { useSimStore } from '../../store/simStore';
import { useTopologyStore } from '../../store/topologyStore';
import { DeviceIcon } from '../icons';
import { portState } from './portState';

export type DeviceNodeType = Node<{ deviceId: string }, 'device'>;

/**
 * A device on the canvas: its icon, hostname and first address. Each physical
 * port is a connection handle along the bottom edge; its dot shows the port's
 * state (free, up, down, STP blocking) the way the LEDs on real gear do.
 */
function DeviceNodeView({ data, selected }: NodeProps<DeviceNodeType>) {
  const device = useTopologyStore((s) => s.topology.devices[data.deviceId]);
  const interfaces = useTopologyStore((s) => s.topology.interfaces);
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  if (!device) return null;

  const all = device.interfaceIds.map((id) => interfaces[id]);
  const ports = all.filter((p) => !p.parentId);
  const firstIp = all.find((p) => p.ipv4)?.ipv4;
  const sub = firstIp ? `${firstIp.address}/${firstIp.prefixLength}` : all.some((p) => p.dhcp) ? 'DHCP' : CATALOG[device.kind].label;

  return (
    <div className={`node ${selected ? 'selected' : ''}`} data-testid={`device-${device.hostname}`}>
      <div className="node-icon">
        <DeviceIcon kind={device.kind} size={58} />
      </div>
      <div className="node-name">{device.hostname}</div>
      <div className="node-sub">{sub}</div>
      <div className="node-ports">
        {ports.map((p, i) => {
          const state = portState(sim, p);
          return (
            <Handle
              key={p.id}
              id={p.id}
              type="source"
              position={Position.Bottom}
              isConnectable={!p.linkId}
              className={`port port-${state}`}
              style={{ left: `${((i + 1) / (ports.length + 1)) * 100}%` }}
              title={`${p.name}: ${state === 'free' ? 'free, drag to another port to cable it' : state}`}
            >
              <span className="port-label">{shortPortName(p.name)}</span>
            </Handle>
          );
        })}
      </div>
    </div>
  );
}

export const DeviceNode = memo(DeviceNodeView);
