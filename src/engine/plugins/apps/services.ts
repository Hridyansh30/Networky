// The server side: what each service answers. Pure functions of
// (configuration, disk, request); the plugin moves the bytes.

import { isFileName, LIMITS_SERVICES, PORTS, servicesOf, type Account, type ServicesConfig } from '../../../model/services';
import { isHostKind } from '../../../model/catalog';
import type { Device } from '../../../model/types';
import { diskOf, MAX_CHAT_LINES, MAX_MAIL_PER_BOX, pushCapped, type Disk } from './disk';
import type { AppName, AppRequest, AppResponse } from './messages';

/** Which app answers on a TCP port of this device, or undefined if nothing listens. */
export function tcpListener(device: Device, port: number): AppName | undefined {
  if (!isHostKind(device.kind)) return undefined;
  const s = servicesOf(device);
  if (port === PORTS.http && s.http?.enabled) return 'http';
  if (port === PORTS.smtp && s.mail?.enabled) return 'smtp';
  if (port === PORTS.pop3 && s.mail?.enabled) return 'pop3';
  if (port === PORTS.ftp && s.ftp?.enabled) return 'ftp';
  if (port === PORTS.chat) return 'chat'; // every computer runs the messenger
  return undefined;
}

export function udpListener(device: Device, port: number): AppName | undefined {
  if (!isHostKind(device.kind)) return undefined;
  return port === PORTS.dns && servicesOf(device).dns?.enabled ? 'dns' : undefined;
}

export interface ServeContext {
  device: Device;
  disk: Disk;
  /** The client's IP as the server sees it (after NAT). */
  clientIp: string;
  tick: number;
}

const login = (accounts: Account[] | undefined, user: string, password: string) =>
  !!accounts?.some((a) => a.user === user && a.password === password);

export function serve(ctx: ServeContext, req: AppRequest): AppResponse {
  const s: ServicesConfig = servicesOf(ctx.device);
  const disk = diskOf(ctx.disk, ctx.device.id);

  switch (req.app) {
    case 'dns': {
      const name = req.name.toLowerCase().replace(/\.$/, '');
      const record = s.dns?.records.find((r) => r.name === name);
      return record ? { app: 'dns', name, rcode: 'ok', address: record.address } : { app: 'dns', name, rcode: 'nxdomain' };
    }

    case 'http': {
      const path = req.path === '/' || req.path === '' ? '/index.html' : req.path;
      const page = s.http?.pages.find((p) => p.path === path);
      if (page) return { app: 'http', status: 200, title: page.title, body: page.body };
      return { app: 'http', status: 404, title: 'Not Found', body: `<h1>404 Not Found</h1><p>${escape(ctx.device.hostname)} has no page at ${escape(path)}.</p>` };
    }

    case 'smtp': {
      const [user, domain] = req.mail.to.toLowerCase().split('@');
      if (!s.mail || domain !== s.mail.domain) return { app: 'smtp', code: 550, text: `relaying denied: ${ctx.device.hostname} only accepts mail for @${s.mail?.domain ?? '(none)'}` };
      if (!s.mail.accounts.some((a) => a.user === user)) return { app: 'smtp', code: 550, text: `no such user: ${user}@${domain}` };
      if (req.mail.body.length > LIMITS_SERVICES.pageBody || req.mail.subject.length > 200) return { app: 'smtp', code: 552, text: 'message too large' };
      const box = (disk.mailboxes[user] ??= []);
      pushCapped(box, { ...req.mail, at: ctx.tick }, MAX_MAIL_PER_BOX);
      return { app: 'smtp', code: 250, text: `OK, queued for ${user}@${domain}` };
    }

    case 'pop3': {
      if (!login(s.mail?.accounts, req.user, req.password)) return { app: 'pop3', ok: false, text: 'invalid user name or password', mails: [] };
      // POP3 hands the mail over and deletes it from the server (RETR + DELE).
      const mails = disk.mailboxes[req.user] ?? [];
      disk.mailboxes[req.user] = [];
      return { app: 'pop3', ok: true, text: `${mails.length} message(s)`, mails };
    }

    case 'ftp': {
      if (!s.ftp || !login(s.ftp.accounts, req.user, req.password)) return { app: 'ftp', code: 530, text: 'Login incorrect' };
      // The server's files start as its configured ones; uploads change them on disk.
      const files = (disk.ftpFiles ??= s.ftp.files.map((f) => ({ ...f })));
      const name = req.name ?? '';
      switch (req.cmd) {
        case 'list':
          return { app: 'ftp', code: 226, text: `${files.length} file(s)`, files: files.map((f) => ({ name: f.name, size: f.content.length })) };
        case 'get': {
          const f = files.find((x) => x.name === name);
          return f ? { app: 'ftp', code: 226, text: `Transfer complete: ${f.name}`, content: f.content } : { app: 'ftp', code: 550, text: `${name}: no such file` };
        }
        case 'put': {
          if (!isFileName(name)) return { app: 'ftp', code: 501, text: `'${name}' is not a valid file name` };
          const content = req.content ?? '';
          if (content.length > LIMITS_SERVICES.fileBytes) return { app: 'ftp', code: 552, text: `file larger than ${LIMITS_SERVICES.fileBytes} characters` };
          const existing = files.find((x) => x.name === name);
          if (existing) existing.content = content;
          else if (files.length >= LIMITS_SERVICES.files) return { app: 'ftp', code: 552, text: 'disk full: too many files' };
          else files.push({ name, content });
          return { app: 'ftp', code: 226, text: `Transfer complete: ${name} stored` };
        }
        case 'delete': {
          const i = files.findIndex((x) => x.name === name);
          if (i < 0) return { app: 'ftp', code: 550, text: `${name}: no such file` };
          files.splice(i, 1);
          return { app: 'ftp', code: 226, text: `${name} deleted` };
        }
      }
      return { app: 'ftp', code: 501, text: 'unknown command' };
    }

    case 'chat': {
      const text = req.text.slice(0, 1000);
      pushCapped((disk.chats[ctx.clientIp] ??= []), { from: 'them', name: req.from.slice(0, 63), text, at: ctx.tick }, MAX_CHAT_LINES);
      return { app: 'chat', ok: true };
    }
  }
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
