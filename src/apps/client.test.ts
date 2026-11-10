import { describe, expect, it } from 'vitest';
import { createDisk, diskOf } from '../engine/plugins/apps/disk';
import { boot } from '../engine/testing';
import { parseRule } from '../model/acl';
import { setAcl, setDefaultGateway, setInterfaceOptions, setNat } from '../model/ops';
import { defaultServerServices, setDnsServer, setServices, type ServicesConfig } from '../model/services';
import { Builder } from '../model/testing';
import type { Acl } from '../model/types';
import { browse, fetchMail, ftp, parseUrl, resolve, sendChat, sendMail, type MailAccount } from './client';

/**
 *  PC0 192.168.1.10 ┐                                  ┌ SRV 203.0.113.80 (web, dns, mail, ftp)
 *  PC1 192.168.1.11 ┴ S0 ── R0 .1.1 | 203.0.113.1 ── S1 ┤
 *                                                      └ EXT 203.0.113.50
 */
function lab() {
  const b = new Builder();
  for (const [k, n] of [['pc', 'PC0'], ['laptop', 'PC1'], ['switch', 'S0'], ['router', 'R0'], ['switch', 'S1'], ['server', 'SRV'], ['pc', 'EXT']] as const) b.add(k, n);
  b.link(['PC0', 'FastEthernet0'], ['S0', 'FastEthernet0/1']);
  b.link(['PC1', b.t.interfaces[b.t.devices.PC1.interfaceIds[0]].name], ['S0', 'FastEthernet0/2']);
  b.link(['S0', 'GigabitEthernet0/1'], ['R0', 'GigabitEthernet0/0']);
  b.link(['R0', 'GigabitEthernet0/1'], ['S1', 'GigabitEthernet0/1']);
  b.link(['S1', 'FastEthernet0/1'], ['SRV', 'GigabitEthernet0']);
  b.link(['S1', 'FastEthernet0/2'], ['EXT', 'FastEthernet0']);
  b.ip('PC0', 'FastEthernet0', '192.168.1.10/24');
  b.ip('PC1', b.t.interfaces[b.t.devices.PC1.interfaceIds[0]].name, '192.168.1.11/24');
  b.ip('R0', 'GigabitEthernet0/0', '192.168.1.1/24');
  b.ip('R0', 'GigabitEthernet0/1', '203.0.113.1/24');
  b.ip('SRV', 'GigabitEthernet0', '203.0.113.80/24');
  b.ip('EXT', 'FastEthernet0', '203.0.113.50/24');
  b.t = setDefaultGateway(b.t, 'PC0', '192.168.1.1');
  b.t = setDefaultGateway(b.t, 'PC1', '192.168.1.1');
  b.t = setDefaultGateway(b.t, 'SRV', '203.0.113.1');
  b.t = setDefaultGateway(b.t, 'EXT', '203.0.113.1');
  const services: ServicesConfig = {
    ...defaultServerServices(b.t.devices.SRV),
    dns: { enabled: true, records: [{ name: 'www.networky.lab', type: 'A', address: '203.0.113.80' }, { name: 'mail.networky.lab', type: 'A', address: '203.0.113.80' }] },
    mail: { enabled: true, domain: 'networky.lab', accounts: [{ user: 'alice', password: 'a1' }, { user: 'bob', password: 'b2' }] },
    ftp: { enabled: true, accounts: [{ user: 'kavya', password: 'secret' }], files: [{ name: 'readme.txt', content: 'hello' }] },
  };
  b.t = setServices(b.t, 'SRV', services);
  for (const pc of ['PC0', 'PC1', 'EXT']) b.t = setDnsServer(b.t, pc, '203.0.113.80');
  return b;
}

const acl = (type: Acl['type'], ...lines: string[]): Acl => ({ type, rules: lines.map((l) => parseRule(l, type)) });
const account = (user: string, password: string): MailAccount => ({ name: user, address: `${user}@networky.lab`, smtpServer: 'mail.networky.lab', pop3Server: '203.0.113.80', user, password });

