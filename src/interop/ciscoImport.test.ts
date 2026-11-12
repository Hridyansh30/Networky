import { describe, expect, it } from 'vitest';
import { runningConfig } from '../cli/runningConfig';
import { EXAMPLES } from '../model/examples';
import { resetNetworkConfig } from '../model/ops';
import type { Topology } from '../model/types';
import { ciscoExporter, deviceConfig } from './ciscoExport';
import { importCiscoConfig, IMPORT_LIMITS } from './ciscoImport';

const network = (t: Topology) => Object.values(t.devices).filter((d) => d.kind === 'router' || d.kind === 'switch');
const byName = (t: Topology, name: string) => Object.values(t.devices).find((d) => d.hostname === name)!;
const merge = { mode: 'merge' as const };

describe('round trip: export, wipe, import gives the same configuration', () => {
  for (const lab of EXAMPLES) {
    it(lab.name, () => {
      const { topology, layout } = lab.build();
      let wiped = topology;
      for (const d of network(topology)) wiped = resetNetworkConfig(wiped, d.id);

      const text = ciscoExporter.export({ topology, layout, name: lab.id }).text;
      const r = importCiscoConfig(wiped, layout, text, merge);

      expect(r.notes.filter((n) => n.level === 'error')).toEqual([]);
      expect(Object.keys(r.topology.devices).length).toBe(Object.keys(topology.devices).length); // nothing created
      for (const d of network(topology)) expect(runningConfig(r.topology, d.id)).toEqual(runningConfig(topology, d.id));
    });
  }
});

