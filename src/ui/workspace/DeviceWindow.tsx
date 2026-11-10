// A device's own window, opened by double-clicking it on the canvas (as in
// Packet Tracer). What it holds depends on the device:
//
//   PC, laptop   Desktop (apps: IP Configuration, Command Prompt) · Config
//   server       the same, plus a DHCP Server app
//   router       Config · CLI · Tables
//   switch       Config · CLI · Tables
//   hub          Config (a hub has nothing else to configure)
//
// Built-in apps live here. More apps (web browser, email, ...) plug in through
// the registry in ui/apps (HOST_APPS); this file never needs to know them.

import { useEffect, useRef } from 'react';
import { leasesOf } from '../../engine/plugins/dhcp';
import { linkLocalOf, slaacOf } from '../../engine/plugins/ipv6';
import { classfulPrefix } from '../../cli/parse';
import { CATALOG, isHostKind } from '../../model/catalog';
import { isValidIPv4, maskToPrefix, prefixToMask } from '../../model/ip';
import { parseCidr6 } from '../../model/ip6';
import * as ops from '../../model/ops';
import { setDnsServer } from '../../model/services';
import type { Device, Interface, Topology } from '../../model/types';
import { useSimStore } from '../../store/simStore';
import { cliEnv } from '../../store/terminalStore';
import { useTopologyStore } from '../../store/topologyStore';
import { useUiStore, type DesktopApp, type WindowTab } from '../../store/uiStore';
import { HOST_APPS, SERVER_SERVICES_PANEL, type HostApp } from '../apps';
import { CommitField } from '../CommitField';
import { DeviceIcon, Icon } from '../icons';
import { ConfigTab, DhcpPools } from './ConfigTab';
import { editTopology as edit } from './edit';
import { TablesTab } from './Inspector';
import { Terminal } from './Terminal';

export function windowTabsFor(device: Device): WindowTab[] {
  if (device.kind === 'server' && SERVER_SERVICES_PANEL) return ['desktop', 'config', 'services'];
  if (isHostKind(device.kind)) return ['desktop', 'config'];
  if (device.kind === 'hub') return ['config'];
  return ['config', 'cli', 'tables'];
}

const TAB: Record<WindowTab, [string, (p: { size?: number }) => React.ReactElement]> = {
  desktop: ['Desktop', Icon.Monitor],
  config: ['Config', Icon.Sliders],
  services: ['Services', Icon.Layers],
  cli: ['CLI', Icon.Terminal],
  tables: ['Tables', Icon.Table],
};

