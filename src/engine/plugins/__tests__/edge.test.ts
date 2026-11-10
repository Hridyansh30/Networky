// ACL, NAT and TCP together: the classic "office edge router" lab.
import { describe, expect, it } from 'vitest';
import { parseRule } from '../../../model/acl';
import { setAcl, setDefaultGateway, setInterfaceOptions, setNat } from '../../../model/ops';
import { Builder } from '../../../model/testing';
import { boot, pingAndRun } from '../../testing';
import type { Acl } from '../../../model/types';
import { isIpv4 } from '../../packets';
import type { Simulation } from '../../simulation';
import { aclHits } from '../acl';
import { translationsOf } from '../nat';

/**
 *  PC0 192.168.1.10 ┐                                      ┌ WEB 203.0.113.80 (server)
 *  PC1 192.168.1.11 ┴ S0 ── R0 Gi0/0 192.168.1.1 | Gi0/1 203.0.113.1 ── S1 ┤
 *                     inside                       outside                └ EXT 203.0.113.50 (pc, no route back to 192.168.x)
 */
function edge() {
  const b = new Builder();
  for (const [k, n] of [['pc', 'PC0'], ['pc', 'PC1'], ['switch', 'S0'], ['router', 'R0'], ['switch', 'S1'], ['server', 'WEB'], ['pc', 'EXT']] as const) b.add(k, n);
  b.link(['PC0', 'FastEthernet0'], ['S0', 'FastEthernet0/1']);
  b.link(['PC1', 'FastEthernet0'], ['S0', 'FastEthernet0/2']);
  b.link(['S0', 'GigabitEthernet0/1'], ['R0', 'GigabitEthernet0/0']);
  b.link(['R0', 'GigabitEthernet0/1'], ['S1', 'GigabitEthernet0/1']);
  b.link(['S1', 'FastEthernet0/1'], ['WEB', 'GigabitEthernet0']);
  b.link(['S1', 'FastEthernet0/2'], ['EXT', 'FastEthernet0']);
  b.ip('PC0', 'FastEthernet0', '192.168.1.10/24');
  b.ip('PC1', 'FastEthernet0', '192.168.1.11/24');
  b.ip('R0', 'GigabitEthernet0/0', '192.168.1.1/24');
  b.ip('R0', 'GigabitEthernet0/1', '203.0.113.1/24');
  b.ip('WEB', 'GigabitEthernet0', '203.0.113.80/24');
  b.ip('EXT', 'FastEthernet0', '203.0.113.50/24');
  b.t = setDefaultGateway(b.t, 'PC0', '192.168.1.1');
  b.t = setDefaultGateway(b.t, 'PC1', '192.168.1.1');
  b.t = setDefaultGateway(b.t, 'WEB', '203.0.113.1'); // EXT deliberately has none
  return b;
}

const acl = (type: Acl['type'], ...lines: string[]): Acl => ({ type, rules: lines.map((l) => parseRule(l, type)) });
const tcp = (sim: Simulation, from: string, to: string, port: number) => {
  const p = sim.probe({ kind: 'tcp', sourceDeviceId: from, destination: to, port });
  sim.run(5000);
  return p;
};

describe('ACLs', () => {
  it('a standard ACL inbound blocks one host and permits the rest', () => {
    const b = edge();
    b.t = setAcl(b.t, 'R0', '10', acl('standard', 'deny host 192.168.1.10', 'permit any'));
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { aclIn: '10' });
    const sim = boot(b.t);
    const denied = pingAndRun(sim, 'PC0', '203.0.113.80');
    expect(denied.status).toBe('prohibited'); // ICMP admin-prohibited came back, like IOS 'U.U.U'
    expect(pingAndRun(sim, 'PC1', '203.0.113.80').status).toBe('success');
    // counters per rule, like 'show access-lists' (N matches): PC0's request hit rule 1, PC1's request rule 2;
    // replies enter on Gi0/1, where no ACL is applied
    expect(aclHits(sim, 'R0', '10')).toEqual([1, 1, 0]); // last slot: implicit deny
  });

  it('the implicit deny drops everything not permitted', () => {
    const b = edge();
    b.t = setAcl(b.t, 'R0', '10', acl('standard', 'permit host 192.168.1.10'));
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { aclIn: '10' });
    const sim = boot(b.t);
    expect(pingAndRun(sim, 'PC0', '203.0.113.80').status).toBe('success');
    expect(pingAndRun(sim, 'PC1', '203.0.113.80').status).toBe('prohibited');
  });

  it('an extended ACL filters by protocol and port (web allowed, ssh refused by policy)', () => {
    const b = edge();
    b.t = setAcl(b.t, 'R0', '110', acl('extended', 'permit tcp 192.168.1.0 0.0.0.255 host 203.0.113.80 eq 80', 'deny tcp any any eq 22', 'permit icmp any any'));
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { aclIn: '110' });
    const sim = boot(b.t);
    expect(tcp(sim, 'PC0', '203.0.113.80', 80).status).toBe('success');
    expect(tcp(sim, 'PC0', '203.0.113.80', 22).status).toBe('prohibited');
    expect(pingAndRun(sim, 'PC0', '203.0.113.80').status).toBe('success');
    expect(tcp(sim, 'PC0', '203.0.113.80', 443).status).toBe('prohibited'); // implicit deny
  });

  it('an outbound ACL filters traffic leaving the interface', () => {
    const b = edge();
    b.t = setAcl(b.t, 'R0', '20', acl('standard', 'deny 192.168.1.0 0.0.0.255', 'permit any'));
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/1'), { aclOut: '20' });
    const sim = boot(b.t);
    expect(pingAndRun(sim, 'PC0', '203.0.113.80').status).toBe('prohibited');
    // the router's own traffic is not filtered by an outbound ACL (IOS behaviour)
    expect(pingAndRun(sim, 'R0', '203.0.113.80').status).toBe('success');
  });

  it('an ACL that is applied but not defined permits everything (IOS behaviour)', () => {
    const b = edge();
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { aclIn: '99' });
    expect(pingAndRun(boot(b.t), 'PC0', '203.0.113.80').status).toBe('success');
  });
});

