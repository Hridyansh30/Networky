import { describe, expect, it } from 'vitest';
import { addStaticRoute, setDefaultGateway, setInterfaceAdmin } from '../model/ops';
import { Builder } from '../model/testing';
import { BROADCAST_MAC } from './packets';
import { routingTable } from './routing';
import { Simulation } from './simulation';
import { traceroute } from './traceroute';

/** PC0, PC1 -- Switch0 */
function lan() {
  const b = new Builder();
  b.add('pc', 'PC0');
  b.add('pc', 'PC1');
  b.add('switch', 'S0');
  b.link(['PC0', 'FastEthernet0'], ['S0', 'FastEthernet0/1']);
  b.link(['PC1', 'FastEthernet0'], ['S0', 'FastEthernet0/2']);
  b.ip('PC0', 'FastEthernet0', '192.168.1.10/24');
  b.ip('PC1', 'FastEthernet0', '192.168.1.11/24');
  return b;
}

/**
 * PC0 (10.1.0.10) -- S1 -- R1 ==serial== R2 -- S2 -- PC1 (10.2.0.10)
 *                    10.1.0.1  10.0.0.1/30 10.0.0.2  10.2.0.1
 */
function twoRouters() {
  const b = new Builder();
  for (const [k, n] of [['pc', 'PC0'], ['switch', 'S1'], ['router', 'R1'], ['router', 'R2'], ['switch', 'S2'], ['pc', 'PC1']] as const) b.add(k, n);
  b.link(['PC0', 'FastEthernet0'], ['S1', 'FastEthernet0/1']);
  b.link(['S1', 'GigabitEthernet0/1'], ['R1', 'GigabitEthernet0/0']);
  b.link(['R1', 'Serial0/0/0'], ['R2', 'Serial0/0/0'], 'serial');
  b.link(['R2', 'GigabitEthernet0/0'], ['S2', 'GigabitEthernet0/1']);
  b.link(['S2', 'FastEthernet0/1'], ['PC1', 'FastEthernet0']);
  b.ip('PC0', 'FastEthernet0', '10.1.0.10/24');
  b.ip('R1', 'GigabitEthernet0/0', '10.1.0.1/24');
  b.ip('R1', 'Serial0/0/0', '10.0.0.1/30');
  b.ip('R2', 'Serial0/0/0', '10.0.0.2/30');
  b.ip('R2', 'GigabitEthernet0/0', '10.2.0.1/24');
  b.ip('PC1', 'FastEthernet0', '10.2.0.10/24');
  b.t = setDefaultGateway(b.t, 'PC0', '10.1.0.1');
  b.t = setDefaultGateway(b.t, 'PC1', '10.2.0.1');
  b.t = addStaticRoute(b.t, 'R1', { prefix: '10.2.0.0', prefixLength: 24, nextHop: '10.0.0.2' });
  b.t = addStaticRoute(b.t, 'R2', { prefix: '10.1.0.0', prefixLength: 24, nextHop: '10.0.0.1' });
  return b;
}

