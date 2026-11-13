// Every check kind on a network where it passes and one where it fails.
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../engine/simulation';
import { DEFAULT_PLUGINS } from '../../engine/plugins';
import { exampleById } from '../../model/examples';
import { setStpPriority } from '../../model/ops';
import { defaultServerServices, setServices } from '../../model/services';
import { smallLan } from '../../model/testing';
import type { Topology } from '../../model/types';
import { registry } from '../checks';
import { createContext } from '../context';
import { lanNoGateway, lanSolved } from './fixtures';

const checks = registry();
function run(t: Topology, kind: string, params: unknown) {
  const check = checks.get(kind)!;
  const sim = new Simulation(structuredClone(t), DEFAULT_PLUGINS).boot().run(5000);
  return check.run(createContext(sim), check.schema.parse(params));
}
const lab = (id: string) => exampleById(id)!.build().topology;

describe('reach', () => {
  it('passes when the ping ends as expected', () => {
    expect(run(lanSolved(), 'reach', { from: 'PC1', to: '192.168.1.1' }).pass).toBe(true);
  });
  it('fails with a reason and names where it died', () => {
    const r = run(lanNoGateway(), 'reach', { from: 'PC1', to: '10.9.9.9' });
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/should succeed/);
  });
  it('can require a failure', () => {
    expect(run(lanNoGateway(), 'reach', { from: 'PC1', to: '10.9.9.9', expect: 'unreachable' }).pass).toBe(true);
  });
  it('fails cleanly on an unknown device', () => {
    expect(run(lanSolved(), 'reach', { from: 'Nope', to: '192.168.1.1' })).toEqual({ pass: false, detail: 'There is no device named Nope.' });
  });
  it('matches hostnames without caring about case', () => {
    expect(run(lanSolved(), 'reach', { from: 'pc1', to: '192.168.1.1' }).pass).toBe(true);
  });
});

describe('tcp', () => {
  const t = lab('office-edge-nat-acl');
  it('web is allowed through ACL 110', () => {
    expect(run(t, 'tcp', { from: 'PC1', to: '203.0.113.80', port: 80 }).pass).toBe(true);
  });
  it('SSH is blocked, and the drop is located', () => {
    const r = run(t, 'tcp', { from: 'PC1', to: '203.0.113.80', port: 22 });
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/blocked by an ACL/);
    expect(r.dropAt?.device).toBe('R1');
    expect(run(t, 'tcp', { from: 'PC1', to: '203.0.113.80', port: 22, expect: 'prohibited' }).pass).toBe(true);
  });
});

describe('http', () => {
  const withServer = () => {
    const b = smallLan();
    b.add('server', 'SRV');
    b.link(['SRV', 'GigabitEthernet0'], ['Switch0', 'FastEthernet0/2']);
    b.ip('SRV', 'GigabitEthernet0', '192.168.1.20/24');
    b.t = setServices(b.t, 'SRV', defaultServerServices(b.t.devices.SRV));
    return b.t;
  };
  it('loads a page and checks it is the right one', () => {
    expect(run(withServer(), 'http', { from: 'PC0', url: 'http://192.168.1.20/', contains: 'Welcome to SRV' }).pass).toBe(true);
    const wrong = run(withServer(), 'http', { from: 'PC0', url: 'http://192.168.1.20/', contains: 'Welcome to WEB' });
    expect(wrong.pass).toBe(false);
    expect(wrong.detail).toMatch(/not the expected page/);
  });
  it('fails when nothing serves the address, or passes if failure is required', () => {
    expect(run(withServer(), 'http', { from: 'PC0', url: 'http://192.168.1.99/' }).pass).toBe(false);
    expect(run(withServer(), 'http', { from: 'PC0', url: 'http://192.168.1.99/', expect: 'fails' }).pass).toBe(true);
  });
});

describe('dhcpLease', () => {
  const t = lab('dhcp-relay');
  it('sees leases from a local pool and through a relay', () => {
    expect(run(t, 'dhcpLease', { host: 'PC1', subnet: '192.168.1.0/24' }).pass).toBe(true);
    expect(run(t, 'dhcpLease', { host: 'PC2', subnet: '192.168.2.0/24' }).pass).toBe(true);
  });
  it('fails for the wrong subnet and for a static host', () => {
    expect(run(t, 'dhcpLease', { host: 'PC1', subnet: '10.0.0.0/24' }).detail).toMatch(/outside 10.0.0.0\/24/);
    expect(run(lanSolved(), 'dhcpLease', { host: 'PC1', subnet: '192.168.1.0/24' }).detail).toMatch(/not set to get its address from DHCP/);
  });
});

describe('route', () => {
  const t = lab('rip-three-routers');
  it('finds a RIP route, and rejects the wrong source', () => {
    expect(run(t, 'route', { device: 'R1', prefix: '10.3.0.0/24', source: 'rip' }).pass).toBe(true);
    expect(run(t, 'route', { device: 'R1', prefix: '10.3.0.0/24', source: 'ospf' }).pass).toBe(false);
    expect(run(t, 'route', { device: 'R1', prefix: '172.16.0.0/16' }).detail).toMatch(/no route/);
  });
});

describe('stpRoot', () => {
  const t = lab('stp-redundant-switches');
  it('knows who won the election', () => {
    expect(run(t, 'stpRoot', { switch: 'S1' }).pass).toBe(true);
    const r = run(t, 'stpRoot', { switch: 'S2' });
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/Lower priority wins/);
  });
  it('follows a priority change', () => {
    const changed = setStpPriority(t, Object.values(t.devices).find((d) => d.hostname === 'S2')!.id, 0);
    expect(run(changed, 'stpRoot', { switch: 'S2' }).pass).toBe(true);
  });
});

describe('interfaceIp and accessVlan (configuration checks)', () => {
  it('compares the exact setting', () => {
    expect(run(lanSolved(), 'interfaceIp', { device: 'PC1', port: 'FastEthernet0', address: '192.168.1.11/24' }).pass).toBe(true);
    expect(run(lanSolved(), 'interfaceIp', { device: 'PC1', port: 'FastEthernet0', address: '192.168.1.12/24' }).pass).toBe(false);
  });
  it('reads switchport VLANs', () => {
    const t = lab('vlans-router-on-a-stick');
    expect(run(t, 'accessVlan', { switch: 'S1', port: 'FastEthernet0/3', vlan: 20 }).pass).toBe(true);
    expect(run(t, 'accessVlan', { switch: 'S1', port: 'FastEthernet0/3', vlan: 10 }).pass).toBe(false);
    expect(run(t, 'accessVlan', { switch: 'S1', port: 'GigabitEthernet0/1', vlan: 1 }).detail).toMatch(/trunk/);
  });
});

describe('check params are strict', () => {
  it('rejects unknown keys and bad addresses', () => {
    expect(checks.get('reach')!.schema.safeParse({ from: 'PC0', to: '1.2.3.4', extra: 1 }).success).toBe(false);
    expect(checks.get('reach')!.schema.safeParse({ from: 'PC0', to: '1.2.3' }).success).toBe(false);
    expect(checks.get('route')!.schema.safeParse({ device: 'R1', prefix: '10.0.0.0/33' }).success).toBe(false);
  });
});
