// One Disk for the whole session: what the apps produced (mailboxes, chats,
// uploads). Not saved in the project file; a page reload starts empty.
// `version` bumps after every exchange so open app windows re-render
// (a message sent from PC0 shows up in PC1's open Messaging window).

import { create } from 'zustand';
import { createDisk, type Disk } from '../engine/plugins/apps/disk';
import type { Simulation } from '../engine/simulation';
import { useSimStore } from '../store/simStore';

interface DiskState {
  disk: Disk;
  version: number;
}

export const useDiskStore = create<DiskState>()(() => ({ disk: createDisk(), version: 0 }));

/**
 * Run an app action and refresh everything that shows network state (ARP
 * caches, NAT tables, the apps themselves). In Realtime mode it runs on the
 * converged network; in Simulation mode the sim store runs it on the visible
 * network and replays its packets on the canvas.
 */
export function runApp<T>(action: (sim: Simulation, disk: Disk) => T): T {
  const { disk } = useDiskStore.getState();
  const result = useSimStore.getState().runApp((sim) => action(sim, disk));
  useDiskStore.setState((s) => ({ version: s.version + 1 }));
  return result;
}

/** Re-render when any app exchange happens anywhere. */
export function useDiskVersion(): number {
  return useDiskStore((s) => s.version);
}