describe('same LAN through a switch', () => {
  it('ARPs first, then pings, and both sides learn', () => {
    const b = lan();
    const sim = new Simulation(b.t);
    const ping = sim.ping('PC0', '192.168.1.11');

    // Tick 0: the very first thing on the wire is a broadcast ARP request.
    expect(sim.inFlight).toHaveLength(1);
    expect(sim.inFlight[0].frame.dstMac).toBe(BROADCAST_MAC);
    expect(sim.inFlight[0].frame.payload.kind).toBe('arp');

    sim.run();
    expect(ping.status).toBe('success');
    // ARP request, flood, reply, forward, echo req x2 hops, echo reply x2 hops = 6 hops... reply arrives at tick 8
    expect(ping.rttTicks).toBeGreaterThan(0);
    const pc1Mac = b.t.interfaces[b.port('PC1', 'FastEthernet0')].mac;
    expect(sim.arp.PC0['192.168.1.11'].mac).toBe(pc1Mac);
    expect(sim.arp.PC1['192.168.1.10']).toBeDefined(); // learned from the request
    expect(Object.keys(sim.mac.S0)).toHaveLength(2);
  });

  it('a second ping needs no ARP', () => {
    const sim = new Simulation(lan().t);
    sim.ping('PC0', '192.168.1.11');
    sim.run();
    const before = sim.log.length;
    const second = sim.ping('PC0', '192.168.1.11', { seq: 2 });
    sim.run();
    expect(second.status).toBe('success');
    expect(sim.log.slice(before).some((e) => e.text.includes('ARP request'))).toBe(false);
  });

  it('the switch forwards a known unicast out of one port, not all', () => {
    const b = lan();
    b.add('pc', 'PC2');
    b.link(['PC2', 'FastEthernet0'], ['S0', 'FastEthernet0/3']);
    b.ip('PC2', 'FastEthernet0', '192.168.1.12/24');
    const sim = new Simulation(b.t);
    sim.ping('PC0', '192.168.1.11');
    sim.step(); // request reaches the switch
    expect(sim.inFlight).toHaveLength(2); // flooded to PC1 and PC2
    sim.step(); // PC1 replies, PC2 ignores
    expect(sim.log.some((e) => e.text.includes('PC2 ignores ARP'))).toBe(true);
    sim.step(); // reply reaches the switch, which already knows PC0
    expect(sim.inFlight).toHaveLength(1);
  });

  it('pinging an address nobody has fails with no ARP reply', () => {
    const sim = new Simulation(lan().t);
    const ping = sim.ping('PC0', '192.168.1.99');
    sim.run();
    expect(ping.status).toBe('unreachable');
    expect(ping.detail).toMatch(/no ARP reply/);
  });

  it('a shut-down port drops the frame', () => {
    const b = lan();
    b.t = setInterfaceAdmin(b.t, b.port('PC1', 'FastEthernet0'), false);
    const sim = new Simulation(b.t);
    const ping = sim.ping('PC0', '192.168.1.11');
    sim.run();
    expect(ping.status).toBe('unreachable');
    expect(sim.log.some((e) => e.text.includes('shut down'))).toBe(true);
  });
});

describe('hub', () => {
  it('repeats everything to everyone; NICs filter what is not theirs', () => {
    const b = new Builder();
    for (const n of ['A', 'B', 'C']) b.add('pc', n);
    b.add('hub', 'H');
    b.link(['A', 'FastEthernet0'], ['H', 'Port0']);
    b.link(['B', 'FastEthernet0'], ['H', 'Port1']);
    b.link(['C', 'FastEthernet0'], ['H', 'Port2']);
    b.ip('A', 'FastEthernet0', '10.0.0.1/24');
    b.ip('B', 'FastEthernet0', '10.0.0.2/24');
    b.ip('C', 'FastEthernet0', '10.0.0.3/24');
    const sim = new Simulation(b.t);
    const ping = sim.ping('A', '10.0.0.2');
    sim.run();
    expect(ping.status).toBe('success');
    // Unlike a switch, the hub sent B's unicast reply to C too, and C's NIC dropped it.
    expect(sim.log.some((e) => e.text.startsWith('C FastEthernet0 ignores a frame'))).toBe(true);
    expect(sim.mac.H).toBeUndefined(); // a hub learns nothing
  });
});

