// What the Desktop apps do, without any React: resolve a name, fetch a page,
// send and fetch mail, use FTP, send a chat message. Each function drives the
// simulation until the exchange finishes (like ping in the command prompt) and
// returns the answer plus the steps it took, so the app can show the learner
// what happened on the network.

import { leasesOf } from '../engine/plugins/dhcp';
import { attachDisk, responseOf, startExchange } from '../engine/plugins/apps';
import { diskOf, MAX_CHAT_LINES, pushCapped, type Disk } from '../engine/plugins/apps/disk';
import type { AppRequest, AppResponse, Mail } from '../engine/plugins/apps/messages';
import type { Probe } from '../engine/plugin';
import type { Simulation } from '../engine/simulation';
import { isValidIPv4 } from '../model/ip';
import { isDnsName, isWebPath, PORTS } from '../model/services';

export type Outcome<T> = { ok: true; value: T; steps: string[] } | { ok: false; error: string; steps: string[] };

const RUN_LIMIT = 5000;

/** Why an exchange failed, in words a student can act on. */
export function explainFailure(p: Probe): string {
  switch (p.status) {
    case 'refused':
      return `Connection refused: ${p.detail}`;
    case 'prohibited':
      return `Blocked by an access list (${p.respondent} answered "administratively prohibited")`;
    case 'unreachable':
      return p.detail?.includes('port unreachable') ? `${p.destination} is not running that service (ICMP port unreachable)` : `Unreachable: ${p.detail}`;
    case 'ttl-exceeded':
      return `TTL expired at ${p.respondent}: probably a routing loop`;
    case 'lost':
      return 'No answer: the packet was dropped on the way (check the event list)';
    default:
      return p.detail ?? 'The request did not finish';
  }
}

/** Run one request to completion. */
export function exchange(sim: Simulation, disk: Disk, clientId: string, serverIp: string, request: AppRequest): { probe: Probe; response?: AppResponse } {
  attachDisk(sim, disk);
  const probe = startExchange(sim, clientId, serverIp, request);
  sim.run(RUN_LIMIT);
  return { probe, response: probe.status === 'success' ? responseOf(sim, probe.id) : undefined };
}

/** The DNS server this host asks: its own setting, else the one DHCP gave it. */
export function dnsServerOf(sim: Simulation, clientId: string): string | undefined {
  const device = sim.topology.devices[clientId];
  if (!device) return undefined;
  if (device.dnsServer) return device.dnsServer;
  const leases = leasesOf(sim);
  for (const id of device.interfaceIds) {
    const dns = leases[id]?.dns;
    if (dns) return dns;
  }
  return undefined;
}

/** Turn a name into an IP. An IP is returned as it is, without asking anyone. */
export function resolve(sim: Simulation, disk: Disk, clientId: string, host: string): Outcome<string> {
  const name = host.trim().toLowerCase().replace(/\.$/, '');
  if (isValidIPv4(name)) return { ok: true, value: name, steps: [] };
  if (!isDnsName(name)) return { ok: false, error: `'${host}' is not a valid host name`, steps: [] };
  const dns = dnsServerOf(sim, clientId);
  if (!dns) return { ok: false, error: `No DNS server is set on this computer, so it cannot look up ${name}. Set one in Config, or use an IP address.`, steps: [] };
  const steps = [`Asking DNS server ${dns} for ${name} (UDP port 53)`];
  const { probe, response } = exchange(sim, disk, clientId, dns, { app: 'dns', name });
  if (!response || response.app !== 'dns') return { ok: false, error: `DNS lookup failed. ${explainFailure(probe)}`, steps };
  if (response.rcode !== 'ok' || !response.address) return { ok: false, error: `${name} does not exist on DNS server ${dns} (NXDOMAIN)`, steps };
  steps.push(`${name} is ${response.address}`);
  return { ok: true, value: response.address, steps };
}

// ------------------------------------------------------------------ web

export interface ParsedUrl {
  host: string;
  path: string;
}

export function parseUrl(input: string): ParsedUrl | string {
  let s = input.trim();
  if (!s) return 'Type an address, like http://www.networky.lab or http://10.0.0.5';
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name === 'https') return 'https needs TLS, which this simulator does not model yet. Use http://';
    if (name !== 'http') return `The browser only speaks http, not ${name}`;
    s = s.slice(scheme[0].length);
  }
  const slash = s.indexOf('/');
  let host = slash < 0 ? s : s.slice(0, slash);
  const path = slash < 0 ? '/' : s.slice(slash);
  const port = /:(\d+)$/.exec(host);
  if (port) {
    if (Number(port[1]) !== PORTS.http) return 'Web servers here listen on port 80 only';
    host = host.slice(0, port.index);
  }
  host = host.toLowerCase();
  if (!isValidIPv4(host) && !isDnsName(host)) return `'${host}' is not a valid address or host name`;
  if (path !== '/' && !isWebPath(path)) return `'${path}' is not a page path this server can have`;
  return { host, path };
}

export interface Page {
  url: string;
  status: number;
  title: string;
  body: string;
}

