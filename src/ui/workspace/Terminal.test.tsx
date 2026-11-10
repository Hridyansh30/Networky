// @vitest-environment jsdom
// The device terminal, driven the way a user drives it: typing, Enter, Tab,
// the arrow keys and '?'. Uses a real lab network and the real CLI.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../model/examples';
import { useProjectStore } from '../../store/projectStore';
import { useTerminalStore } from '../../store/terminalStore';
import { useTopologyStore } from '../../store/topologyStore';
import { Terminal } from './Terminal';

const idOf = (hostname: string) => Object.values(useTopologyStore.getState().topology.devices).find((d) => d.hostname === hostname)!.id;
const screenText = () => screen.getByRole('log').textContent ?? '';

function type(input: HTMLElement, line: string) {
  fireEvent.change(input, { target: { value: line } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

beforeEach(() => {
  useProjectStore.getState().openLab(EXAMPLES.find((e) => e.name.startsWith('VLAN'))!);
  useTerminalStore.setState({ terminals: {} });
});
afterEach(cleanup);

describe('router CLI', () => {
  it('runs commands and changes mode, like IOS', () => {
    render(<Terminal deviceId={idOf('R1')} />);
    const input = screen.getByLabelText('Command for R1');
    expect(screen.getByText('R1>')).toBeTruthy();
    type(input, 'enable');
    expect(screen.getByText('R1#')).toBeTruthy();
    type(input, 'show ip route');
    expect(screenText()).toContain('192.168.10.0/24 is directly connected, GigabitEthernet0/0.10');
  });

  it('configures the device through the store (one source of truth)', () => {
    render(<Terminal deviceId={idOf('R1')} />);
    const input = screen.getByLabelText('Command for R1');
    for (const c of ['en', 'conf t', 'hostname EDGE', 'end']) type(input, c);
    expect(useTopologyStore.getState().topology.devices[idOf('EDGE')].hostname).toBe('EDGE');
    expect(screen.getByText('EDGE#')).toBeTruthy();
  });

  it('Tab completes a unique keyword', () => {
    render(<Terminal deviceId={idOf('R1')} />);
    const input = screen.getByLabelText('Command for R1') as HTMLInputElement;
    type(input, 'enable');
    fireEvent.change(input, { target: { value: 'conf' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('configure ');
  });

  it('↑ and ↓ walk the history', () => {
    render(<Terminal deviceId={idOf('R1')} />);
    const input = screen.getByLabelText('Command for R1') as HTMLInputElement;
    type(input, 'enable');
    type(input, 'show version');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('show version');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('enable');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('');
  });

  it('? lists options without pressing Enter', () => {
    render(<Terminal deviceId={idOf('R1')} />);
    const input = screen.getByLabelText('Command for R1');
    fireEvent.keyDown(input, { key: '?' });
    expect(screenText()).toMatch(/enable/);
  });

  it('marks IOS errors', () => {
    render(<Terminal deviceId={idOf('R1')} />);
    type(screen.getByLabelText('Command for R1'), 'bogus');
    expect(document.querySelector('.term-error')?.textContent).toMatch(/^%/);
  });

  it('keeps each device’s scrollback separately', () => {
    const { rerender } = render(<Terminal deviceId={idOf('R1')} />);
    type(screen.getByLabelText('Command for R1'), 'enable');
    rerender(<Terminal deviceId={idOf('S1')} />);
    expect(screen.getByText('S1>')).toBeTruthy();
    rerender(<Terminal deviceId={idOf('R1')} />);
    expect(screen.getByText('R1#')).toBeTruthy();
  });
});

describe('host command prompt', () => {
  it('ipconfig and ping work end to end', () => {
    render(<Terminal deviceId={idOf('PC1')} />);
    const input = screen.getByLabelText('Command for PC1');
    expect(screen.getByText('C:\\>')).toBeTruthy();
    type(input, 'ipconfig');
    expect(screenText()).toContain('192.168.10.10');
    type(input, 'ping 192.168.20.10');
    expect(screenText()).toContain('Received = 4, Lost = 0');
  });

  it('cls clears the screen', () => {
    render(<Terminal deviceId={idOf('PC1')} />);
    const input = screen.getByLabelText('Command for PC1');
    type(input, 'ipconfig');
    type(input, 'cls');
    expect(screenText()).not.toContain('ipconfig');
  });
});
