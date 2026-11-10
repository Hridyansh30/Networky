// Application services and the client settings of the Desktop apps.
//
// What lives HERE (in the topology, saved with the project):
//   server side  web pages, DNS records, mail domain and accounts, FTP accounts
//                and starting files: the server's configuration
//   client side  the email account a PC uses (address, servers, password)
//
// What does NOT live here: mail waiting in a mailbox, chat history, files
// uploaded over FTP. Those are data the network produced, not configuration;
// they live on the device's "disk" (apps/disk.ts) and survive a network
// restart but are not saved into the .networky.json file.
//
// Passwords are stored in plain text on purpose: this is a teaching
// simulator and the point is to watch them cross the wire in clear text,
// which is exactly why real FTP and POP3 without TLS are unsafe.

import { produce } from 'immer';
import { isHostKind } from './catalog';
import { isValidIPv4 } from './ip';
import { TopologyError } from './ops';
import type { Device, Topology } from './types';

export interface WebPage {
  /** '/index.html', '/about.html' */
  path: string;
  title: string;
  /** A small, safe subset of HTML (see apps/html.ts). Never rendered as raw HTML. */
  body: string;
}

export interface DnsRecord {
  /** Fully qualified name, lower case: 'www.networky.lab' */
  name: string;
  type: 'A';
  address: string;
}

export interface Account {
  user: string;
  password: string;
}

export interface FtpFile {
  name: string;
  content: string;
}

export interface ServicesConfig {
  http?: { enabled: boolean; pages: WebPage[] };
  dns?: { enabled: boolean; records: DnsRecord[] };
  /** SMTP (25) receives mail for `domain`; POP3 (110) hands it to its owner. */
  mail?: { enabled: boolean; domain: string; accounts: Account[] };
  ftp?: { enabled: boolean; accounts: Account[]; files: FtpFile[] };
  /** Client: the account the Email app uses. */
  mailClient?: MailClientConfig;
}

export interface MailClientConfig {
  name: string;
  /** 'alice@networky.lab' */
  address: string;
  /** Outgoing (SMTP) and incoming (POP3) server: an IP or a DNS name. */
  smtpServer: string;
  pop3Server: string;
  user: string;
  password: string;
}

/** Well-known ports. */
export const PORTS = { ftp: 21, smtp: 25, dns: 53, http: 80, pop3: 110, chat: 5222 } as const;

export const LIMITS_SERVICES = {
  pages: 32,
  pageBody: 8000,
  records: 128,
  accounts: 32,
  files: 32,
  fileBytes: 20000,
} as const;

/** What a server runs before anyone configures it: a web server with a welcome page. */
export function defaultServerServices(device: Device): ServicesConfig {
  return {
    http: {
      enabled: true,
      pages: [
        {
          path: '/index.html',
          title: device.hostname,
          body: `<h1>Welcome to ${escapeText(device.hostname)}</h1>\n<p>This page is served by the HTTP service on ${escapeText(device.hostname)}. Edit it in the server's Services tab.</p>\n<p><a href="/about.html">About this server</a></p>`,
        },
        {
          path: '/about.html',
          title: 'About',
          body: '<h2>About</h2>\n<p>A browser asked for this page with an HTTP GET over a TCP connection to port 80.</p>\n<p><a href="/index.html">Back home</a></p>',
        },
      ],
    },
    dns: { enabled: false, records: [] },
    mail: { enabled: false, domain: 'networky.lab', accounts: [] },
    ftp: { enabled: false, accounts: [], files: [] },
  };
}