export function browse(sim: Simulation, disk: Disk, clientId: string, input: string): Outcome<Page> {
  const url = parseUrl(input);
  if (typeof url === 'string') return { ok: false, error: url, steps: [] };
  const ip = resolve(sim, disk, clientId, url.host);
  if (!ip.ok) return ip;
  const steps = [...ip.steps, `Connecting to ${ip.value}:80 (TCP handshake)`, `Sending HTTP GET ${url.path}`];
  const { probe, response } = exchange(sim, disk, clientId, ip.value, { app: 'http', method: 'GET', host: url.host, path: url.path });
  if (!response || response.app !== 'http') return { ok: false, error: explainFailure(probe), steps };
  steps.push(`Server answered HTTP ${response.status}`);
  return { ok: true, value: { url: `http://${url.host}${url.path}`, status: response.status, title: response.title, body: response.body }, steps };
}

// ------------------------------------------------------------------ mail

export interface MailAccount {
  name: string;
  address: string;
  smtpServer: string;
  pop3Server: string;
  user: string;
  password: string;
}

export function sendMail(sim: Simulation, disk: Disk, clientId: string, account: MailAccount, to: string, subject: string, body: string): Outcome<string> {
  const ip = resolve(sim, disk, clientId, account.smtpServer);
  if (!ip.ok) return { ...ip, error: `Outgoing server: ${ip.error}` };
  const mail = { from: account.address, to: to.trim().toLowerCase(), subject, body };
  const steps = [...ip.steps, `Connecting to SMTP server ${ip.value}:25`];
  const { probe, response } = exchange(sim, disk, clientId, ip.value, { app: 'smtp', mail });
  if (!response || response.app !== 'smtp') return { ok: false, error: explainFailure(probe), steps };
  steps.push(`Server: ${response.code} ${response.text}`);
  if (response.code !== 250) return { ok: false, error: `${response.code} ${response.text}`, steps };
  pushCapped(diskOf(disk, clientId).sent, { ...mail, at: sim.tick }, 200);
  return { ok: true, value: response.text, steps };
}

export function fetchMail(sim: Simulation, disk: Disk, clientId: string, account: MailAccount): Outcome<Mail[]> {
  const ip = resolve(sim, disk, clientId, account.pop3Server);
  if (!ip.ok) return { ...ip, error: `Incoming server: ${ip.error}` };
  const steps = [...ip.steps, `Connecting to POP3 server ${ip.value}:110`, `Logging in as ${account.user} (the password crosses the network in clear text)`];
  const { probe, response } = exchange(sim, disk, clientId, ip.value, { app: 'pop3', user: account.user, password: account.password });
  if (!response || response.app !== 'pop3') return { ok: false, error: explainFailure(probe), steps };
  if (!response.ok) return { ok: false, error: `Server: -ERR ${response.text}`, steps };
  steps.push(`Downloaded ${response.mails.length} new message(s)`);
  const inbox = diskOf(disk, clientId).inbox;
  for (const m of response.mails) pushCapped(inbox, m, 200);
  return { ok: true, value: response.mails, steps };
}

// ------------------------------------------------------------------ ftp

export type FtpCommand = { cmd: 'list' } | { cmd: 'get'; name: string } | { cmd: 'put'; name: string; content: string } | { cmd: 'delete'; name: string };

export function ftp(sim: Simulation, disk: Disk, clientId: string, server: string, user: string, password: string, command: FtpCommand): Outcome<AppResponse & { app: 'ftp' }> {
  const ip = resolve(sim, disk, clientId, server);
  if (!ip.ok) return ip;
  const steps = [...ip.steps, `Connecting to FTP server ${ip.value}:21`];
  const { probe, response } = exchange(sim, disk, clientId, ip.value, { app: 'ftp', user, password, ...command });
  if (!response || response.app !== 'ftp') return { ok: false, error: explainFailure(probe), steps };
  steps.push(`Server: ${response.code} ${response.text}`);
  if (response.code !== 226) return { ok: false, error: `${response.code} ${response.text}`, steps };
  return { ok: true, value: response, steps };
}

// ------------------------------------------------------------------ messaging

export function sendChat(sim: Simulation, disk: Disk, clientId: string, peer: string, text: string): Outcome<string> {
  const trimmed = text.trim().slice(0, 1000);
  if (!trimmed) return { ok: false, error: 'Type a message first', steps: [] };
  const ip = resolve(sim, disk, clientId, peer);
  if (!ip.ok) return ip;
  const me = sim.topology.devices[clientId];
  const steps = [...ip.steps, `Connecting to ${ip.value}:${PORTS.chat}`];
  const { probe, response } = exchange(sim, disk, clientId, ip.value, { app: 'chat', from: me?.hostname ?? '?', text: trimmed });
  if (!response) return { ok: false, error: explainFailure(probe), steps };
  pushCapped((diskOf(disk, clientId).chats[ip.value] ??= []), { from: 'me', name: me?.hostname ?? '?', text: trimmed, at: sim.tick }, MAX_CHAT_LINES);
  steps.push('Delivered');
  return { ok: true, value: ip.value, steps };
}
