// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLES, exampleById } from '../model/examples';
import * as ops from '../model/ops';
import { useProjectStore } from '../store/projectStore';
import { useTopologyStore } from '../store/topologyStore';
import { ConfirmHost } from '../ui/Confirm';
import { openLabLink } from './LabLink';
import { href, parseRoute } from './router';

beforeEach(() => {
  useProjectStore.getState().newProject();
  location.hash = '';
});
afterEach(cleanup);

const makeDirty = () => {
  useProjectStore.getState().openLab(exampleById('dhcp-relay')!);
  const id = Object.keys(useTopologyStore.getState().topology.devices)[0];
  useTopologyStore.getState().apply(({ topology, layout }) => ({ topology: ops.setHostname(topology, id, 'Edited'), layout }));
};

describe('lab ids', () => {
  it('every lab has a unique, URL-safe id', () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it('a lab id round-trips through the router', () => {
    for (const e of EXAMPLES) expect(parseRoute(href({ page: 'lab', labId: e.id }))).toEqual({ page: 'lab', labId: e.id });
  });
  it('malformed ids never reach the lookup', () => {
    expect(parseRoute('#/lab/<script>')).toEqual({ page: 'lab', labId: undefined });
    expect(parseRoute('#/lab/..%2F..')).toEqual({ page: 'lab', labId: undefined });
    expect(exampleById('__proto__')).toBeUndefined();
    expect(exampleById('constructor')).toBeUndefined();
  });
});

describe('#/lab/<id>', () => {
  it('opens a fresh, unsaved copy of the lab and replaces the hash with #/playground', async () => {
    const lab = exampleById('ospf-cheapest-path')!;
    expect(await openLabLink(lab.id)).toBe('opened');
    expect(useProjectStore.getState().lab).toBe(lab.name);
    expect(useProjectStore.getState().id).toBeUndefined();
    expect(useProjectStore.getState().isDirty()).toBe(false);
    expect(location.hash).toBe('#/playground');
  });

  it('an unknown id goes to Learn with a message and changes nothing', async () => {
    const before = useTopologyStore.getState().topology;
    expect(await openLabLink('no-such-lab')).toBe('unknown');
    expect(await openLabLink(undefined)).toBe('unknown');
    expect(location.hash).toBe('#/learn');
    expect(useTopologyStore.getState().topology).toBe(before);
    expect(useTopologyStore.getState().toast?.text).toMatch(/not valid/);
  });

  it('asks before replacing unsaved work, and Cancel keeps it', async () => {
    render(<ConfirmHost />);
    makeDirty();
    const edited = useTopologyStore.getState().topology;
    expect(useProjectStore.getState().isDirty()).toBe(true);
    const pending = openLabLink('hub-vs-switch');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/Hub vs switch/);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));
    expect(await pending).toBe('kept');
    expect(useTopologyStore.getState().topology).toBe(edited);
    expect(location.hash).toBe('#/playground');
  });

  it('confirming replaces the unsaved work with the lab', async () => {
    render(<ConfirmHost />);
    makeDirty();
    const pending = openLabLink('hub-vs-switch');
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Open lab' })));
    expect(await pending).toBe('opened');
    expect(useProjectStore.getState().lab).toBe('Hub vs switch');
  });
});
