// Two things a learner can observe, and that were wrong before predict
// problems asked about them:
//  1. Only the host that sent a probe learns its fate. An ICMP error about a
//     dropped echo REPLY goes to the replying host; the original sender must
//     simply time out.
//  2. A TCP connection test agrees with the Services settings: a service
//     that is switched off refuses its port.
import { describe, expect, it } from 'vitest';
import { Draft } from '../../../model/draft';
import { DEFAULT_PLUGINS } from '..';
import { Simulation } from '../../simulation';

/** PC1 - R1 - R2 - PC2. R1 knows the far LAN; R2 has no route back to PC1's LAN. */
function oneWay() {
  return new Draft({ stableIds: true })
    .dev('pc', 'PC1', 0, 0)
    .dev('router', 'R1', 100, 0)
    .dev('router', 'R2', 200, 0)
    .dev('pc', 'PC2', 300, 0)
    .link('PC1', 'FastEthernet0', 'R1', 'GigabitEthernet0/0', 'copper-cross')
    .link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1', 'copper-cross')
    .link('R2', 'GigabitEthernet0/0', 'PC2', 'FastEthernet0', 'copper-cross')
    .ip('PC1', 'FastEthernet0', '10.1.0.10', 24)
    .gw('PC1', '10.1.0.1')
    .ip('R1', 'GigabitEthernet0/0', '10.1.0.1', 24)
    .ip('R1', 'GigabitEthernet0/1', '10.0.12.1', 30)
    .ip('R2', 'GigabitEthernet0/1', '10.0.12.2', 30)
    .ip('R2', 'GigabitEthernet0/0', '10.2.0.1', 24)
    .ip('PC2', 'FastEthernet0', '10.2.0.10', 24)
    .gw('PC2', '10.2.0.1')
    .route('R1', '10.2.0.0', 24, '10.0.12.2')
    .done().topology;
}

const booted = (t = oneWay()) => new Simulation(t, DEFAULT_PLUGINS).boot().run(5000);
const ping = (sim: Simulation, from: string, to: string) => {
  const p = sim.probe({ kind: 'ping', sourceDeviceId: from, destination: to });
  sim.run(5000);
  return p;
};

describe('a probe is finished only by what its own sender receives', () => {
  it('a reply dropped on the way back is a timeout for the sender, not "unreachable"', () => {
    const sim = booted();
    const p = ping(sim, 'PC1', '10.2.0.10');
    expect(p.status).toBe('lost');
    // The request did arrive, and R2 did report the dropped reply to PC2.
    expect(sim.log.some((e) => e.deviceId === 'PC2' && /receives ICMP echo request/i.test(e.text))).toBe(true);
  });

  it('the same missing route is "unreachable" from the other side', () => {
    expect(ping(booted(), 'PC2', '10.1.0.10').status).toBe('unreachable');
  });
});

describe('a TCP connection test follows the Services settings', () => {
  const office = () =>
    new Draft({ stableIds: true })
      .dev('pc', 'PC1', 0, 0)
      .dev('server', 'Server1', 100, 0)
      .link('PC1', 'FastEthernet0', 'Server1', 'GigabitEthernet0', 'copper-cross')
      .ip('PC1', 'FastEthernet0', '10.0.0.1', 24)
      .ip('Server1', 'GigabitEthernet0', '10.0.0.2', 24);
  const tcp = (sim: Simulation, port: number) => {
    const p = sim.probe({ kind: 'tcp', sourceDeviceId: 'PC1', destination: '10.0.0.2', port });
    sim.run(5000);
    return p.status;
  };

  it('web is on by default, FTP is off by default', () => {
    const sim = booted(office().done().topology);
    expect(tcp(sim, 80)).toBe('success');
    expect(tcp(sim, 21)).toBe('refused');
    expect(tcp(sim, 22)).toBe('success'); // management, always on
  });

  it('switching a service changes its port', () => {
    const t = office()
      .services('Server1', (s) => ({ ...s, http: { ...s.http!, enabled: false }, ftp: { ...s.ftp!, enabled: true } }))
      .done().topology;
    const sim = booted(t);
    expect(tcp(sim, 80)).toBe('refused');
    expect(tcp(sim, 21)).toBe('success');
  });
});
