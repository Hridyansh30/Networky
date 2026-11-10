// What the Desktop apps and the server services say to each other.
//
// Each application message rides inside a real transport segment, so it
// crosses switches, routers, ACLs and NAT exactly like a ping does:
//
//   DNS         UDP 53     query → answer                       (one round trip, no connection)
//   HTTP        TCP 80     GET /path → 200 page | 404
//   SMTP        TCP 25     send one mail → 250 accepted | 550 refused
//   POP3        TCP 110    log in and fetch → mails | -ERR
//   FTP         TCP 21     log in + LIST / RETR / STOR / DELE → 226 | 530 | 550
//   Messaging   TCP 5222   one chat line → delivered
//
// Simplifications, said out loud so nobody learns them as fact:
//  - a TCP connection carries exactly one request and one response
//    (SYN, SYN-ACK, request, response, FIN, FIN-ACK); real HTTP and POP3 can
//    send many over one connection, and ACKs are folded into data segments.
//  - FTP really uses two connections (commands on 21, data on 20 or a passive
//    port). Here the file travels on the command connection.
//  - SMTP really is a dialogue (HELO, MAIL FROM, RCPT TO, DATA, QUIT); here the
//    whole envelope is one message. Same for POP3 (USER, PASS, LIST, RETR, DELE).

import type { TcpSegment, UdpDatagram } from '../../packets';

export type AppName = 'dns' | 'http' | 'smtp' | 'pop3' | 'ftp' | 'chat';

export interface Mail {
  from: string;
  to: string;
  subject: string;
  body: string;
  /** Simulation tick when the server accepted it (for ordering). */
  at: number;
}

export interface FileEntry {
  name: string;
  size: number;
}

export type AppRequest =
  | { app: 'dns'; name: string }
  | { app: 'http'; method: 'GET'; host: string; path: string }
  | { app: 'smtp'; mail: Omit<Mail, 'at'> }
  | { app: 'pop3'; user: string; password: string }
  | { app: 'ftp'; user: string; password: string; cmd: 'list' | 'get' | 'put' | 'delete'; name?: string; content?: string }
  | { app: 'chat'; from: string; text: string };

export type AppResponse =
  | { app: 'dns'; name: string; rcode: 'ok' | 'nxdomain'; address?: string }
  | { app: 'http'; status: 200 | 400 | 404; title: string; body: string }
  | { app: 'smtp'; code: 250 | 550 | 552; text: string }
  | { app: 'pop3'; ok: boolean; text: string; mails: Mail[] }
  | { app: 'ftp'; code: 226 | 501 | 530 | 550 | 552; text: string; files?: FileEntry[]; content?: string }
  | { app: 'chat'; ok: true };

/** Which way a segment travels inside the connection. */
export type Direction = 'c2s' | 's2c';

export type AppFlags = 'syn' | 'syn-ack' | 'psh-ack' | 'fin' | 'fin-ack' | 'rst';

/** A TCP segment that belongs to an app exchange. `probeId` ties it to the exchange. */
export interface AppSegment extends Omit<TcpSegment, 'flags'> {
  flags: AppFlags;
  probeId: number;
  app: AppName;
  dir: Direction;
  request?: AppRequest;
  response?: AppResponse;
}

/** A DNS message in a UDP datagram. */
export interface DnsDatagram extends UdpDatagram {
  probeId: number;
  data: { app: 'dns'; request?: AppRequest & { app: 'dns' }; response?: AppResponse & { app: 'dns' } };
}

export const isAppSegment = (l4: { proto: string }): l4 is AppSegment =>
  l4.proto === 'tcp' && typeof (l4 as AppSegment).app === 'string' && typeof (l4 as AppSegment).probeId === 'number';

export const isDnsDatagram = (l4: { proto: string }): l4 is DnsDatagram =>
  l4.proto === 'udp' && (l4 as DnsDatagram).data?.app === 'dns' && typeof (l4 as DnsDatagram).probeId === 'number';

/** Short text for the event list and the envelope tooltip. */
export function describeRequest(r: AppRequest): string {
  switch (r.app) {
    case 'dns':
      return `DNS query: ${r.name}?`;
    case 'http':
      return `HTTP GET ${r.path} (Host: ${r.host})`;
    case 'smtp':
      return `SMTP mail from ${r.mail.from} to ${r.mail.to}`;
    case 'pop3':
      return `POP3 USER ${r.user} / PASS (sent in clear text) / RETR`;
    case 'ftp':
      return `FTP USER ${r.user} / PASS / ${{ list: 'LIST', get: 'RETR', put: 'STOR', delete: 'DELE' }[r.cmd]}${r.name ? ` ${r.name}` : ''}`;
    case 'chat':
      return `Message from ${r.from}`;
  }
}

export function describeResponse(r: AppResponse): string {
  switch (r.app) {
    case 'dns':
      return r.rcode === 'ok' ? `DNS answer: ${r.name} is ${r.address}` : `DNS answer: ${r.name} does not exist (NXDOMAIN)`;
    case 'http':
      return `HTTP ${r.status} ${{ 200: 'OK', 400: 'Bad Request', 404: 'Not Found' }[r.status]}`;
    case 'smtp':
      return `SMTP ${r.code} ${r.text}`;
    case 'pop3':
      return r.ok ? `POP3 +OK ${r.mails.length} message(s)` : `POP3 -ERR ${r.text}`;
    case 'ftp':
      return `FTP ${r.code} ${r.text}`;
    case 'chat':
      return 'Message delivered';
  }
}

export const APP_LABEL: Record<AppName, string> = { dns: 'DNS', http: 'HTTP', smtp: 'SMTP', pop3: 'POP3', ftp: 'FTP', chat: 'Messaging' };
