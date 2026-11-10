import { beforeEach, describe, expect, it } from 'vitest';
import { useTopologyStore as store } from './topologyStore';

const s = () => store.getState();

describe('store', () => {
  beforeEach(() => {
    store.setState({ ...store.getInitialState() });
  });

  it('undo and redo every edit', () => {
    s().addDevice('pc', { x: 0, y: 0 });
    s().addDevice('switch', { x: 100, y: 0 });
    expect(Object.keys(s().topology.devices)).toHaveLength(2);
    s().undo();
    expect(Object.keys(s().topology.devices)).toHaveLength(1);
    s().redo();
    expect(Object.keys(s().topology.devices)).toHaveLength(2);
  });

  it('a refused op adds no history and shows a toast', () => {
    s().addDevice('pc', { x: 0, y: 0 });
    const pc = Object.values(s().topology.devices)[0];
    const before = s().past.length;
    s().connect(pc.interfaceIds[0], pc.interfaceIds[0]);
    expect(s().past.length).toBe(before);
    expect(s().toast?.kind).toBe('error');
  });

  it('a new edit clears the redo stack', () => {
    s().addDevice('pc', { x: 0, y: 0 });
    s().undo();
    expect(s().future).toHaveLength(1);
    s().addDevice('hub', { x: 0, y: 0 });
    expect(s().future).toHaveLength(0);
  });

  it('deleting a device removes its layout entry; undo restores both', () => {
    s().addDevice('router', { x: 5, y: 5 });
    const id = Object.keys(s().topology.devices)[0];
    s().select({ type: 'device', id });
    s().deleteSelection();
    expect(s().layout[id]).toBeUndefined();
    s().undo();
    expect(s().layout[id]).toEqual({ x: 5, y: 5 });
  });

  it('save then load gives the same network', () => {
    s().addDevice('pc', { x: 1, y: 2 });
    s().addDevice('switch', { x: 3, y: 4 });
    const text = s().save();
    const { topology, layout } = s();
    s().reset();
    s().load(text);
    expect(s().topology).toEqual(topology);
    expect(s().layout).toEqual(layout);
  });
});
