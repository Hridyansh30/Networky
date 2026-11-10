// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../model/examples';
import { useProjectStore } from '../../store/projectStore';
import { useTerminalStore } from '../../store/terminalStore';
import { useTopologyStore } from '../../store/topologyStore';
import { useUiStore } from '../../store/uiStore';
import { HOST_APPS } from '../apps';
import { appsFor, DeviceWindow, windowTabsFor } from './DeviceWindow';

const device = (hostname: string) => Object.values(useTopologyStore.getState().topology.devices).find((d) => d.hostname === hostname)!;
const iface = (hostname: string) => useTopologyStore.getState().topology.interfaces[device(hostname).interfaceIds[0]];

beforeEach(() => {
  useProjectStore.getState().openLab(EXAMPLES.find((e) => e.name.startsWith('DHCP'))!);
  useTerminalStore.setState({ terminals: {} });
  useUiStore.getState().closeWindow();
});
afterEach(cleanup);

describe('what each kind of device offers', () => {
  it('hosts get Desktop + Config; routers and switches get a CLI; a hub only Config', () => {
    useProjectStore.getState().openLab(EXAMPLES[0]); // hub vs switch: has a hub
    const kinds = Object.values(useTopologyStore.getState().topology.devices);
    const tabs = (k: string) => windowTabsFor(kinds.find((d) => d.kind === k)!);
    expect(tabs('pc')).toEqual(['desktop', 'config']);
    expect(tabs('hub')).toEqual(['config']);
    expect(tabs('switch')).toEqual(['config', 'cli', 'tables']);
  });

  it('a server’s Desktop has a DHCP Server app; a PC’s does not', () => {
    const pc = Object.values(useTopologyStore.getState().topology.devices).find((d) => d.kind === 'pc')!;
    const server = { ...pc, kind: 'server' as const };
    const registry = HOST_APPS.map((a) => a.id);
    expect(appsFor(pc).map((a) => a.id)).toEqual(['ipconfig', 'prompt', ...registry]);
    expect(appsFor(server).map((a) => a.id)).toEqual(['ipconfig', 'prompt', 'dhcp', ...registry]);
  });
});

describe('the window', () => {
  it('opens on a PC’s Desktop and launches the Command Prompt', () => {
    const pc = Object.values(useTopologyStore.getState().topology.devices).find((d) => d.kind === 'pc')!;
    useUiStore.getState().openWindow(pc.id, 'desktop');
    render(<DeviceWindow />);
    expect(screen.getByRole('dialog', { name: `${pc.hostname} window` })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Command Prompt/ }));
    expect(screen.getByLabelText(`Command for ${pc.hostname}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Desktop/ }));
    expect(screen.getByRole('button', { name: /IP Configuration/ })).toBeTruthy();
  });

  it('Config edits the host: static address with a dotted mask, then DHCP', () => {
    const pc = Object.values(useTopologyStore.getState().topology.devices).find((d) => d.kind === 'pc')!;
    useUiStore.getState().openWindow(pc.id, 'config');
    render(<DeviceWindow />);
    const nic = iface(pc.hostname);
    if (nic.dhcp) fireEvent.click(screen.getAllByRole('radio', { name: 'Static' })[0]);
    const ip = screen.getByLabelText(`${nic.name} IP address`);
    fireEvent.change(ip, { target: { value: '10.9.9.9' } });
    fireEvent.blur(ip);
    const mask = screen.getByLabelText(`${nic.name} subnet mask`);
    fireEvent.change(mask, { target: { value: '255.255.255.240' } });
    fireEvent.blur(mask);
    expect(iface(pc.hostname).ipv4).toEqual({ address: '10.9.9.9', prefixLength: 28 });

    fireEvent.change(screen.getByLabelText(`${nic.name} subnet mask`), { target: { value: '255.0.255.0' } });
    fireEvent.blur(screen.getByLabelText(`${nic.name} subnet mask`));
    expect(screen.getByText(/is not a subnet mask/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole('radio', { name: 'DHCP' })[0]);
    expect(iface(pc.hostname).dhcp).toBe(true);
    expect(iface(pc.hostname).ipv4).toBeUndefined();
  });

  it('Config sets a static DNS server, refuses a bad one and clears it', () => {
    const pc = Object.values(useTopologyStore.getState().topology.devices).find((d) => d.kind === 'pc')!;
    useUiStore.getState().openWindow(pc.id, 'config');
    render(<DeviceWindow />);
    const dnsOf = () => useTopologyStore.getState().topology.devices[pc.id].dnsServer;
    const field = () => screen.getByLabelText('DNS server');
    fireEvent.change(field(), { target: { value: '10.0.0.53' } });
    fireEvent.blur(field());
    expect(dnsOf()).toBe('10.0.0.53');
    fireEvent.change(field(), { target: { value: '10.0.0.300' } });
    fireEvent.blur(field());
    expect(screen.getByText(/is not a valid IPv4 address/)).toBeTruthy();
    expect(dnsOf()).toBe('10.0.0.53');
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect(dnsOf()).toBeUndefined();
  });

  it('a router window opens straight on its CLI and Escape closes it', () => {
    const r = Object.values(useTopologyStore.getState().topology.devices).find((d) => d.kind === 'router')!;
    useUiStore.getState().openWindow(r.id, 'cli');
    render(<DeviceWindow />);
    expect(screen.getByLabelText(`Command for ${r.hostname}`)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().windowDeviceId).toBeNull();
  });

  it('closes itself when its device is deleted', () => {
    const pc = Object.values(useTopologyStore.getState().topology.devices).find((d) => d.kind === 'pc')!;
    useUiStore.getState().openWindow(pc.id);
    useTopologyStore.getState().select({ type: 'device', id: pc.id });
    useTopologyStore.getState().deleteSelection();
    expect(useUiStore.getState().windowDeviceId).toBeNull();
  });
});
