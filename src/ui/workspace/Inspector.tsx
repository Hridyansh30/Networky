import { useState } from 'react';
import type { DataTable } from '../../inspect/tables';
import { hostIpConfig, tablesFor } from '../../inspect/tables';
import { CABLES, CATALOG, isHostKind } from '../../model/catalog';
import type { Device, Topology } from '../../model/types';
import { useSimStore } from '../../store/simStore';
import { useTopologyStore } from '../../store/topologyStore';
import { useUiStore } from '../../store/uiStore';
import { CableIcon, DeviceIcon, Icon } from '../icons';
import { ConfigTab } from './ConfigTab';
import { portState } from './portState';
import { Terminal } from './Terminal';

export type InspectorTab = 'config' | 'cli' | 'tables' | 'desktop';

/** Which tabs a device has: IOS devices get a CLI, hosts get a Desktop, a hub has neither. */
export function tabsFor(device: Device): InspectorTab[] {
  if (isHostKind(device.kind)) return ['config', 'desktop', 'tables'];
  if (device.kind === 'hub') return ['config'];
  return ['config', 'cli', 'tables'];
}

const TAB_LABEL: Record<InspectorTab, [string, (p: { size?: number }) => React.ReactElement]> = {
  config: ['Config', Icon.Sliders],
  cli: ['CLI', Icon.Terminal],
  tables: ['Tables', Icon.Table],
  desktop: ['Desktop', Icon.Monitor],
};

export function Inspector() {
  const selection = useTopologyStore((s) => s.selection);
  const topology = useTopologyStore((s) => s.topology);
  const select = useTopologyStore((s) => s.select);

  let body: React.ReactNode = <NothingSelected topology={topology} />;
  if (selection?.type === 'device' && topology.devices[selection.id]) body = <DeviceInspector device={topology.devices[selection.id]} topology={topology} />;
  else if (selection?.type === 'link' && topology.links[selection.id]) body = <LinkInspector linkId={selection.id} topology={topology} />;

  return (
    <aside className="inspector" aria-label="Inspector">
      {selection && (
        <button className="icon-btn sm inspector-close" onClick={() => select(null)} aria-label="Close inspector" title="Close">
          <Icon.Close size={16} />
        </button>
      )}
      {body}
    </aside>
  );
}

function DeviceInspector({ device, topology }: { device: Device; topology: Topology }) {
  const tabs = tabsFor(device);
  const [wanted, setTab] = useState<InspectorTab>('config');
  const tab = tabs.includes(wanted) ? wanted : 'config';
  const deleteSelection = useTopologyStore((s) => s.deleteSelection);
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const ports = device.interfaceIds.map((id) => topology.interfaces[id]).filter((i) => !i.parentId);
  const up = ports.filter((p) => portState(sim, p) === 'up' || portState(sim, p) === 'blocking').length;

  return (
    <>
      <header className="inspector-head">
        <DeviceIcon kind={device.kind} size={46} />
        <div>
          <h2>{device.hostname}</h2>
          <p className="muted small">
            {CATALOG[device.kind].label} · layer {CATALOG[device.kind].layer}
          </p>
        </div>
        <button className="btn sm" onClick={() => useUiStore.getState().openWindow(device.id, isHostKind(device.kind) ? 'desktop' : device.kind === 'hub' ? 'config' : 'cli')} title="Open the device window (or double-click it on the canvas)">
          <Icon.Monitor size={15} /> Open
        </button>
      </header>
      <div className="inspector-status">
        <span className={`badge ${up ? 'ok' : 'off'}`} title={`${up} of ${ports.length} ports have a working link`}>
          <i className="dot" /> {up ? `${up}/${ports.length} links up` : 'No links'}
        </span>
        <span className="muted small">Double-click the device for its full window</span>
      </div>
      <div className="tabs inspector-tabs" role="tablist">
        {tabs.map((t) => {
          const [label, I] = TAB_LABEL[t];
          return (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              <I size={15} /> {label}
            </button>
          );
        })}
      </div>
      <div className={`inspector-body ${tab === 'cli' || tab === 'desktop' ? 'fill' : ''}`}>
        {tab === 'config' && (
          <>
            <ConfigTab device={device} topology={topology} />
            <button className="btn danger-outline full" onClick={deleteSelection}>
              <Icon.Trash size={16} /> Delete {device.hostname}
            </button>
          </>
        )}
        {tab === 'cli' && <Terminal deviceId={device.id} />}
        {tab === 'desktop' && (
          <>
            <TableView table={hostIpConfig(useSimStore.getState().realtimeSim(), device)} compact />
            <Terminal deviceId={device.id} />
          </>
        )}
        {tab === 'tables' && <TablesTab device={device} />}
      </div>
    </>
  );
}

