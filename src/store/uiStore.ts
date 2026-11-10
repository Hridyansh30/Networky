// UI-only state shared across components: which device window is open.
// Nothing here is saved or affects the simulation.

import { create } from 'zustand';
import { useTopologyStore } from './topologyStore';

export type WindowTab = 'desktop' | 'config' | 'services' | 'cli' | 'tables';
/** 'home' is the app grid; built-in apps are 'ipconfig', 'prompt', 'dhcp'; registry apps use their own id. */
export type DesktopApp = string;

interface UiState {
  /** Device whose window (Desktop / Config / CLI) is open, like double-clicking in Packet Tracer. */
  windowDeviceId: string | null;
  windowTab: WindowTab;
  desktopApp: DesktopApp;
  openWindow(deviceId: string, tab?: WindowTab): void;
  closeWindow(): void;
  setWindowTab(tab: WindowTab): void;
  setDesktopApp(app: DesktopApp): void;
}

export const useUiStore = create<UiState>()((set) => ({
  windowDeviceId: null,
  windowTab: 'config',
  desktopApp: 'home',
  openWindow(deviceId, tab) {
    set({ windowDeviceId: deviceId, windowTab: tab ?? 'config', desktopApp: 'home' });
  },
  closeWindow() {
    set({ windowDeviceId: null });
  },
  setWindowTab(windowTab) {
    set({ windowTab });
  },
  setDesktopApp(desktopApp) {
    set({ desktopApp });
  },
}));

// A deleted device closes its window.
useTopologyStore.subscribe((s) => {
  const id = useUiStore.getState().windowDeviceId;
  if (id && !s.topology.devices[id]) useUiStore.getState().closeWindow();
});
