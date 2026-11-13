import { describe, expect, it } from 'vitest';
import type { HopRecord } from '../engine/simulation';
import { advance, framesOnWire, hopShown, startReplay } from './replay';

const hop = (index: number, tick: number): HopRecord => ({
  index,
  tick,
  frame: { id: index, srcMac: 'a', dstMac: 'b', payload: { kind: 'raw' } as never },
  linkId: `L${index}`,
  fromIf: 'x',
  toIf: 'y',
  fromDevice: 'A',
  toDevice: 'B',
  tag: 'tcp',
  control: false,
});

// Two hops from an earlier ping (1, 2), then an app exchange: tick 7 has two
// frames arriving at once, ticks 8 and 9 one each.
const hops = [hop(1, 2), hop(2, 3), hop(3, 7), hop(4, 7), hop(5, 8), hop(6, 9)];

describe('app replay', () => {
  it('replays only the hops after the starting point, one tick per step', () => {
    const r = startReplay(hops, 2)!;
    expect(r.ticks).toEqual([7, 8, 9]);
    expect(r.at).toBe(-1);
    expect(framesOnWire(r, hops)).toEqual([]); // nothing drawn before the first step
  });

  it('returns null when the exchange produced no traffic', () => {
    expect(startReplay(hops, 6)).toBeNull();
    expect(startReplay([], 0)).toBeNull();
  });

  it('draws every frame of the current tick, keyed by its event number', () => {
    const r = advance(startReplay(hops, 2)!)!;
    expect(framesOnWire(r, hops).map((t) => [t.id, t.linkId])).toEqual([
      [3, 'L3'],
      [4, 'L4'],
    ]);
  });

  it('ends after the last tick', () => {
    let r = startReplay(hops, 2);
    const seen: number[][] = [];
    while ((r = r && advance(r))) seen.push(framesOnWire(r, hops).map((t) => t.id));
    expect(seen).toEqual([[3, 4], [5], [6]]);
  });

  it('lists a replayed hop in the event list only after it has arrived', () => {
    const r0 = startReplay(hops, 2)!;
    expect(hops.filter((h) => hopShown(r0, h)).map((h) => h.index)).toEqual([1, 2]);
    const r1 = advance(r0)!; // tick 7 on the wire
    expect(hops.filter((h) => hopShown(r1, h)).map((h) => h.index)).toEqual([1, 2]);
    const r2 = advance(r1)!; // tick 8 on the wire: tick 7 has arrived
    expect(hops.filter((h) => hopShown(r2, h)).map((h) => h.index)).toEqual([1, 2, 3, 4]);
    expect(hops.every((h) => hopShown(null, h))).toBe(true);
  });
});
