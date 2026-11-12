// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exampleById } from '../../model/examples';
import { useProjectStore } from '../../store/projectStore';
import { useTopologyStore } from '../../store/topologyStore';
import { useUiStore } from '../../store/uiStore';
import { InteropDialogs } from './InteropDialogs';

const r1 = () => Object.values(useTopologyStore.getState().topology.devices).find((d) => d.hostname === 'R1')!;

beforeEach(() => {
  useProjectStore.getState().openLab(exampleById('office-edge-nat-acl')!);
  useUiStore.getState().setInterop(null);
});
afterEach(cleanup);

describe('Export dialog', () => {
  it('previews each format and lists what did not translate', () => {
    act(() => useUiStore.getState().setInterop('export'));
    render(<InteropDialogs />);
    const dialog = screen.getByRole('dialog', { name: 'Export' });
    expect(within(dialog).getByLabelText('Networky project preview').textContent).toContain('"format": "networky"');

    fireEvent.click(within(dialog).getByRole('radio', { name: /Cisco IOS configuration/ }));
    expect(within(dialog).getByLabelText('Cisco IOS configuration preview').textContent).toContain('ip access-group 110 in');

    fireEvent.click(within(dialog).getByRole('radio', { name: /Terraform/ }));
    expect(within(dialog).getByLabelText('Terraform for an AWS VPC preview').textContent).toContain('resource "aws_nat_gateway" "main"');
    expect(within(dialog).getByText(/did not translate/, { selector: 'summary' })).toBeTruthy();
    expect(within(dialog).getByText(/never contacts AWS/)).toBeTruthy();
  });

  it('Escape closes it', () => {
    act(() => useUiStore.getState().setInterop('export'));
    render(<InteropDialogs />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().interop).toBeNull();
  });
});

describe('Import dialog', () => {
  it('shows a dry run as you paste, applies it as one undo step, and undo restores', () => {
    act(() => useUiStore.getState().setInterop('import'));
    const view = render(<InteropDialogs />);
    const before = useTopologyStore.getState().topology;
    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Configuration text'), {
      target: { value: 'hostname R1\nenable secret 5 abc\nip route 10.50.0.0 255.255.0.0 192.168.1.10\ninterface GigabitEthernet0/9\n ip address 1.1.1.1 255.0.0.0\n' },
    });
    expect(useTopologyStore.getState().topology).toBe(before); // a dry run changes nothing
    const report = screen.getByText(/Configures/).closest('.import-report') as HTMLElement;
    expect(report.textContent).toMatch(/R1 · 1 error/);
    expect(within(report).getByText(/credentials are never imported/)).toBeTruthy();
    expect(within(report).getByText(/no interface GigabitEthernet0\/9/i)).toBeTruthy();

    fireEvent.click(apply);
    expect(useUiStore.getState().interop).toBeNull();
    expect(r1().staticRoutes).toContainEqual({ prefix: '10.50.0.0', prefixLength: 16, nextHop: '192.168.1.10' });
    view.unmount();

    useTopologyStore.getState().undo();
    expect(useTopologyStore.getState().topology).toBe(before);
  });

  it('Replace resets the device before applying', () => {
    act(() => useUiStore.getState().setInterop('import'));
    render(<InteropDialogs />);
    fireEvent.change(screen.getByLabelText('Configuration text'), { target: { value: 'hostname R1\n' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Replace' }));
    expect(screen.getByText(/Reset R1 to factory settings/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(r1().acls).toBeUndefined();
    expect(r1().nat).toBeUndefined();
  });
});