describe('DNS', () => {
  it('resolves a name through the DNS server across a router', () => {
    const sim = boot(lab().t);
    const r = resolve(sim, createDisk(), 'PC0', 'WWW.networky.lab');
    expect(r).toMatchObject({ ok: true, value: '203.0.113.80' });
    // the query really crossed the network as UDP to port 53
    expect(sim.log.some((e) => e.text.includes('DNS query: www.networky.lab?'))).toBe(true);
  });

  it('reports NXDOMAIN for an unknown name, and ICMP port unreachable when no DNS runs', () => {
    const b = lab();
    const sim = boot(b.t);
    expect(resolve(sim, createDisk(), 'PC0', 'nope.networky.lab')).toMatchObject({ ok: false, error: expect.stringContaining('NXDOMAIN') });
    b.t = setDnsServer(b.t, 'PC0', '203.0.113.50'); // EXT runs no DNS service
    const sim2 = boot(b.t);
    expect(resolve(sim2, createDisk(), 'PC0', 'www.networky.lab')).toMatchObject({ ok: false, error: expect.stringContaining('port unreachable') });
  });

  it('needs a DNS server, but not for plain IP addresses', () => {
    const b = lab();
    b.t = setDnsServer(b.t, 'PC0', undefined);
    const sim = boot(b.t);
    expect(resolve(sim, createDisk(), 'PC0', 'www.networky.lab').ok).toBe(false);
    expect(resolve(sim, createDisk(), 'PC0', '203.0.113.80')).toMatchObject({ ok: true, value: '203.0.113.80' });
  });
});

describe('Web browser (HTTP)', () => {
  it('fetches a page by name: DNS, then the TCP handshake, then GET', () => {
    const sim = boot(lab().t);
    const r = browse(sim, createDisk(), 'PC0', 'http://www.networky.lab/about.html');
    expect(r.ok && r.value).toMatchObject({ status: 200, title: 'About' });
    const texts = sim.log.map((e) => e.text).join('\n');
    const order = ['DNS query', 'SYN for port 80', 'HTTP GET /about.html', 'HTTP 200'].map((m) => texts.indexOf(m));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('answers 404 for a missing page and refuses when the web service is off', () => {
    const b = lab();
    const sim = boot(b.t);
    expect(browse(sim, createDisk(), 'PC0', '203.0.113.80/missing.html')).toMatchObject({ ok: true, value: { status: 404 } });
    const off = { ...b.t.devices.SRV.services!, http: { enabled: false, pages: [] } };
    b.t = setServices(b.t, 'SRV', off);
    const sim2 = boot(b.t);
    expect(browse(sim2, createDisk(), 'PC0', '203.0.113.80')).toMatchObject({ ok: false, error: expect.stringContaining('refused') });
  });

  it('an ACL that denies port 80 blocks the browser but not ping', () => {
    const b = lab();
    b.t = setAcl(b.t, 'R0', '101', acl('extended', 'deny tcp any host 203.0.113.80 eq 80', 'permit ip any any'));
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { aclIn: '101' });
    const sim = boot(b.t);
    expect(browse(sim, createDisk(), 'PC0', 'http://203.0.113.80/')).toMatchObject({ ok: false, error: expect.stringContaining('access list') });
    const ping = sim.ping('PC0', '203.0.113.80');
    sim.run(5000);
    expect(ping.status).toBe('success');
  });

  it('works through PAT: the server sees the router, the page still comes back', () => {
    const b = lab();
    b.t = setAcl(b.t, 'R0', '1', acl('standard', 'permit 192.168.1.0 0.0.0.255'));
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { nat: 'inside' });
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/1'), { nat: 'outside' });
    b.t = setNat(b.t, 'R0', { statics: [], overload: { acl: '1', outsideInterfaceId: b.port('R0', 'GigabitEthernet0/1') } });
    const sim = boot(b.t);
    const disk = createDisk();
    expect(browse(sim, disk, 'PC0', 'http://www.networky.lab/').ok).toBe(true);
    // a chat from behind NAT arrives from the router's outside address
    expect(sendChat(sim, disk, 'PC0', '203.0.113.50', 'hi').ok).toBe(true);
    expect(Object.keys(diskOf(disk, 'EXT').chats)).toEqual(['203.0.113.1']);
  });

  it('parses addresses and refuses what it cannot do', () => {
    expect(parseUrl('www.networky.lab')).toEqual({ host: 'www.networky.lab', path: '/' });
    expect(parseUrl('http://10.0.0.5:80/a.html')).toEqual({ host: '10.0.0.5', path: '/a.html' });
    expect(parseUrl('https://x.lab')).toMatch(/TLS/);
    expect(parseUrl('ftp://x.lab')).toMatch(/only speaks http/);
    expect(parseUrl('http://x.lab:8080/')).toMatch(/port 80/);
    expect(parseUrl('javascript:alert(1)')).toMatch(/not a valid/);
    expect(parseUrl('http://x.lab/../etc/passwd')).toMatch(/not a page path/);
  });
});

