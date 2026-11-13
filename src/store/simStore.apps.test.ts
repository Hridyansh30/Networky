// Desktop app traffic in Simulation mode: it runs on the visible network and
// is replayed hop by hop, like a ping, instead of finishing invisibly.
import { beforeEach, describe, expect, it } from 'vitest';
import { browse } from '../apps/client';
import { createDisk } from '../engine/plugins/apps/disk';
import { smallLan } from '../model/testing';
import { busy, useSimStore, wireFrames } from './simStore';
import { useTopologyStore } from './topologyStore';

/** PC0 and a web server SRV on one LAN. */
function lanWithServer() {
  const b = smallLan();
  b.add('server', 'SRV');
  b.link(['SRV', 'GigabitEthernet0'], ['Switch0', 'FastEthernet0/2']);
  b.ip('SRV', 'GigabitEthernet0', '192.168.1.20/24');
  return b.t;
}

const visit = () => useSimStore.getState().runApp((sim) => browse(sim, createDisk(), 'PC0', 'http://192.168.1.20/'));

/** Step to the end, collecting the frames drawn on the cables at each step. */
function playOut(): number[][] {
  const drawn: number[][] = [];
  for (let i = 0; i < 500 && busy(useSimStore.getState()); i++) {
    useSimStore.getState().step();
    drawn.push(wireFrames(useSimStore.getState()).map((t) => t.id));
  }
  return drawn;
}

beforeEach(() => {
  useTopologyStore.getState().replaceAll({ topology: lanWithServer() });
  useSimStore.getState().setMode('realtime');
});

describe('Desktop apps in Simulation mode', () => {
  it('runs instantly in Realtime mode, with nothing to replay', () => {
    const page = visit();
    expect(page.ok).toBe(true);
    expect(useSimStore.getState().replay).toBeNull();
  });

  it('replays the exchange hop by hop on the visible network', () => {
    useSimStore.getState().setMode('simulation');
    const page = visit();
    expect(page.ok).toBe(true);

    const s = useSimStore.getState();
    expect(s.replay).not.toBeNull();
    expect(s.playing).toBe(true);
    expect(wireFrames(s)).toEqual([]); // nothing moves until the first step

    const drawn = playOut();
    const all = drawn.flat();
    // ARP, the TCP handshake, the HTTP request and response, and the close.
    expect(all.length).toBeGreaterThanOrEqual(8);
    // Every recorded hop is drawn exactly once, in event order.
    expect(all).toEqual(useSimStore.getState().sim.hops.map((h) => h.index));
    expect(useSimStore.getState().replay).toBeNull();
    expect(useSimStore.getState().playing).toBe(false);
  });

  it('falls back to an instant run, and says why, while a ping is still moving', () => {
    useSimStore.getState().setMode('simulation');
    useSimStore.getState().send({ kind: 'ping', sourceDeviceId: 'PC0', destination: '192.168.1.1' });
    const page = visit();
    expect(page.ok).toBe(true);
    const s = useSimStore.getState();
    expect(s.replay).toBeNull();
    expect(s.sim.log.some((e) => e.text.includes('without animation'))).toBe(true);
  });

  it('a topology edit cancels a replay in progress', () => {
    useSimStore.getState().setMode('simulation');
    visit();
    useSimStore.getState().step();
    useTopologyStore.getState().replaceAll({ topology: lanWithServer() });
    useSimStore.getState().reset();
    expect(useSimStore.getState().replay).toBeNull();
  });
});