export function TablesTab({ device }: { device: Device }) {
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const mode = useSimStore((s) => s.mode);
  const tables = tablesFor(sim, device);
  return (
    <div className="tables-tab">
      <p className="muted small">{mode === 'simulation' ? 'Live state: these tables fill in as you step the simulation.' : 'The converged network: what the device knows right now.'}</p>
      {tables.map((t) => (
        <TableView key={t.id} table={t} />
      ))}
    </div>
  );
}

export function TableView({ table, compact }: { table: DataTable; compact?: boolean }) {
  return (
    <section className={`data-table ${compact ? 'compact' : ''}`}>
      <header>
        <h4>{table.title}</h4>
        <code title="The IOS command that shows the same thing">{table.command}</code>
      </header>
      {table.notes?.map((n) => (
        <p key={n} className="muted small mono">
          {n}
        </p>
      ))}
      {table.rows.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {table.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td key={j} className="mono">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">{table.empty}</p>
      )}
    </section>
  );
}

function LinkInspector({ linkId, topology }: { linkId: string; topology: Topology }) {
  const deleteSelection = useTopologyStore((s) => s.deleteSelection);
  const select = useTopologyStore((s) => s.select);
  useSimStore((s) => s.version);
  const sim = useSimStore((s) => s.sim);
  const link = topology.links[linkId];
  const end = (ifId: string) => {
    const i = topology.interfaces[ifId];
    const d = topology.devices[i.deviceId];
    const state = portState(sim, i);
    return (
      <button className="link-end" onClick={() => select({ type: 'device', id: d.id })}>
        <DeviceIcon kind={d.kind} size={34} />
        <span>
          <b>{d.hostname}</b>
          <small className="mono">{i.name}</small>
        </span>
        <span className={`state state-${state}`}>
          <i className="dot" /> {state === 'blocking' ? 'STP blocking' : state}
        </span>
      </button>
    );
  };
  return (
    <>
      <header className="inspector-head">
        <CableIcon cable={link.cable} size={40} />
        <div>
          <h2>Cable</h2>
          <p className="muted small">{CABLES[link.cable].label}</p>
        </div>
      </header>
      <div className="inspector-body">
        {end(link.a)}
        <div className="link-mid" aria-hidden="true" />
        {end(link.b)}
        <button className="btn danger-outline full" onClick={deleteSelection}>
          <Icon.Trash size={16} /> Remove cable
        </button>
      </div>
    </>
  );
}

function NothingSelected({ topology }: { topology: Topology }) {
  const devices = Object.values(topology.devices);
  const count = (k: string) => devices.filter((d) => d.kind === k).length;
  return (
    <div className="inspector-empty">
      <Icon.Cursor size={28} />
      <h3>Nothing selected</h3>
      <p className="muted">Click a device to configure it, open its CLI or Desktop, and read its tables. Click a cable to see both ends.</p>
      {devices.length > 0 && (
        <dl className="summary">
          <div>
            <dt>Devices</dt>
            <dd>{devices.length}</dd>
          </div>
          <div>
            <dt>Cables</dt>
            <dd>{Object.keys(topology.links).length}</dd>
          </div>
          <div>
            <dt>Routers</dt>
            <dd>{count('router')}</dd>
          </div>
          <div>
            <dt>Switches</dt>
            <dd>{count('switch')}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