describe('Email (SMTP + POP3)', () => {
  it('alice sends, bob fetches with POP3, and the server mailbox is emptied', () => {
    const sim = boot(lab().t);
    const disk = createDisk();
    const sent = sendMail(sim, disk, 'PC0', account('alice', 'a1'), 'bob@networky.lab', 'Lab', 'Ping me');
    expect(sent.ok).toBe(true);
    expect(diskOf(disk, 'SRV').mailboxes.bob).toHaveLength(1);
    const got = fetchMail(sim, disk, 'PC1', account('bob', 'b2'));
    expect(got.ok && got.value.map((m) => m.subject)).toEqual(['Lab']);
    expect(diskOf(disk, 'PC1').inbox).toHaveLength(1);
    expect(diskOf(disk, 'SRV').mailboxes.bob).toHaveLength(0);
  });

  it('refuses unknown users, other domains and wrong passwords', () => {
    const sim = boot(lab().t);
    const disk = createDisk();
    expect(sendMail(sim, disk, 'PC0', account('alice', 'a1'), 'carol@networky.lab', 's', 'b')).toMatchObject({ ok: false, error: expect.stringContaining('no such user') });
    expect(sendMail(sim, disk, 'PC0', account('alice', 'a1'), 'bob@gmail.com', 's', 'b')).toMatchObject({ ok: false, error: expect.stringContaining('relaying denied') });
    expect(fetchMail(sim, disk, 'PC1', account('bob', 'wrong'))).toMatchObject({ ok: false, error: expect.stringContaining('-ERR') });
  });

  it('keeps mailboxes when the network restarts (they live on the disk, not in the simulation)', () => {
    const b = lab();
    const disk = createDisk();
    sendMail(boot(b.t), disk, 'PC0', account('alice', 'a1'), 'bob@networky.lab', 'Hi', 'x');
    const fresh = boot(b.t);
    expect(fetchMail(fresh, disk, 'PC1', account('bob', 'b2'))).toMatchObject({ ok: true, value: [expect.objectContaining({ subject: 'Hi' })] });
  });
});

describe('FTP', () => {
  it('logs in, lists, uploads, downloads and deletes', () => {
    const sim = boot(lab().t);
    const disk = createDisk();
    const run = (command: Parameters<typeof ftp>[6]) => ftp(sim, disk, 'PC0', '203.0.113.80', 'kavya', 'secret', command);
    expect(run({ cmd: 'list' })).toMatchObject({ ok: true, value: { files: [{ name: 'readme.txt', size: 5 }] } });
    expect(run({ cmd: 'put', name: 'notes.txt', content: 'subnetting' }).ok).toBe(true);
    expect(run({ cmd: 'get', name: 'notes.txt' })).toMatchObject({ ok: true, value: { content: 'subnetting' } });
    expect(run({ cmd: 'delete', name: 'readme.txt' }).ok).toBe(true);
    expect(run({ cmd: 'get', name: 'readme.txt' })).toMatchObject({ ok: false, error: expect.stringContaining('550') });
    // the configured files are untouched: uploads change the disk, not the project
    expect(sim.topology.devices.SRV.services?.ftp?.files.map((f) => f.name)).toEqual(['readme.txt']);
  });

  it('refuses a wrong password and path tricks in file names', () => {
    const sim = boot(lab().t);
    const disk = createDisk();
    expect(ftp(sim, disk, 'PC0', '203.0.113.80', 'kavya', 'nope', { cmd: 'list' })).toMatchObject({ ok: false, error: expect.stringContaining('530') });
    expect(ftp(sim, disk, 'PC0', '203.0.113.80', 'kavya', 'secret', { cmd: 'put', name: '../x', content: '' })).toMatchObject({ ok: false, error: expect.stringContaining('501') });
    expect(ftp(sim, disk, 'PC0', '203.0.113.80', 'kavya', 'secret', { cmd: 'put', name: '__proto__', content: '' }).ok).toBe(true); // just a file name in a list, harmless
  });
});

describe('Messaging', () => {
  it('delivers a message and both sides keep the conversation', () => {
    const sim = boot(lab().t);
    const disk = createDisk();
    expect(sendChat(sim, disk, 'PC0', '192.168.1.11', 'hello PC1').ok).toBe(true);
    expect(diskOf(disk, 'PC0').chats['192.168.1.11']).toMatchObject([{ from: 'me', text: 'hello PC1' }]);
    expect(diskOf(disk, 'PC1').chats['192.168.1.10']).toMatchObject([{ from: 'them', name: 'PC0', text: 'hello PC1' }]);
  });

  it('a router does not run the messenger', () => {
    const sim = boot(lab().t);
    expect(sendChat(sim, createDisk(), 'PC0', '192.168.1.1', 'hi')).toMatchObject({ ok: false, error: expect.stringContaining('refused') });
  });
});
