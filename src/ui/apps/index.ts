// Registry of extra Desktop apps (web browser, email, ...). The device window
// shows a tile for each app whose `kinds` include the device. Add an app by
// adding it to HOST_APPS; nothing else in the window changes.

import type { HostApp, ServicesPanel } from './types';

export type { HostApp, ServicesPanel } from './types';

export const HOST_APPS: HostApp[] = [];

/** Set to a component to give servers a Services tab. */
export const SERVER_SERVICES_PANEL: ServicesPanel | undefined = undefined;
