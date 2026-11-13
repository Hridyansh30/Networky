// Base networks several problems start from. Each returns a Draft (stable
// ids: a device's id is its hostname) so a problem can break or finish it.

import { Draft } from '../../model/draft';

export const stable = () => new Draft({ stableIds: true });

/**
 * Staff LAN 10.0.1.0/24 (PC1, PC2 on S1) and server LAN 10.0.2.0/24
 * (Server1 on S2), joined by R1. Everything addressed and working.
 * `skip` leaves a host's address and gateway out so a problem can set its own.
 */
export function twoLans(skip: { pc2?: boolean } = {}): Draft {
  const d = stable()
    .dev('pc', 'PC1', 0, 60)
    .dev('pc', 'PC2', 0, 240)
    .dev('switch', 'S1', 180, 150)
    .dev('router', 'R1', 360, 20)
    .dev('switch', 'S2', 540, 150)
    .dev('server', 'Server1', 720, 150)
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('PC2', 'FastEthernet0', 'S1', 'FastEthernet0/2')
    .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
    .link('R1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1')
    .link('Server1', 'GigabitEthernet0', 'S2', 'FastEthernet0/1')
    .ip('R1', 'GigabitEthernet0/0', '10.0.1.1', 24)
    .ip('R1', 'GigabitEthernet0/1', '10.0.2.1', 24)
    .ip('PC1', 'FastEthernet0', '10.0.1.10', 24)
    .gw('PC1', '10.0.1.1')
    .ip('Server1', 'GigabitEthernet0', '10.0.2.10', 24)
    .gw('Server1', '10.0.2.1');
  if (!skip.pc2) d.ip('PC2', 'FastEthernet0', '10.0.1.11', 24).gw('PC2', '10.0.1.1');
  return d;
}

/**
 * PC1 ─ R1 ─ R2 ─ R3 ─ PC3 in a row over Gigabit links.
 * LANs 10.1.0.0/24 and 10.3.0.0/24, links 10.0.12.0/30 and 10.0.23.0/30.
 * No routes: a problem adds static routes, RIP or OSPF.
 */
export function threeInARow(): Draft {
  return stable()
    .dev('pc', 'PC1', 0, 200)
    .dev('router', 'R1', 180, 60)
    .dev('router', 'R2', 420, 0)
    .dev('router', 'R3', 660, 60)
    .dev('pc', 'PC3', 840, 200)
    .link('PC1', 'FastEthernet0', 'R1', 'GigabitEthernet0/0', 'copper-cross')
    .link('R1', 'GigabitEthernet0/1', 'R2', 'GigabitEthernet0/1', 'copper-cross')
    .link('R2', 'GigabitEthernet0/0', 'R3', 'GigabitEthernet0/1', 'copper-cross')
    .link('R3', 'GigabitEthernet0/0', 'PC3', 'FastEthernet0', 'copper-cross')
    .ip('PC1', 'FastEthernet0', '10.1.0.10', 24)
    .ip('R1', 'GigabitEthernet0/0', '10.1.0.1', 24)
    .ip('R1', 'GigabitEthernet0/1', '10.0.12.1', 30)
    .ip('R2', 'GigabitEthernet0/1', '10.0.12.2', 30)
    .ip('R2', 'GigabitEthernet0/0', '10.0.23.1', 30)
    .ip('R3', 'GigabitEthernet0/1', '10.0.23.2', 30)
    .ip('R3', 'GigabitEthernet0/0', '10.3.0.1', 24)
    .ip('PC3', 'FastEthernet0', '10.3.0.10', 24)
    .gw('PC1', '10.1.0.1')
    .gw('PC3', '10.3.0.1');
}

/**
 * The office edge: private LAN 192.168.1.0/24 behind R1, whose outside port
 * is 203.0.113.1 on the ISP segment with a public web server (203.0.113.80)
 * and an outside PC. The outside hosts have NO gateway: like the real
 * Internet, they cannot send anything back to a private address.
 */
export function officeEdge(): Draft {
  return stable()
    .dev('pc', 'PC1', 0, 60)
    .dev('laptop', 'PC2', 0, 240)
    .dev('switch', 'S1', 180, 150)
    .dev('router', 'R1', 380, 150)
    .dev('switch', 'ISP', 580, 150)
    .dev('server', 'Web', 760, 60)
    .dev('pc', 'ISP-PC', 760, 240)
    .link('PC1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('PC2', 'FastEthernet0', 'S1', 'FastEthernet0/2')
    .link('S1', 'GigabitEthernet0/1', 'R1', 'GigabitEthernet0/0')
    .link('R1', 'GigabitEthernet0/1', 'ISP', 'GigabitEthernet0/1')
    .link('ISP', 'FastEthernet0/1', 'Web', 'GigabitEthernet0')
    .link('ISP', 'FastEthernet0/2', 'ISP-PC', 'FastEthernet0')
    .ip('PC1', 'FastEthernet0', '192.168.1.10', 24)
    .ip('PC2', 'FastEthernet0', '192.168.1.11', 24)
    .ip('R1', 'GigabitEthernet0/0', '192.168.1.1', 24)
    .ip('R1', 'GigabitEthernet0/1', '203.0.113.1', 24)
    .ip('Web', 'GigabitEthernet0', '203.0.113.80', 24)
    .ip('ISP-PC', 'FastEthernet0', '203.0.113.50', 24)
    .gw('PC1', '192.168.1.1')
    .gw('PC2', '192.168.1.1');
}