describe('TCP connection test', () => {
  it('open port gets SYN-ACK, closed port gets RST', () => {
    const b = edge();
    const sim = boot(b.t);
    expect(tcp(sim, 'EXT', '203.0.113.80', 80).status).toBe('success');
    expect(tcp(sim, 'EXT', '203.0.113.80', 8080).status).toBe('refused');
    expect(tcp(sim, 'WEB', '203.0.113.50', 80).status).toBe('refused'); // a PC listens on nothing
  });
});

function withPat(b: ReturnType<typeof edge>) {
  b.t = setAcl(b.t, 'R0', '1', acl('standard', 'permit 192.168.1.0 0.0.0.255'));
  b.t = setNat(b.t, 'R0', { statics: [], overload: { acl: '1', outsideInterfaceId: b.port('R0', 'GigabitEthernet0/1') } });
  b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { nat: 'inside' });
  b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/1'), { nat: 'outside' });
  return b;
}

describe('NAT', () => {
  it('PAT: private hosts reach a host that has no route back to them', () => {
    const b = edge();
    // EXT has no default gateway: without NAT it could never answer 192.168.1.10
    expect(pingAndRun(boot(b.t), 'PC0', '203.0.113.50').status).not.toBe('success');
    const sim = boot(withPat(b).t);
    expect(pingAndRun(sim, 'PC0', '203.0.113.50').status).toBe('success');
    expect(pingAndRun(sim, 'PC1', '203.0.113.50').status).toBe('success');
    const t = translationsOf(sim, 'R0');
    expect(t.map((x) => x.insideGlobal)).toEqual(['203.0.113.1', '203.0.113.1']); // both share the outside IP
    expect(new Set(t.map((x) => x.insideLocal))).toEqual(new Set(['192.168.1.10', '192.168.1.11']));
  });

  it('PAT rewrites the source on the outside and nothing private leaks', () => {
    const b = withPat(edge());
    const sim = boot(b.t);
    const outside = b.port('R0', 'GigabitEthernet0/1');
    const leaked: string[] = [];
    sim.ping('PC0', '203.0.113.50');
    while (!sim.isIdle()) for (const tx of sim.step()) if (tx.fromIf === outside && isIpv4(tx.frame.payload) && tx.frame.payload.src.startsWith('192.168.')) leaked.push(tx.frame.payload.src);
    expect(leaked).toEqual([]);
  });

  it('PAT keeps two TCP flows apart by port', () => {
    const sim = boot(withPat(edge()).t);
    expect(tcp(sim, 'PC0', '203.0.113.80', 80).status).toBe('success');
    expect(tcp(sim, 'PC1', '203.0.113.80', 80).status).toBe('success');
    const tcpT = translationsOf(sim, 'R0').filter((x) => x.protocol === 'tcp');
    expect(tcpT).toHaveLength(2);
    expect(new Set(tcpT.map((x) => x.globalPort)).size).toBe(2);
  });

  it('static NAT publishes an inside server to the outside', () => {
    const b = edge();
    b.t = setNat(b.t, 'R0', { statics: [{ local: '192.168.1.10', global: '203.0.113.10' }] });
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/0'), { nat: 'inside' });
    b.t = setInterfaceOptions(b.t, b.port('R0', 'GigabitEthernet0/1'), { nat: 'outside' });
    const sim = boot(b.t);
    // EXT talks to the public address; the router answers ARP for it and translates
    expect(pingAndRun(sim, 'EXT', '203.0.113.10').status).toBe('success');
    expect(translationsOf(sim, 'R0').some((x) => x.kind === 'static' && x.insideGlobal === '203.0.113.10')).toBe(true);
  });

  it('without NAT on the interfaces nothing is translated', () => {
    const b = edge();
    b.t = setAcl(b.t, 'R0', '1', acl('standard', 'permit 192.168.1.0 0.0.0.255'));
    b.t = setNat(b.t, 'R0', { statics: [], overload: { acl: '1', outsideInterfaceId: b.port('R0', 'GigabitEthernet0/1') } });
    const sim = boot(b.t);
    pingAndRun(sim, 'PC0', '203.0.113.50');
    expect(translationsOf(sim, 'R0').filter((x) => x.kind === 'pat')).toHaveLength(0);
  });
});