export function DeviceWindow() {
  const id = useUiStore((s) => s.windowDeviceId);
  const wanted = useUiStore((s) => s.windowTab);
  const { closeWindow, setWindowTab } = useUiStore.getState();
  const topology = useTopologyStore((s) => s.topology);
  const device = id ? topology.devices[id] : undefined;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!device) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [device?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!device) return null;
  const tabs = windowTabsFor(device);
  const tab = tabs.includes(wanted) ? wanted : tabs[0];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeWindow()}>
      <div className="modal device-window" role="dialog" aria-modal="true" aria-label={`${device.hostname} window`} tabIndex={-1} ref={box}>
        <header className="modal-head">
          <DeviceIcon kind={device.kind} size={40} />
          <div>
            <h2>{device.hostname}</h2>
            <p className="muted small">{CATALOG[device.kind].label}</p>
          </div>
          <span className="spacer" />
          <button className="icon-btn" onClick={closeWindow} aria-label="Close window" title="Close (Esc)">
            <Icon.Close size={18} />
          </button>
        </header>
        <div className="tabs" role="tablist">
          {tabs.map((t) => {
            const [label, I] = TAB[t];
            return (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setWindowTab(t)}>
                <I size={15} /> {label}
              </button>
            );
          })}
        </div>
        <div className={`modal-body window-body ${tab === 'cli' || tab === 'desktop' ? 'fill' : ''}`}>
          {tab === 'desktop' && <Desktop device={device} topology={topology} />}
          {tab === 'config' && (isHostKind(device.kind) ? <HostConfig device={device} topology={topology} /> : <ConfigTab device={device} topology={topology} />)}
          {tab === 'services' && SERVER_SERVICES_PANEL && <SERVER_SERVICES_PANEL deviceId={device.id} env={cliEnv} />}
          {tab === 'cli' && <Terminal deviceId={device.id} />}
          {tab === 'tables' && <TablesTab device={device} />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Desktop

interface App {
  id: DesktopApp;
  label: string;
  icon: (p: { size?: number }) => React.ReactElement | null;
  /** Registry apps render themselves; built-ins are handled below. */
  Component?: HostApp['Component'];
}

/** Built-in apps first, then every registered app for this kind of device. */
export function appsFor(device: Device): App[] {
  const apps: App[] = [
    { id: 'ipconfig', label: 'IP Configuration', icon: Icon.Gear },
    { id: 'prompt', label: 'Command Prompt', icon: Icon.Terminal },
  ];
  if (device.kind === 'server') apps.push({ id: 'dhcp', label: 'DHCP Server', icon: Icon.Network });
  for (const a of HOST_APPS) if (a.kinds.includes(device.kind)) apps.push({ id: a.id, label: a.title, icon: a.icon as App['icon'], Component: a.Component });
  return apps;
}

function Desktop({ device, topology }: { device: Device; topology: Topology }) {
  const app = useUiStore((s) => s.desktopApp);
  const setApp = useUiStore((s) => s.setDesktopApp);
  const apps = appsFor(device);
  const current = apps.find((a) => a.id === app);

  if (!current)
    return (
      <div className="desktop">
        <div className="app-grid">
          {apps.map((a) => (
            <button key={a.id} className="app-tile" onClick={() => setApp(a.id)}>
              <span className="app-icon">
                <a.icon size={28} />
              </span>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="desktop-app">
      <div className="app-bar">
        <button className="btn sm ghost" onClick={() => setApp('home')}>
          <Icon.ChevronRight size={15} style={{ transform: 'rotate(180deg)' }} /> Desktop
        </button>
        <b>{current.label}</b>
      </div>
      {current.Component && (
        <div className="app-scroll">
          <current.Component deviceId={device.id} env={cliEnv} />
        </div>
      )}
      {current.id === 'prompt' && <Terminal deviceId={device.id} />}
      {current.id === 'ipconfig' && (
        <div className="app-scroll">
          <HostConfig device={device} topology={topology} />
        </div>
      )}
      {current.id === 'dhcp' && (
        <div className="app-scroll">
          <p className="muted small">Hands out addresses to DHCP clients on this server's LAN, or on other LANs through a router's helper address.</p>
          <DhcpPools device={device} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- host Config

/** Packet Tracer-style host settings: per-NIC IP mode, address, mask, MAC, status, IPv6, gateway. */
export function HostConfig({ device, topology }: { device: Device; topology: Topology }) {
  const nics = device.interfaceIds.map((id) => topology.interfaces[id]);
  const sim = useSimStore((s) => s.realtimeSim());
  useSimStore((s) => s.version);
  const lease = nics.map((n) => leasesOf(sim)[n.id]).find(Boolean);
  return (
    <div className="form-sheet">
      <section>
        <h3>Global settings</h3>
        <Field label="Display name">
          <CommitField value={device.hostname} onCommit={(v) => edit((t) => ops.setHostname(t, device.id, v))} ariaLabel="Display name" />
        </Field>
      </section>
      {nics.map((nic) => (
        <NicSettings key={nic.id} nic={nic} />
      ))}
      <section>
        <h3>Gateway</h3>
        <Field label="IPv4 default gateway">
          {nics.some((n) => n.dhcp) ? (
            <span className="value">{lease?.router ?? 'from DHCP (no lease yet)'}</span>
          ) : (
            <CommitField value={device.defaultGateway ?? ''} placeholder="e.g. 192.168.1.1" ariaLabel="Default gateway" onCommit={(v) => edit((t) => ops.setDefaultGateway(t, device.id, v.trim() || undefined))} />
          )}
        </Field>
        <Field label="IPv6 default gateway">
          {nics.some((n) => n.ipv6Auto) ? (
            <span className="value">router that advertised the prefix (SLAAC)</span>
          ) : (
            <CommitField value={device.defaultGatewayV6 ?? ''} placeholder="e.g. 2001:db8:1::1 or fe80::1" ariaLabel="IPv6 default gateway" onCommit={(v) => edit((t) => ops.setDefaultGatewayV6(t, device.id, v.trim() || undefined))} />
          )}
        </Field>
        <Field label="DNS server">
          {/* A static DNS server wins over the one a DHCP lease hands out, like Windows. */}
          <CommitField
            value={device.dnsServer ?? ''}
            placeholder={lease?.dns ? `${lease.dns} (from DHCP)` : 'e.g. 192.168.1.53'}
            ariaLabel="DNS server"
            onCommit={(v) => edit((t) => setDnsServer(t, device.id, v.trim() || undefined))}
          />
        </Field>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // a <div>, not a <label>: a label would give every button inside it (the
    // DHCP / Static switch) the row's text as its accessible name
    <div className="form-row">
      <span>{label}</span>
      {children}
    </div>
  );
}

function NicSettings({ nic }: { nic: Interface }) {
  const sim = useSimStore((s) => s.realtimeSim());
  const live = sim.topology.interfaces[nic.id] ?? nic;
  const leased = nic.dhcp ? sim.ipv4Of(live) : undefined;
  const slaac = nic.ipv6Auto ? slaacOf(sim, nic.id) : undefined;

  return (
    <section>
      <h3>{nic.name}</h3>
      <Field label="IP mode">
        <div className="seg" role="radiogroup" aria-label={`${nic.name} IPv4 mode`}>
          <button type="button" role="radio" aria-checked={!!nic.dhcp} className={nic.dhcp ? 'on' : ''} onClick={() => edit((t) => ops.setInterfaceOptions(t, nic.id, { dhcp: true }))}>
            DHCP
          </button>
          <button type="button" role="radio" aria-checked={!nic.dhcp} className={!nic.dhcp ? 'on' : ''} onClick={() => edit((t) => ops.setInterfaceOptions(t, nic.id, { dhcp: false }))}>
            Static
          </button>
        </div>
      </Field>
      {nic.dhcp ? (
        <>
          <Field label="IP address">
            <span className="value">{leased ? leased.address : 'requesting… no DHCP server answered'}</span>
          </Field>
          <Field label="Subnet mask">
            <span className="value">{leased ? prefixToMask(leased.prefixLength) : '—'}</span>
          </Field>
        </>
      ) : (
        <>
          <Field label="IP address">
            <CommitField
              value={nic.ipv4?.address ?? ''}
              placeholder="e.g. 192.168.1.10"
              ariaLabel={`${nic.name} IP address`}
              onCommit={(v) => {
                const ip = v.trim();
                if (!ip) return edit((t) => ops.setInterfaceIp(t, nic.id, undefined));
                if (!isValidIPv4(ip)) return `'${ip}' is not an IPv4 address`;
                // A new address keeps the mask; the first one gets its classful default
                const prefixLength = nic.ipv4?.prefixLength ?? classfulPrefix(ip);
                return edit((t) => ops.setInterfaceIp(t, nic.id, { address: ip, prefixLength }));
              }}
            />
          </Field>
          <Field label="Subnet mask">
            <CommitField
              value={nic.ipv4 ? prefixToMask(nic.ipv4.prefixLength) : ''}
              placeholder="e.g. 255.255.255.0"
              ariaLabel={`${nic.name} subnet mask`}
              onCommit={(v) => {
                if (!nic.ipv4) return 'Enter the IP address first';
                const m = v.trim();
                const prefixLength = m.startsWith('/') ? Number(m.slice(1)) : maskToPrefix(m);
                if (prefixLength === null || !Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) return `'${m}' is not a subnet mask`;
                return edit((t) => ops.setInterfaceIp(t, nic.id, { address: nic.ipv4!.address, prefixLength }));
              }}
            />
          </Field>
        </>
      )}
      <Field label="MAC address">
        <span className="value mono">{nic.mac.toUpperCase()}</span>
      </Field>
      <Field label="Status">
        <select value={nic.adminUp ? 'up' : 'down'} aria-label={`${nic.name} status`} onChange={(e) => edit((t) => ops.setInterfaceAdmin(t, nic.id, e.target.value === 'up'))}>
          <option value="up">Up</option>
          <option value="down">Down</option>
        </select>
      </Field>
      <h4>IPv6</h4>
      <Field label="Link-local">
        <span className="value mono">{linkLocalOf(nic)}/64</span>
      </Field>
      <Field label="IPv6 mode">
        <div className="seg" role="radiogroup" aria-label={`${nic.name} IPv6 mode`}>
          <button type="button" role="radio" aria-checked={!!nic.ipv6Auto} className={nic.ipv6Auto ? 'on' : ''} onClick={() => edit((t) => ops.setInterfaceOptions(t, nic.id, { ipv6Auto: true }))}>
            SLAAC
          </button>
          <button type="button" role="radio" aria-checked={!nic.ipv6Auto} className={!nic.ipv6Auto ? 'on' : ''} onClick={() => edit((t) => ops.setInterfaceOptions(t, nic.id, { ipv6Auto: false }))}>
            Static
          </button>
        </div>
      </Field>
      <Field label="IPv6 address">
        {nic.ipv6Auto ? (
          <span className="value mono">{slaac ? `${slaac.address}/${slaac.prefixLength}` : 'waiting for a router advertisement'}</span>
        ) : (
          <CommitField
            value={nic.ipv6 ? `${nic.ipv6.address}/${nic.ipv6.prefixLength}` : ''}
            placeholder="e.g. 2001:db8:1::10/64"
            ariaLabel={`${nic.name} IPv6 address`}
            onCommit={(v) => {
              if (!v.trim()) return edit((t) => ops.setInterfaceOptions(t, nic.id, { ipv6: null }));
              const p = parseCidr6(v);
              if (!p) return 'Use address/prefix, like 2001:db8:1::10/64';
              return edit((t) => ops.setInterfaceOptions(t, nic.id, { ipv6: p }));
            }}
          />
        )}
      </Field>
    </section>
  );
}
