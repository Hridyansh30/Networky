import { useState } from 'react';
import { CABLES, CATALOG, isHostKind } from '../model/catalog';
import { isValidIPv4, parseCidr, prefixToMask } from '../model/ip';
import * as ops from '../model/ops';
import type { Device, Topology } from '../model/types';
import { useTopologyStore } from '../store/topologyStore';
import { CommitField } from './CommitField';
import { RuntimeTables } from './RuntimeTables';

/** Runs an op through the store; returns the error text for the field, or null. */
function useEdit() {
  const apply = useTopologyStore((s) => s.apply);
  return (op: (t: Topology) => Topology): string | null => {
    let error: string | null = null;
    apply(({ topology, layout }) => {
      try {
        return { topology: op(topology), layout };
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        return { topology, layout }; // unchanged: no history entry, no toast
      }
    });
    return error;
  };
}

export function Inspector() {
  const selection = useTopologyStore((s) => s.selection);
  const topology = useTopologyStore((s) => s.topology);

  let body = <p className="muted">Select a device or a cable to configure it.</p>;
  if (selection?.type === 'device' && topology.devices[selection.id]) {
    body = <DeviceInspector device={topology.devices[selection.id]} topology={topology} />;
  } else if (selection?.type === 'link' && topology.links[selection.id]) {
    body = <LinkInspector linkId={selection.id} topology={topology} />;
  }
  return <aside className="inspector">{body}</aside>;
}

function DeviceInspector({ device, topology }: { device: Device; topology: Topology }) {
  const edit = useEdit();
  const deleteSelection = useTopologyStore((s) => s.deleteSelection);
  const template = CATALOG[device.kind];
  const isHost = isHostKind(device.kind);

  return (
    <>
      <h2>
        {template.label} <small className="muted">layer {template.layer}</small>
      </h2>
      <label className="row">
        Hostname
        <CommitField value={device.hostname} onCommit={(v) => edit((t) => ops.setHostname(t, device.id, v))} ariaLabel="Hostname" />
      </label>
      {isHost && (
        <label className="row">
          Default gateway
          <CommitField
            value={device.defaultGateway ?? ''}
            placeholder="e.g. 192.168.1.1"
            ariaLabel="Default gateway"
            onCommit={(v) => edit((t) => ops.setDefaultGateway(t, device.id, v.trim() || undefined))}
          />
        </label>
      )}

      <h3>Interfaces</h3>
      {!template.l3 && (
        <p className="muted small">
          A {template.label.toLowerCase()} works at layer {template.layer}, so its ports have no IP address. It forwards
          {device.kind === 'hub' ? ' bits out of every port.' : ' frames by MAC address.'}
        </p>
      )}
      <table className="ifaces">
        <thead>
          <tr>
            <th>Port</th>
            {template.l3 && <th>IPv4 (CIDR)</th>}
            <th title="Administrative state: shutdown / no shutdown">Up</th>
          </tr>
        </thead>
        <tbody>
          {device.interfaceIds.map((id) => {
            const i = topology.interfaces[id];
            const peerId = ops.peerInterfaceId(topology, id);
            const peer = peerId ? topology.interfaces[peerId] : undefined;
            return (
              <tr key={id}>
                <td>
                  <div>{i.name}</div>
                  <div className="muted small">
                    {i.mac} · {i.portType}
                    {peer && (
                      <>
                        <br />→ {topology.devices[peer.deviceId].hostname} {peer.name}
                      </>
                    )}
                  </div>
                </td>
                {template.l3 && (
                  <td>
                    <CommitField
                      value={i.ipv4 ? `${i.ipv4.address}/${i.ipv4.prefixLength}` : ''}
                      placeholder="no IP (e.g. 10.0.0.1/24)"
                      ariaLabel={`${i.name} IPv4`}
                      onCommit={(v) => {
                        if (!v.trim()) return edit((t) => ops.setInterfaceIp(t, id, undefined));
                        const parsed = parseCidr(v);
                        if (!parsed) return 'Use address/prefix, e.g. 10.0.0.1/24, or address and mask';
                        return edit((t) => ops.setInterfaceIp(t, id, parsed));
                      }}
                    />
                    {i.ipv4 && <div className="muted small">mask {prefixToMask(i.ipv4.prefixLength)}</div>}
                  </td>
                )}
                <td>
                  <input
                    type="checkbox"
                    checked={i.adminUp}
                    aria-label={`${i.name} administratively up`}
                    onChange={(e) => edit((t) => ops.setInterfaceAdmin(t, id, e.target.checked))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {device.kind === 'router' && <StaticRoutes device={device} />}

      <RuntimeTables device={device} topology={topology} />

      <button className="danger" onClick={deleteSelection}>
        Delete {device.hostname}
      </button>
    </>
  );
}

function StaticRoutes({ device }: { device: Device }) {
  const edit = useEdit();
  const [dest, setDest] = useState('');
  const [hop, setHop] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const parsed = parseCidr(dest);
    if (!parsed) return setError('Destination must look like 10.0.2.0/24');
    if (!isValidIPv4(hop)) return setError('Next hop must be an IPv4 address');
    const err = edit((t) => ops.addStaticRoute(t, device.id, { prefix: parsed.address, prefixLength: parsed.prefixLength, nextHop: hop.trim() }));
    setError(err);
    if (!err) {
      setDest('');
      setHop('');
    }
  };

  return (
    <>
      <h3>Static routes</h3>
      {(device.staticRoutes ?? []).length === 0 && <p className="muted small">No routes yet. Directly connected subnets need none.</p>}
      <ul className="routes">
        {(device.staticRoutes ?? []).map((r, idx) => (
          <li key={`${r.prefix}/${r.prefixLength}`}>
            <code>
              {r.prefix}/{r.prefixLength} via {r.nextHop}
            </code>
            <button className="link" onClick={() => edit((t) => ops.removeStaticRoute(t, device.id, idx))} aria-label="Remove route">
              ×
            </button>
          </li>
        ))}
      </ul>
      <form
        className="route-form"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="10.0.2.0/24" aria-label="Destination network" />
        <input value={hop} onChange={(e) => setHop(e.target.value)} placeholder="next hop" aria-label="Next hop" />
        <button type="submit">Add</button>
      </form>
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

function LinkInspector({ linkId, topology }: { linkId: string; topology: Topology }) {
  const deleteSelection = useTopologyStore((s) => s.deleteSelection);
  const link = topology.links[linkId];
  const end = (ifId: string) => {
    const i = topology.interfaces[ifId];
    return `${topology.devices[i.deviceId].hostname} ${i.name}${i.adminUp ? '' : ' (shutdown)'}`;
  };
  return (
    <>
      <h2>Cable</h2>
      <p>{CABLES[link.cable].label}</p>
      <p>
        {end(link.a)}
        <br />↕<br />
        {end(link.b)}
      </p>
      <button className="danger" onClick={deleteSelection}>
        Remove cable
      </button>
    </>
  );
}