describe('routing', () => {
  it('builds connected and static routes; drops statics with unreachable next hops', () => {
    const b = twoRouters();
    const rt = routingTable(b.t, 'R1');
    expect(rt.map((r) => `${r.source} ${r.network}/${r.prefixLength}`).sort()).toEqual([
      'connected 10.0.0.0/30',
      'connected 10.1.0.0/24',
      'static 10.2.0.0/24',
    ]);
    b.t = setInterfaceAdmin(b.t, b.port('R1', 'Serial0/0/0'), false);
    expect(routingTable(b.t, 'R1').map((r) => r.network)).toEqual(['10.1.0.0']);
  });

  it('pings across two routers with static routes, decrementing TTL', () => {
    const sim = new Simulation(twoRouters().t);
    const ping = sim.ping('PC0', '10.2.0.10');
    sim.run();
    expect(ping.status).toBe('success');
    expect(sim.log.some((e) => e.text.includes('R1 routes 10.2.0.10 via 10.2.0.0/24 (static)'))).toBe(true);
    expect(sim.log.some((e) => e.text.includes('TTL 64 → 63'))).toBe(true);
  });

  it('a missing return route breaks the ping even though the request arrives', () => {
    const b = twoRouters();
    b.t = { ...b.t, devices: { ...b.t.devices, R2: { ...b.t.devices.R2, staticRoutes: [] } } };
    const sim = new Simulation(b.t);
    const ping = sim.ping('PC0', '10.2.0.10');
    sim.run();
    expect(sim.log.some((e) => e.text.startsWith('PC1 receives ICMP echo request'))).toBe(true);
    expect(ping.status).not.toBe('success');
  });

  it('no route: the router answers destination net unreachable', () => {
    const b = twoRouters();
    b.t = { ...b.t, devices: { ...b.t.devices, R1: { ...b.t.devices.R1, staticRoutes: [] } } };
    const sim = new Simulation(b.t);
    const ping = sim.ping('PC0', '10.2.0.10');
    sim.run();
    expect(ping.status).toBe('unreachable');
    expect(ping.detail).toMatch(/10\.1\.0\.1 reports destination net unreachable/);
  });

  it('a host without a gateway cannot leave its subnet', () => {
    const b = twoRouters();
    b.t = setDefaultGateway(b.t, 'PC0', undefined);
    const sim = new Simulation(b.t);
    const ping = sim.ping('PC0', '10.2.0.10');
    expect(ping.status).toBe('unreachable');
    expect(ping.detail).toMatch(/no default gateway/);
  });

  it('TTL 1 dies at the first router with time exceeded', () => {
    const sim = new Simulation(twoRouters().t);
    const ping = sim.ping('PC0', '10.2.0.10', { ttl: 1 });
    sim.run();
    expect(ping.status).toBe('ttl-exceeded');
    expect(ping.detail).toMatch(/10\.1\.0\.1/);
  });

  it('a routing loop is stopped by TTL', () => {
    const b = twoRouters();
    // R1 sends 10.9/16 to R2, R2 sends it back to R1.
    b.t = addStaticRoute(b.t, 'R1', { prefix: '10.9.0.0', prefixLength: 16, nextHop: '10.0.0.2' });
    b.t = addStaticRoute(b.t, 'R2', { prefix: '10.9.0.0', prefixLength: 16, nextHop: '10.0.0.1' });
    const sim = new Simulation(b.t);
    const ping = sim.ping('PC0', '10.9.0.1', { ttl: 10 });
    sim.run(500);
    expect(ping.status).toBe('ttl-exceeded');
  });

  it('traceroute lists every router on the path', () => {
    const sim = new Simulation(twoRouters().t);
    const hops = traceroute(sim, 'PC0', '10.2.0.10');
    expect(hops).toEqual([
      { ttl: 1, address: '10.1.0.1', status: 'time-exceeded' },
      { ttl: 2, address: '10.0.0.2', status: 'time-exceeded' },
      { ttl: 3, address: '10.2.0.10', status: 'reached' },
    ]);
  });

  it('serial links are point-to-point: no ARP crosses them', () => {
    const sim = new Simulation(twoRouters().t);
    sim.ping('PC0', '10.2.0.10');
    sim.run();
    expect(sim.log.some((e) => e.text.includes('ARP request: who has 10.0.0.2'))).toBe(false);
    expect(sim.log.some((e) => e.text.includes('no ARP needed'))).toBe(true);
  });

  it('a router can ping its neighbour', () => {
    const sim = new Simulation(twoRouters().t);
    const ping = sim.ping('R1', '10.0.0.2');
    sim.run();
    expect(ping.status).toBe('success');
  });
});

describe('switching loop', () => {
  it('a broadcast storm is detected instead of hanging', () => {
    const b = lan();
    b.add('switch', 'S1');
    b.link(['S0', 'FastEthernet0/7'], ['S1', 'FastEthernet0/7'], 'copper-cross');
    b.link(['S0', 'FastEthernet0/8'], ['S1', 'FastEthernet0/8'], 'copper-cross');
    const sim = new Simulation(b.t);
    sim.ping('PC0', '192.168.1.99');
    sim.run(500);
    expect(sim.log.some((e) => e.text.includes('broadcast storm'))).toBe(true);
    expect(sim.isIdle()).toBe(true);
  });
});
