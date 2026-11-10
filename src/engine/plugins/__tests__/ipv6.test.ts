import { describe, expect, it } from 'vitest';
import { linkLocalFromMac, slaacAddress } from '../../../model/ip6';
import { addIpv6StaticRoute, setDefaultGatewayV6, setInterfaceOptions } from '../../../model/ops';
import { Builder } from '../../../model/testing';
import { boot, pingAndRun } from '../../testing';
import { traceroute } from '../../traceroute';
import { isArp } from '../../packets';
import { Simulation } from '../../simulation';
import { DEFAULT_PLUGINS } from '..';
import { isIpv6, neighborsOf, slaacOf } from '../ipv6';

const v6 = (b: Builder, dev: string, port: string, cidr: string) => {
  const [address, len] = cidr.split('/');
  b.t = setInterfaceOptions(b.t, b.port(dev, port), { ipv6: { address, prefixLength: Number(len) } });
};

/** PC0 2001:db8:1::10 ─ S0 ─ PC1 2001:db8:1::11 (static addresses, no router) */
function lan() {
  const b = new Builder();
  b.add('switch', 'S0');
  b.add('pc', 'PC0');
  b.add('pc', 'PC1');
  b.link(['PC0', 'FastEthernet0'], ['S0', 'FastEthernet0/1']);
  b.link(['PC1', 'FastEthernet0'], ['S0', 'FastEthernet0/2']);
  v6(b, 'PC0', 'FastEthernet0', '2001:db8:1::10/64');
  v6(b, 'PC1', 'FastEthernet0', '2001:db8:1::11/64');
  return b;
}

/** PC0 (SLAAC) ─ S0 ─ R0 2001:db8:1::1 | 2001:db8:2::1 ─ S1 ─ PC1 2001:db8:2::10 */
function routed() {
  const b = new Builder();
  for (const [k, n] of [['pc', 'PC0'], ['switch', 'S0'], ['router', 'R0'], ['switch', 'S1'], ['pc', 'PC1']] as const) b.add(k, n);
  b.link(['PC0', 'FastEthernet0'], ['S0', 'FastEthernet0/1']);
  b.link(['S0', 'GigabitEthernet0/1'], ['R0', 'GigabitEthernet0/0']);
  b.link(['R0', 'GigabitEthernet0/1'], ['S1', 'GigabitEthernet0/1']);
  b.link(['S1', 'FastEthernet0/1'], ['PC1', 'FastEthernet0']);
  v6(b, 'R0', 'GigabitEthernet0/0', '2001:db8:1::1/64');
  v6(b, 'R0', 'GigabitEthernet0/1', '2001:db8:2::1/64');
  b.t = setInterfaceOptions(b.t, b.port('PC0', 'FastEthernet0'), { ipv6Auto: true });
  v6(b, 'PC1', 'FastEthernet0', '2001:db8:2::10/64');
  b.t = setDefaultGatewayV6(b.t, 'PC1', '2001:db8:2::1');
  return b;
}

