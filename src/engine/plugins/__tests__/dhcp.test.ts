import { describe, expect, it } from 'vitest';
import { setDefaultGateway, setDhcpPools, setInterfaceOptions } from '../../../model/ops';
import { Builder } from '../../../model/testing';
import { boot, pingAndRun } from '../../testing';
import { bindingsOf, leasesOf } from '../dhcp';

/** PC0, PC1 (DHCP clients) -- S0 -- R0 Gi0/0 192.168.1.1 running pool LAN. */
function dhcpLan() {
  const b = new Builder();
  b.add('router', 'R0');
  b.add('switch', 'S0');
  b.add('pc', 'PC0');
  b.add('pc', 'PC1');
  b.link(['PC0', 'FastEthernet0'], ['S0', 'FastEthernet0/1']);
  b.link(['PC1', 'FastEthernet0'], ['S0', 'FastEthernet0/2']);
  b.link(['S0', 'GigabitEthernet0/1'], ['R0', 'GigabitEthernet0/0']);
  b.ip('R0', 'GigabitEthernet0/0', '192.168.1.1/24');
  b.t = setDhcpPools(b.t, 'R0', [{ name: 'LAN', network: '192.168.1.0', prefixLength: 24, defaultRouter: '192.168.1.1', dnsServer: '8.8.8.8', excluded: ['192.168.1.2'] }]);
  for (const pc of ['PC0', 'PC1']) b.t = setInterfaceOptions(b.t, b.port(pc, 'FastEthernet0'), { dhcp: true });
  return b;
}

describe('DHCP', () => {
  it('runs DORA and hands out distinct addresses, skipping the router and excluded ones', () => {
    const b = dhcpLan();
    const sim = boot(b.t);
    const l0 = leasesOf(sim)[b.port('PC0', 'FastEthernet0')];
    const l1 = leasesOf(sim)[b.port('PC1', 'FastEthernet0')];
    expect(l0 && l1).toBeTruthy();
    expect(l0.ip).not.toBe(l1.ip);
    for (const l of [l0, l1]) {
      expect(l.ip).not.toMatch(/^192\.168\.1\.(1|2)$/);
      expect(l.router).toBe('192.168.1.1');
      expect(l.dns).toBe('8.8.8.8');
      expect(l.prefixLength).toBe(24);
    }
    expect(bindingsOf(sim, 'R0').filter((x) => x.state === 'bound')).toHaveLength(2);
    // all four DORA messages appear in order for one client
    const texts = sim.log.map((e) => e.text).join('\n');
    const order = ['DISCOVER', 'OFFER', 'REQUEST', 'ACK'].map((m) => texts.indexOf(m));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, c) => a - c)).toEqual(order);
  });

  it('a leased host can ping its gateway', () => {
    const sim = boot(dhcpLan().t);
    expect(pingAndRun(sim, 'PC0', '192.168.1.1').status).toBe('success');
  });

  it('without a server the client stays without an address', () => {
    const b = dhcpLan();
    b.t = setDhcpPools(b.t, 'R0', []);
    const sim = boot(b.t);
    expect(leasesOf(sim)[b.port('PC0', 'FastEthernet0')]).toBeUndefined();
    expect(pingAndRun(sim, 'PC0', '192.168.1.1').status).toBe('unreachable');
  });

  it('a full pool stops handing out leases', () => {
    const b = dhcpLan();
    // a /30 has two hosts: .1 (the router) and .2 (excluded) — nothing is left
    b.t = setDhcpPools(b.t, 'R0', [{ name: 'TINY', network: '192.168.1.0', prefixLength: 30, excluded: ['192.168.1.2'] }]);
    const sim = boot(b.t);
    expect(Object.keys(leasesOf(sim))).toHaveLength(0);
  });
});

/**
 * Relay:  PC0 (DHCP) -- S0 -- R0 Gi0/0 10.1.0.1 (helper 10.2.0.10)   R0 Gi0/1 10.2.0.1 -- S1 -- SRV 10.2.0.10
 * The server is on a different subnet; the router turns the broadcast into a unicast.
 */
function relay() {
  const b = new Builder();
  for (const [k, n] of [['pc', 'PC0'], ['switch', 'S0'], ['router', 'R0'], ['switch', 'S1'], ['server', 'SRV']] as const) b.add(k, n);
  b.link(['PC0', 'FastEthernet0'], ['S0', 'FastEthernet0/1']);
  b.link(['S0', 'GigabitEthernet0/1'], ['R0', 'GigabitEthernet0/0']);
  b.link(['R0', 'GigabitEthernet0/1'], ['S1', 'GigabitEthernet0/1']);
  b.link(['S1', 'FastEthernet0/1'], ['SRV', 'GigabitEthernet0']);
  b.ip('R0', 'GigabitEthernet0/0', '10.1.0.1/24');
  b.ip('R0', 'GigabitEthernet0/1', '10.2.0.1/24');
  b.ip('SRV', 'GigabitEthernet0', '10.2.0.10/24');
  b.t = setDefaultGateway(b.t, 'SRV', '10.2.0.1');
  b.t = setDhcpPools(b.t, 'SRV', [{ name: 'REMOTE', network: '10.1.0.0', prefixLength: 24, defaultRouter: '10.1.0.1' }]);
  b.t = setInterfaceOptions(b.t, b.port('PC0', 'FastEthernet0'), { dhcp: true });
  return b;
}

describe('DHCP relay (ip helper-address)', () => {
  it('without a helper the broadcast stops at the router', () => {
    const b = relay();
    const sim = boot(b.t);
    expect(leasesOf(sim)[b.port('PC0', 'FastEthernet0')]).toBeUndefined();
  });

  it('with a helper the client gets an address from the remote pool and can reach the server', () => {
    const b = relay();
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { helperAddress: '10.2.0.10' });
    const sim = boot(b.t);
    const lease = leasesOf(sim)[b.port('PC0', 'FastEthernet0')];
    expect(lease?.ip).toMatch(/^10\.1\.0\./);
    expect(lease?.server).toBe('10.2.0.10');
    expect(pingAndRun(sim, 'PC0', '10.2.0.10').status).toBe('success');
  });
});
