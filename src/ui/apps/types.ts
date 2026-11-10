// The contract between the device window and Desktop apps. An app is a tile
// on a host's Desktop; opening it renders `Component` inside the window.
// Apps never import the window; the window only imports HOST_APPS.

import type { FC } from 'react';
import type { CliEnv } from '../../cli/ios';
import type { DeviceKind } from '../../model/types';

export interface HostApp {
  /** Stable id, unique across apps (also used as the React key). */
  id: string;
  title: string;
  icon: FC<{ size?: number }>;
  /** Device kinds that show this app. */
  kinds: DeviceKind[];
  Component: FC<{ deviceId: string; env: CliEnv }>;
}

/** Optional extra tab on a server's window (pages, DNS records, mailboxes, files). */
export type ServicesPanel = FC<{ deviceId: string; env: CliEnv }>;