describe('IPv6 on one link', () => {
  it('uses NDP (multicast) instead of ARP (broadcast)', () => {
    const sim = new Simulation(lan().t, DEFAULT_PLUGINS).boot().run();
    const p = sim.ping('PC0', '2001:db8:1::11');
    const kinds: string[] = [];
    let sawArp = false;
    while (!sim.isIdle()) {
      for (const tx of sim.step()) {
        if (isArp(tx.frame.payload)) sawArp = true;
        if (isIpv6(tx.frame.payload)) kinds.push(tx.frame.payload.l4.type);
        if (isIpv6(tx.frame.payload) && tx.frame.payload.l4.type === 'ns') expect(tx.frame.dstMac.startsWith('33:33:ff')).toBe(true);
      }
    }
    expect(p.status).toBe('success');
    expect(sawArp).toBe(false);
    expect(kinds.indexOf('ns')).toBeLessThan(kinds.indexOf('na'));
    expect(kinds).toContain('echo-reply');
    expect(neighborsOf(sim, 'PC0')['2001:db8:1::11']).toBeTruthy();
  });

  it('link-local addresses work with no global address configured', () => {
    const b = lan();
    const mac1 = b.t.interfaces[b.port('PC1', 'FastEthernet0')].mac;
    expect(pingAndRun(boot(b.t), 'PC0', linkLocalFromMac(mac1)).status).toBe('success');
  });

  it('accepts any spelling of an address (fully expanded form)', () => {
    expect(pingAndRun(boot(lan().t), 'PC0', '2001:0db8:0001:0000:0000:0000:0000:0011').status).toBe('success');
  });

  it('a missing neighbour times out as unreachable', () => {
    expect(pingAndRun(boot(lan().t), 'PC0', '2001:db8:1::99').status).toBe('unreachable');
  });

  it('IPv4 and IPv6 run side by side (dual stack)', () => {
    const b = lan();
    b.ip('PC0', 'FastEthernet0', '192.168.1.10/24');
    b.ip('PC1', 'FastEthernet0', '192.168.1.11/24');
    const sim = boot(b.t);
    expect(pingAndRun(sim, 'PC0', '192.168.1.11').status).toBe('success');
    expect(pingAndRun(sim, 'PC0', '2001:db8:1::11').status).toBe('success');
  });
});

describe('SLAAC and IPv6 routing', () => {
  it('a SLAAC host builds prefix + EUI-64 and learns the router as gateway', () => {
    const b = routed();
    const sim = boot(b.t);
    const iface = b.t.interfaces[b.port('PC0', 'FastEthernet0')];
    const s = slaacOf(sim, iface.id);
    expect(s?.address).toBe(slaacAddress('2001:db8:1::', iface.mac));
    expect(s?.router).toBe(linkLocalFromMac(b.t.interfaces[b.port('R0', 'GigabitEthernet0/0')].mac));
  });

  it('routes between two IPv6 LANs; hop limit and traceroute work', () => {
    const sim = boot(routed().t);
    expect(pingAndRun(sim, 'PC0', '2001:db8:2::10').status).toBe('success');
    const hops = traceroute(sim, 'PC0', '2001:db8:2::10');
    expect(hops.map((h) => h.address)).toEqual(['2001:db8:1::1', '2001:db8:2::10']);
  });

  it('no route: the router answers destination unreachable', () => {
    const p = pingAndRun(boot(routed().t), 'PC0', '2001:db8:9::1');
    expect(p.status).toBe('unreachable');
    expect(p.detail).toMatch(/2001:db8:1::1/);
  });

  it('IPv6 static routes across two routers', () => {
    const b = routed();
    // move PC1's LAN behind a second router: R0 Gi0/1 ─ R1 ─ PC2
    b.add('router', 'R1');
    b.add('pc', 'PC2');
    b.link(['S1', 'FastEthernet0/2'], ['R1', 'GigabitEthernet0/0']);
    b.link(['R1', 'GigabitEthernet0/1'], ['PC2', 'FastEthernet0'], 'copper-cross');
    v6(b, 'R1', 'GigabitEthernet0/0', '2001:db8:2::2/64');
    v6(b, 'R1', 'GigabitEthernet0/1', '2001:db8:3::1/64');
    v6(b, 'PC2', 'FastEthernet0', '2001:db8:3::10/64');
    b.t = setDefaultGatewayV6(b.t, 'PC2', '2001:db8:3::1');
    expect(pingAndRun(boot(b.t), 'PC0', '2001:db8:3::10').status).toBe('unreachable');
    b.t = addIpv6StaticRoute(b.t, 'R0', { prefix: '2001:db8:3::', prefixLength: 64, nextHop: '2001:db8:2::2' });
    b.t = addIpv6StaticRoute(b.t, 'R1', { prefix: '2001:db8:1::', prefixLength: 64, nextHop: '2001:db8:2::1' });
    expect(pingAndRun(boot(b.t), 'PC0', '2001:db8:3::10').status).toBe('success');
  });
});
