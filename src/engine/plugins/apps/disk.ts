// A device's "disk": data the applications produce, as opposed to the
// configuration in the topology. Mail waiting in a mailbox, mail a client
// downloaded, chat history, files uploaded over FTP.
//
// It lives OUTSIDE the Simulation on purpose. The workspace rebuilds the
// simulation whenever the network is edited or the mode changes (that is a
// power cycle: tables and leases are lost, as on real gear), but a mail
// server does not forget its mailboxes when someone moves a cable.
//
// The engine plugin receives a Disk through attachDisk(); tests use a fresh
// one. The workspace keeps a single Disk for the session (apps/diskStore.ts).

import type { FtpFile } from '../../../model/services';
import type { Mail } from './messages';

export interface ChatLine {
  /** 'me' = this device sent it. */
  from: 'me' | 'them';
  /** Hostname that sent it. */
  name: string;
  text: string;
  at: number;
}

export interface DeviceDisk {
  /** Mail server: user -> mail waiting for POP3. */
  mailboxes: Record<string, Mail[]>;
  /** Mail client: mail downloaded with POP3, and mail it sent. */
  inbox: Mail[];
  sent: Mail[];
  /** Messaging: peer IP -> conversation. */
  chats: Record<string, ChatLine[]>;
  /** FTP server: the files, once the server has started (seeded from its config). */
  ftpFiles?: FtpFile[];
}

export interface Disk {
  devices: Record<string, DeviceDisk>;
}

export const MAX_MAIL_PER_BOX = 200;
export const MAX_CHAT_LINES = 500;

export function createDisk(): Disk {
  return { devices: Object.create(null) as Record<string, DeviceDisk> };
}

export function diskOf(disk: Disk, deviceId: string): DeviceDisk {
  if (!Object.prototype.hasOwnProperty.call(disk.devices, deviceId)) {
    disk.devices[deviceId] = { mailboxes: Object.create(null), inbox: [], sent: [], chats: Object.create(null) };
  }
  return disk.devices[deviceId];
}

/** Append, keeping only the newest `max` entries. */
export function pushCapped<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}
