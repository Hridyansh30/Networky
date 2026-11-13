// Replaying an exchange that already ran.
//
// Ping and TCP tests are animated by stepping the engine: each step moves
// every frame on the wire one hop. The Desktop apps cannot work that way,
// because one click chains several exchanges (a DNS lookup, then an HTTP
// request) and the app needs each answer before it sends the next.
//
// So in Simulation mode an app runs to completion on the visible network,
// and the hops it produced are replayed tick by tick afterwards. The engine
// recorded each hop with the tick it arrived on, and a frame is "on the wire"
// during the step before it arrives, so replaying tick T shows exactly the
// frames a live run would have shown before step T. The event list and PDU
// details work unchanged: they read the same hop records.
//
// Everything here is pure, so the store stays thin and the logic is tested
// without React.

import type { Transmission } from '../engine/packets';
import type { HopRecord } from '../engine/simulation';

export interface Replay {
  /** Hops with an index above this one belong to the replay. */
  readonly afterIndex: number;
  /** The distinct ticks of those hops, in order. */
  readonly ticks: readonly number[];
  /** Position in `ticks`: -1 before the first step, ticks.length - 1 on the last. */
  readonly at: number;
}

/** A replay of every hop recorded after `afterIndex`, or null if there were none. */
export function startReplay(hops: readonly HopRecord[], afterIndex: number): Replay | null {
  const ticks: number[] = [];
  for (const h of hops) {
    if (h.index <= afterIndex) continue;
    if (ticks[ticks.length - 1] !== h.tick) ticks.push(h.tick);
  }
  return ticks.length ? { afterIndex, ticks, at: -1 } : null;
}

/** One step forward; null once the last tick has been shown. */
export function advance(replay: Replay): Replay | null {
  const at = replay.at + 1;
  return at < replay.ticks.length ? { ...replay, at } : null;
}

const currentTick = (r: Replay): number | undefined => (r.at >= 0 ? r.ticks.at(r.at) : undefined);

/** The frames to draw on the cables right now, shaped like live transmissions. */
export function framesOnWire(replay: Replay, hops: readonly HopRecord[]): Transmission[] {
  const tick = currentTick(replay);
  if (tick === undefined) return [];
  return hops
    .filter((h) => h.index > replay.afterIndex && h.tick === tick)
    .map((h) => ({ id: h.index, frame: h.frame, linkId: h.linkId, fromIf: h.fromIf, toIf: h.toIf }));
}

/**
 * Whether the event list shows this hop yet. Like a live run, a hop is listed
 * once it has arrived, which is after the step that showed it on the wire.
 */
export function hopShown(replay: Replay | null, hop: HopRecord): boolean {
  if (!replay || hop.index <= replay.afterIndex) return true;
  const tick = currentTick(replay);
  return tick !== undefined && hop.tick < tick;
}
