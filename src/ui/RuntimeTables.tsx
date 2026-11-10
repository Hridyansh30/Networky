// "show ip route", "show arp", "show mac address-table": what the device has
// LEARNED (runtime state from the engine), as opposed to what you configured.

import { shortPortName } from '../model/catalog';
import type { Device, Topology } from '../model/types';
import { routingTable } from '../engine/routing';
import { useSimStore } from '../store/simStore';

export function RuntimeTables({ device, topology }: { device: Device; topology: Topology }) {
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const portName = (ifId: string) => shortPortName(topology.interfaces[ifId]?.name ?? '?');

  const owner = (mac: string) => {
    const i = sim.interfaceByMac(mac);
    return i ? `${topology.devices[i.deviceId]?.hostname} ${shortPortName(i.name)}` : '';
  };

  if (device.kind === 'hub') {
    return <p className="muted small">A hub keeps no tables. It does not know what a MAC address is.</p>;
  }

  if (device.kind === 'switch') {
    const rows = Object.entries(sim.mac[device.id] ?? {});
    return (
      <>
        <h3>MAC address table</h3>
        {rows.length === 0 ? (
          <p className="muted small">Empty. The switch learns a MAC when a frame from it arrives.</p>
        ) : (
          <table className="rt">
            <thead>
              <tr>
                <th>MAC</th>
                <th>Port</th>
                <th>Belongs to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([mac, e]) => (
                <tr key={mac}>
                  <td>
                    <code>{mac}</code>
                  </td>
                  <td>{portName(e.interfaceId)}</td>
                  <td className="muted">{owner(mac)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    );
  }

  const arpRows = Object.entries(sim.arp[device.id] ?? {});
  const routes = device.kind === 'router' ? routingTable(topology, device.id) : [];

  return (
    <>
      {device.kind === 'router' && (
        <>
          <h3>Routing table</h3>
          {routes.length === 0 ? (
            <p className="muted small">Empty. An interface needs an IP and a working cable (up/up) to add a connected route.</p>
          ) : (
            <table className="rt">
              <thead>
                <tr>
                  <th></th>
                  <th>Network</th>
                  <th>Via</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={`${r.source}${r.network}/${r.prefixLength}`}>
                    <td title={r.source}>{r.code}</td>
                    <td>
                      <code>
                        {r.network}/{r.prefixLength}
                      </code>
                    </td>
                    <td>{r.nextHop ? `${r.nextHop}, ${portName(r.interfaceId)}` : `directly, ${portName(r.interfaceId)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <h3>ARP cache</h3>
      {arpRows.length === 0 ? (
        <p className="muted small">Empty. Entries appear after ARP requests or replies.</p>
      ) : (
        <table className="rt">
          <thead>
            <tr>
              <th>IP</th>
              <th>MAC</th>
              <th>Port</th>
            </tr>
          </thead>
          <tbody>
            {arpRows.map(([ip, e]) => (
              <tr key={ip}>
                <td>
                  <code>{ip}</code>
                </td>
                <td>
                  <code>{e.mac}</code>
                </td>
                <td>{portName(e.interfaceId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