/** The services a device actually runs: its own config, or the server defaults. */
export function servicesOf(device: Device): ServicesConfig {
  if (device.services) return device.services;
  return device.kind === 'server' ? defaultServerServices(device) : {};
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ------------------------------------------------------------------ ops

/** Replace a device's services (from the Services tab or the Email app's settings). */
export function setServices(t: Topology, deviceId: string, services: ServicesConfig | undefined): Topology {
  const device = t.devices[deviceId];
  if (!device) throw new TopologyError(`Device '${deviceId}' does not exist`);
  if (!isHostKind(device.kind)) throw new TopologyError('Only PCs, laptops and servers run applications');
  const problem = services && servicesProblem(services);
  if (problem) throw new TopologyError(problem);
  return produce(t, (draft) => {
    if (services) draft.devices[deviceId].services = services;
    else delete draft.devices[deviceId].services;
  });
}

/** The DNS server a host asks for names. Absent: the one DHCP handed out, if any. */
export function setDnsServer(t: Topology, deviceId: string, dnsServer: string | undefined): Topology {
  const device = t.devices[deviceId];
  if (!device) throw new TopologyError(`Device '${deviceId}' does not exist`);
  if (!isHostKind(device.kind)) throw new TopologyError('Only PCs, laptops and servers use a DNS server');
  const value = dnsServer?.trim();
  if (value && !isValidIPv4(value)) throw new TopologyError(`'${value}' is not a valid IPv4 address`);
  return produce(t, (draft) => {
    if (value) draft.devices[deviceId].dnsServer = value;
    else delete draft.devices[deviceId].dnsServer;
  });
}

const DNS_NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const PATH = /^\/[A-Za-z0-9._~-]{0,64}$/;
const USER = /^[a-z0-9._-]{1,32}$/;
const FILE = /^[A-Za-z0-9._-]{1,64}$/;

export const isDnsName = (s: string) => DNS_NAME.test(s);
export const isWebPath = (s: string) => PATH.test(s);
/** Names that could break plain-object lookups if used as keys. */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export const isUserName = (s: string) => USER.test(s) && !RESERVED.has(s);
export const isFileName = (s: string) => FILE.test(s) && s !== '.' && s !== '..';

/** First thing wrong with a services config, in words, or null. */
export function servicesProblem(s: ServicesConfig): string | null {
  const L = LIMITS_SERVICES;
  if (s.http) {
    if (s.http.pages.length > L.pages) return `At most ${L.pages} web pages`;
    const seen = new Set<string>();
    for (const p of s.http.pages) {
      if (!isWebPath(p.path)) return `'${p.path}' is not a page path (use /name.html: letters, digits, . _ ~ -)`;
      if (seen.has(p.path)) return `Two pages use the path ${p.path}`;
      seen.add(p.path);
      if (p.body.length > L.pageBody) return `Page ${p.path} is longer than ${L.pageBody} characters`;
      if (p.title.length > 80) return `The title of ${p.path} is longer than 80 characters`;
    }
  }
  if (s.dns) {
    if (s.dns.records.length > L.records) return `At most ${L.records} DNS records`;
    for (const r of s.dns.records) {
      if (!isDnsName(r.name)) return `'${r.name}' is not a valid host name (lower case, like www.networky.lab)`;
      if (!isValidIPv4(r.address)) return `'${r.address}' is not a valid IPv4 address`;
    }
  }
  for (const [label, accounts] of [['mail', s.mail?.accounts], ['FTP', s.ftp?.accounts]] as const) {
    if (!accounts) continue;
    if (accounts.length > L.accounts) return `At most ${L.accounts} ${label} accounts`;
    const seen = new Set<string>();
    for (const a of accounts) {
      if (!isUserName(a.user)) return `'${a.user}' is not a valid user name (lower case letters, digits, . _ -)`;
      if (seen.has(a.user)) return `Two ${label} accounts are called ${a.user}`;
      seen.add(a.user);
      if (a.password.length < 1 || a.password.length > 64) return `The password for ${a.user} must be 1 to 64 characters`;
    }
  }
  if (s.mail && !isDnsName(s.mail.domain)) return `'${s.mail.domain}' is not a valid mail domain`;
  if (s.ftp) {
    if (s.ftp.files.length > L.files) return `At most ${L.files} FTP files`;
    for (const f of s.ftp.files) {
      if (!isFileName(f.name)) return `'${f.name}' is not a valid file name`;
      if (f.content.length > L.fileBytes) return `${f.name} is larger than ${L.fileBytes} characters`;
    }
  }
  if (s.mailClient) {
    const c = s.mailClient;
    if (!/^[a-z0-9._-]{1,32}@[a-z0-9.-]{1,253}$/.test(c.address)) return `'${c.address}' is not an email address`;
    for (const server of [c.smtpServer, c.pop3Server]) {
      if (server && !isValidIPv4(server) && !isDnsName(server)) return `'${server}' is not an IP address or host name`;
    }
  }
  return null;
}