describe('importing a real "show running-config" paste', () => {
  const paste = `Building configuration...

Current configuration : 1024 bytes
!
version 15.4
service timestamps debug datetime msec
no service password-encryption
!
hostname Edge
!
boot-start-marker
boot-end-marker
!
enable secret 5 $1$abcd$abcdefghijklmnopqrstu.
username admin privilege 15 secret 5 $1$xyz
!
banner motd ^C
Authorised access only
^C
no ip domain lookup
ip dhcp excluded-address 192.168.10.1 192.168.10.9
!
ip dhcp pool LAN
 network 192.168.10.0 255.255.255.0
 default-router 192.168.10.1
!
interface GigabitEthernet0/0
 description LAN side
 ip address 192.168.10.1 255.255.255.0
 ip access-group 101 in
 duplex auto
 speed auto
!
interface GigabitEthernet0/3
 ip address 10.9.9.1 255.255.255.0
!
interface Serial0/0/0
 ip address 10.0.0.1 255.255.255.252
 clock rate 64000
!
router ospf 1
 network 192.168.10.0 0.0.0.255 area 0
 do ping 10.0.0.2
!
access-list 101 permit tcp 192.168.10.0 0.0.0.255 any eq 80
access-list 101 deny ip any any
ip route 0.0.0.0 0.0.0.0 10.0.0.2
!
line con 0
 password cisco
 login
line vty 0 4
 transport input ssh
!
end
`;
  const empty = EXAMPLES[0].build();
  const r = importCiscoConfig(empty.topology, empty.layout, paste, merge);
  const edge = byName(r.topology, 'Edge');
  const iface = (name: string) => edge.interfaceIds.map((id) => r.topology.interfaces[id]).find((i) => i.name === name)!;

  it('creates a router, placed on the canvas, and says cables are needed', () => {
    expect(edge.kind).toBe('router');
    expect(r.layout[edge.id]).toBeDefined();
    expect(r.devices).toEqual(['Edge']);
    expect(r.notes.some((n) => n.level === 'info' && /cabl/.test(n.text))).toBe(true);
  });

  it('applies what the simulator models, including a forward reference', () => {
    expect(iface('GigabitEthernet0/0').ipv4).toEqual({ address: '192.168.10.1', prefixLength: 24 });
    expect(iface('GigabitEthernet0/0').aclIn).toBe('101');
    expect(iface('Serial0/0/0').ipv4?.prefixLength).toBe(30);
    expect(edge.dhcpPools?.[0].excluded).toContain('192.168.10.5'); // excluded-address came before its pool
    expect(edge.acls?.['101'].rules).toHaveLength(2);
    expect(edge.ospf?.networks).toHaveLength(1);
    expect(edge.staticRoutes).toEqual([{ prefix: '0.0.0.0', prefixLength: 0, nextHop: '10.0.0.2' }]);
  });

  it('never imports credentials', () => {
    const secrets = r.notes.filter((n) => /credentials are never imported/.test(n.text)).map((n) => n.line);
    expect(secrets).toEqual(expect.arrayContaining([14, 15]));
    expect(JSON.stringify(r.topology)).not.toMatch(/\$1\$|"cisco"|privilege/);
  });

  it('never runs exec commands such as ping', () => {
    expect(r.notes.find((n) => n.text.startsWith('do ping'))?.level).toBe('skipped');
  });

  it('reports a missing interface once, with its line number, and skips the lines under it', () => {
    const errors = r.notes.filter((n) => n.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(paste.split('\n').indexOf('interface GigabitEthernet0/3') + 1);
    expect(r.notes.some((n) => n.level === 'skipped' && /1 indented line under it skipped/.test(n.text))).toBe(true);
  });

  it('skips banners, line and service settings with a note instead of an error', () => {
    for (const s of ['banner', 'line con 0', 'clock rate 64000', 'description LAN side'])
      expect(r.notes.find((n) => n.text.startsWith(s))?.level).toBe('skipped');
    // 'version' and 'service' come before 'hostname', in the preamble
    expect(r.notes.some((n) => n.level === 'skipped' && /before the first "hostname"/.test(n.text))).toBe(true);
    expect(JSON.stringify(r.topology)).not.toContain('Authorised');
  });
});

describe('import safety and modes', () => {
  const base = EXAMPLES.find((e) => e.id === 'office-edge-nat-acl')!.build();
  const r1 = byName(base.topology, 'R1');

  it('merge keeps existing settings; replace resets the device first', () => {
    const text = 'hostname R1\nip route 10.99.0.0 255.255.0.0 192.168.1.10\n';
    const merged = importCiscoConfig(base.topology, base.layout, text, merge);
    expect(byName(merged.topology, 'R1').acls).toEqual(r1.acls);
    expect(byName(merged.topology, 'R1').staticRoutes).toContainEqual({ prefix: '10.99.0.0', prefixLength: 16, nextHop: '192.168.1.10' });
    const replaced = importCiscoConfig(base.topology, base.layout, text, { mode: 'replace' });
    const after = byName(replaced.topology, 'R1');
    expect(after.acls).toBeUndefined();
    expect(after.staticRoutes).toEqual([{ prefix: '10.99.0.0', prefixLength: 16, nextHop: '10.99.0.0'.replace('10.99.0.0', '192.168.1.10') }]);
    expect(Object.keys(replaced.topology.links)).toEqual(Object.keys(base.topology.links)); // cables stay
  });

  it('does not touch the input topology (one undo step for the caller)', () => {
    const before = JSON.stringify(base.topology);
    importCiscoConfig(base.topology, base.layout, 'hostname R1\ninterface GigabitEthernet0/0\n shutdown\n', merge);
    expect(JSON.stringify(base.topology)).toBe(before);
  });

  it('refuses a PC hostname, duplicates, missing hostname, control characters and oversized input', () => {
    const pc = Object.values(base.topology.devices).find((d) => d.kind === 'pc')!.hostname;
    expect(importCiscoConfig(base.topology, base.layout, `hostname ${pc}\n`, merge).notes[0].text).toMatch(/only routers and switches/);
    expect(importCiscoConfig(base.topology, base.layout, 'hostname R9\nhostname r9\n', merge).notes.some((n) => /appears twice/.test(n.text))).toBe(true);
    expect(importCiscoConfig(base.topology, base.layout, 'interface g0/0\n', merge).notes[0].text).toMatch(/No "hostname"/);
    expect(importCiscoConfig(base.topology, base.layout, 'hostname R1\n\u001b[31m\n', merge).notes[0].text).toMatch(/control characters/);
    expect(importCiscoConfig(base.topology, base.layout, 'x'.repeat(IMPORT_LIMITS.bytes + 1), merge).notes[0].level).toBe('error');
    const many = Array.from({ length: IMPORT_LIMITS.devices + 1 }, (_, k) => `hostname D${k}`).join('\n');
    expect(importCiscoConfig(base.topology, base.layout, many, merge).notes[0].text).toMatch(/limit/);
  });

  it('syslog lines such as %LINK-5-CHANGED after "no shutdown" are not errors', () => {
    const r = importCiscoConfig(base.topology, base.layout, 'hostname R7\ninterface GigabitEthernet0/0\n shutdown\n no shutdown\n', merge);
    expect(r.notes.filter((n) => n.level === 'error')).toEqual([]);
  });

  it('guesses a switch from switchport lines', () => {
    const r = importCiscoConfig(base.topology, base.layout, 'hostname SW9\ninterface FastEthernet0/1\n switchport access vlan 20\n switchport mode access\n', merge);
    expect(byName(r.topology, 'SW9').kind).toBe('switch');
    expect(r.notes.filter((n) => n.level === 'error')).toEqual([]);
  });

  it('one device block from the export imports on its own', () => {
    const text = deviceConfig(base.topology, r1.id).join('\n');
    const r = importCiscoConfig(resetNetworkConfig(base.topology, r1.id), base.layout, text, merge);
    expect(runningConfig(r.topology, r1.id)).toEqual(runningConfig(base.topology, r1.id));
  });
});
