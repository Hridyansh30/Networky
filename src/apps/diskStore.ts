// One Disk for the whole session: what the apps produced (mailboxes, chats,
// uploads). Not saved in the project file; a page reload starts empty.
// `version` bumps after every exchange so open app windows re-render
// (a message sent from PC0 shows up in PC1's open Messaging window).

import { create } from 'zustand';
import type { CliEnv } from '../cli/ios';
import { createDisk, type Disk } from '../engine/plugins/apps/disk';
import type { Simulation } from '../engine/simulation';
import { useSimStore } from '../store/simStore';

interface DiskState {
  disk: Disk;
  version: number;
}

export const useDiskStore = create<DiskState>()(() => ({ disk: createDisk(), version: 0 }));

/**
 * Run an app action on the converged network and refresh everything that
 * shows network state (ARP caches, NAT tables, the apps themselves).
 */
export function runApp<T>(env: CliEnv, action: (sim: Simulation, disk: Disk) => T): T {
  const { disk } = useDiskStore.getState();
  const result = action(env.sim(), disk);
  useDiskStore.setState((s) => ({ version: s.version + 1 }));
  useSimStore.setState((s) => ({ version: s.version + 1 }));
  return result;
}

/** Re-render when any app exchange happens anywhere. */
export function useDiskVersion(): number {
  return useDiskStore((s) => s.version);
}
