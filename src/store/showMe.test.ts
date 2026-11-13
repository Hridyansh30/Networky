import { beforeEach, describe, expect, it } from 'vitest';
import { exampleById } from '../model/examples';
import { registry } from '../grading/checks';
import { busy, useSimStore } from './simStore';
import { showMe } from './showMe';
import { useTopologyStore } from './topologyStore';

beforeEach(() => {
  useTopologyStore.getState().replaceAll({ topology: exampleById('office-edge-nat-acl')!.build().topology });
  useSimStore.getState().setMode('realtime');
});

const playOut = () => {
  for (let i = 0; i < 500 && busy(useSimStore.getState()); i++) useSimStore.getState().step();
};

describe('Show me', () => {
  it('replays a failed TCP test in Simulation mode, hop by hop', () => {
    const tcp = registry().get('tcp')!;
    const action = tcp.replay!(tcp.schema.parse({ from: 'PC1', to: '203.0.113.80', port: 22 }));
    expect(showMe(action)).toEqual({ ok: true });
    const s = useSimStore.getState();
    expect(s.mode).toBe('simulation');
    expect(s.playing).toBe(true);
    expect(s.sim.inFlight.length).toBeGreaterThan(0);
    playOut();
    expect(useSimStore.getState().sim.hops.some((h) => h.toDevice && useSimStore.getState().sim.topology.devices[h.toDevice].hostname === 'R1')).toBe(true);
  });
  it('replays a page load as an animated app exchange', () => {
    expect(showMe({ kind: 'http', from: 'PC1', url: 'http://203.0.113.80/' })).toEqual({ ok: true });
    expect(useSimStore.getState().replay).not.toBeNull();
  });
  it('says so when the device is gone', () => {
    expect(showMe({ kind: 'ping', from: 'PC9', to: '1.1.1.1' })).toEqual({ ok: false, error: 'There is no device named PC9 in your network.' });
  });
  it('only traffic checks can be replayed', () => {
    const kinds = [...registry().values()].filter((c) => c.replay).map((c) => c.kind);
    expect(kinds.sort()).toEqual(['http', 'reach', 'tcp']);
  });
});
