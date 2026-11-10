// Registry of extra Desktop apps (web browser, email, ...). The device window
// shows a tile for each app whose `kinds` include the device. Add an app by
// adding it to HOST_APPS; nothing else in the window changes.

import './apps.css';
import { AppIcon } from './common';
import { Email } from './Email';
import { FtpClient } from './FtpClient';
import { Messaging } from './Messaging';
import { ServicesPanel } from './ServicesPanel';
import type { HostApp, ServicesPanel as ServicesPanelType } from './types';
import { WebBrowser } from './WebBrowser';

export type { HostApp, ServicesPanel } from './types';

const ALL_HOSTS: HostApp['kinds'] = ['pc', 'laptop', 'server'];

export const HOST_APPS: HostApp[] = [
  { id: 'browser', title: 'Web Browser', icon: AppIcon.Globe, kinds: ALL_HOSTS, Component: WebBrowser },
  { id: 'email', title: 'Email', icon: AppIcon.Mail, kinds: ALL_HOSTS, Component: Email },
  { id: 'messaging', title: 'Messaging', icon: AppIcon.Chat, kinds: ALL_HOSTS, Component: Messaging },
  { id: 'ftp', title: 'FTP Client', icon: AppIcon.FolderUp, kinds: ALL_HOSTS, Component: FtpClient },
];

/** Set to a component to give servers a Services tab. */
export const SERVER_SERVICES_PANEL: ServicesPanelType | undefined = ServicesPanel;
