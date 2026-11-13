import { useReactFlow } from '@xyflow/react';
import { useState } from 'react';
import { CABLE_TYPES, CABLES, CATALOG } from '../../model/catalog';
import type { DeviceKind } from '../../model/types';
import { useTopologyStore } from '../../store/topologyStore';
import { CableIcon, DeviceIcon, Icon } from '../icons';

export const DRAG_TYPE = 'application/x-networky-device';

const GROUPS: { title: string; kinds: DeviceKind[] }[] = [
  { title: 'End devices', kinds: ['pc', 'laptop', 'server'] },
  { title: 'Network devices', kinds: ['router', 'switch', 'hub'] },
];

const HINT: Record<DeviceKind, string> = {
  pc: 'Desktop with one Fast Ethernet port',
  laptop: 'Portable host with one Fast Ethernet port',
  server: 'Host with a Gigabit port; can run a DHCP server',
  router: 'Routes between subnets: static, RIP, OSPF, NAT, ACLs',
  switch: 'Layer 2: MAC learning, VLANs, STP',
  hub: 'Layer 1: repeats every bit out of every port',
};

const CABLE_HINT: Record<string, string> = {
  'copper-straight': 'Different kinds: PC ↔ switch, switch ↔ router',
  'copper-cross': 'Same kinds: switch ↔ switch, PC ↔ PC, router ↔ PC',
  fiber: 'Fiber ports on switches and routers',
  serial: 'Router ↔ router WAN links',
};

/** Left side of the workspace: the device palette and an outline of the network. */
export function LeftPanel() {
  const [tab, setTab] = useState<'devices' | 'topology'>('devices');
  const [query, setQuery] = useState('');
  return (
    <aside className="left-panel" aria-label="Devices and topology">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'devices'} className={tab === 'devices' ? 'on' : ''} onClick={() => setTab('devices')}>
          Devices
        </button>
        <button role="tab" aria-selected={tab === 'topology'} className={tab === 'topology' ? 'on' : ''} onClick={() => setTab('topology')}>
          Topology
        </button>
      </div>
      <label className="search">
        <Icon.Search size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === 'devices' ? 'Search devices' : 'Search hostnames, ports'} aria-label="Search" />
      </label>
      <div className="left-scroll">{tab === 'devices' ? <DevicePalette query={query} /> : <TopologyOutline query={query} />}</div>
    </aside>
  );
}

export function DevicePalette({ query }: { query: string }) {
  const addDevice = useTopologyStore((s) => s.addDevice);
  const cable = useTopologyStore((s) => s.cable);
  const setCable = useTopologyStore((s) => s.setCable);
  const flow = useReactFlow();
  const q = query.trim().toLowerCase();
  const match = (k: DeviceKind) => !q || CATALOG[k].label.toLowerCase().includes(q) || HINT[k].toLowerCase().includes(q);

  // Clicking drops the device in the middle of the visible canvas, nudged so
  // repeated clicks don't stack devices exactly on top of each other.
  const addAtCenter = (kind: DeviceKind) => {
    const el = document.querySelector('.canvas');
    const r = el?.getBoundingClientRect();
    const p = r ? flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    const n = Object.keys(useTopologyStore.getState().topology.devices).length;
    addDevice(kind, { x: p.x - 50 + (n % 5) * 28, y: p.y - 45 + (n % 5) * 22 });
  };

  return (
    <>
      {GROUPS.map((g) => {
        const kinds = g.kinds.filter(match);
        if (!kinds.length) return null;
        return (
          <section key={g.title} className="palette-group">
            <h4>{g.title}</h4>
            <div className="palette-grid">
              {kinds.map((k) => (
                <button
                  key={k}
                  className="palette-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, k);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => addAtCenter(k)}
                  title={`${HINT[k]}. Click to add, or drag onto the canvas.`}
                >
                  <DeviceIcon kind={k} size={44} />
                  <span>{CATALOG[k].label}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <section className="palette-group">
        <h4>Cable for new connections</h4>
        <div className="cable-list" role="radiogroup" aria-label="Cable type">
          {CABLE_TYPES.map((c) => (
            <button key={c} role="radio" aria-checked={cable === c} className={`cable-item ${cable === c ? 'on' : ''}`} onClick={() => setCable(c)} title={CABLE_HINT[c]}>
              <CableIcon cable={c} />
              <span>
                <b>{CABLES[c].label}</b>
                <small>{CABLE_HINT[c]}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function TopologyOutline({ query }: { query: string }) {
  const topology = useTopologyStore((s) => s.topology);
  const layout = useTopologyStore((s) => s.layout);
  const selection = useTopologyStore((s) => s.selection);
  const select = useTopologyStore((s) => s.select);
  const flow = useReactFlow();
  const q = query.trim().toLowerCase();
  const devices = Object.values(topology.devices).sort((a, b) => a.hostname.localeCompare(b.hostname, undefined, { numeric: true }));

  const focus = (id: string) => {
    select({ type: 'device', id });
    const p = layout[id];
    if (p) flow.setCenter(p.x + 50, p.y + 45, { zoom: Math.max(flow.getZoom(), 1), duration: 250 });
  };

  if (!devices.length) return <p className="muted pad">No devices yet.</p>;
  return (
    <ul className="outline">
      {devices.map((d) => {
        const links = d.interfaceIds
          .map((id) => topology.interfaces[id])
          .filter((i) => i.linkId)
          .map((i) => {
            const l = topology.links[i.linkId!];
            const peer = topology.interfaces[l.a === i.id ? l.b : l.a];
            return { id: l.id, text: `${i.name} → ${topology.devices[peer.deviceId].hostname} ${peer.name}` };
          });
        const hit = !q || d.hostname.toLowerCase().includes(q) || links.some((l) => l.text.toLowerCase().includes(q));
        if (!hit) return null;
        const on = selection?.type === 'device' && selection.id === d.id;
        return (
          <li key={d.id}>
            <button className={`outline-device ${on ? 'on' : ''}`} onClick={() => focus(d.id)}>
              <DeviceIcon kind={d.kind} size={26} />
              <span>{d.hostname}</span>
              <small>{CATALOG[d.kind].label}</small>
            </button>
            {links.length > 0 && (
              <ul>
                {links.map((l) => (
                  <li key={l.id}>
                    <button className={`outline-link ${selection?.type === 'link' && selection.id === l.id ? 'on' : ''}`} onClick={() => select({ type: 'link', id: l.id })}>
                      {l.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
