import { describe, expect, it } from 'vitest';
import { DEFAULT_PLUGINS } from '../engine/plugins';
import { Simulation } from '../engine/simulation';
import { EXAMPLES } from '../model/examples';
import { pduDetails } from './pdu';

function hopsOfPing(labPrefix: string, from: string, to: string) {
  const sim = new Simulation(EXAMPLES.find((e) => e.name.startsWith(labPrefix))!.build().topology, DEFAULT_PLUGINS).boot().run(5000);
  sim.hops = [];
  const src = Object.values(sim.topology.devices).find((d) => d.hostname === from)!.id;
  sim.probe({ kind: 'ping', sourceDeviceId: src, destination: to });
  sim.run(5000);
  return sim;
}

describe('PDU details', () => {
  const sim = hopsOfPing('Two LANs', 'PC0', '192.168.2.10');

  it('puts ICMP inside the IPv4 section (layer 3), with no transport layer', () => {
    const hop = sim.hops.find((h) => h.tag === 'icmp')!;
    const pdu = pduDetails(sim, hop);
    expect(pdu.sections.map((s) => s.layer)).toEqual(['L3', 'L2', 'L1']);
    expect(pdu.sections[0].inner?.title).toMatch(/ICMP \(inside IPv4/);
    expect(pdu.sections[0].fields.find((f) => f.label === 'Protocol')?.value).toBe('1 (ICMP)');
  });

  it('puts ARP inside Ethernet (layer 2), with no IP header', () => {
    const hop = sim.hops.find((h) => h.tag === 'arp')!;
    const pdu = pduDetails(sim, hop);
    expect(pdu.sections.map((s) => s.layer)).toEqual(['L2', 'L1']);
    expect(pdu.sections[0].fields.find((f) => f.label === 'EtherType')?.value).toBe('0x0806 (ARP)');
  });

  it('records every hop, not just the endpoints', () => {
    const icmp = sim.hops.filter((h) => h.tag === 'icmp');
    // PC0 → switch → router → switch → PC: four links each way
    expect(icmp.length).toBeGreaterThanOrEqual(8);
  });

  it('shows the 802.1Q tag on trunk links', () => {
    const vlan = hopsOfPing('VLAN', 'PC1', '192.168.20.10');
    const tagged = vlan.hops.find((h) => h.frame.vlan !== undefined)!;
    expect(pduDetails(vlan, tagged).sections.find((s) => s.layer === 'L2')!.title).toMatch(/802\.1Q/);
  });
});
