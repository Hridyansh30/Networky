// Small problems and networks shared by the grading tests.
import { setDefaultGateway, setInterfaceAdmin } from '../../model/ops';
import { smallLan } from '../../model/testing';
import type { Topology } from '../../model/types';
import type { ProblemSpec } from '../../problems/spec';

/** PC0 -- Switch0 -- Router0 plus PC1, but PC1 has no address yet. */
export function lanStart(): Topology {
  const b = smallLan();
  b.add('pc', 'PC1');
  b.link(['PC1', 'FastEthernet0'], ['Switch0', 'FastEthernet0/2']);
  return b.t;
}

/** The working network: PC1 addressed with its gateway set. */
export function lanSolved(): Topology {
  const b = smallLan();
  b.add('pc', 'PC1');
  b.link(['PC1', 'FastEthernet0'], ['Switch0', 'FastEthernet0/2']);
  b.ip('PC1', 'FastEthernet0', '192.168.1.11/24');
  b.t = setDefaultGateway(b.t, 'PC1', '192.168.1.1');
  return b.t;
}

/** Right address, but the gateway is missing: reaches its LAN only. */
export function lanNoGateway(): Topology {
  const b = smallLan();
  b.add('pc', 'PC1');
  b.link(['PC1', 'FastEthernet0'], ['Switch0', 'FastEthernet0/2']);
  b.ip('PC1', 'FastEthernet0', '192.168.1.11/24');
  return b.t;
}

/** Everything right, but the router port is shut down. */
export function lanRouterDown(): Topology {
  const t = lanSolved();
  const port = t.devices.Router0.interfaceIds.find((id) => t.interfaces[id].name === 'GigabitEthernet0/0')!;
  return setInterfaceAdmin(t, port, false);
}

export const addressPc1: ProblemSpec = {
  slug: 'address-pc1',
  version: 1,
  title: 'Address PC1',
  topic: 'IP Addressing',
  difficulty: 'easy',
  type: 'configure',
  statement: 'PC1 was just plugged in. Give it 192.168.1.11/24 and make it reach the router.',
  requirements: [
    { id: 'address', text: 'PC1 has 192.168.1.11/24', hints: ['Every host needs an address in its LAN.', 'Open PC1 > Config.', 'Set IPv4 192.168.1.11, mask 255.255.255.0.'] },
    { id: 'reach', text: 'PC1 reaches its LAN and its gateway', hints: ['Hosts on one LAN talk directly.', 'Ping 192.168.1.10 and 192.168.1.1.', 'Check the address and the cable.'] },
  ],
  tests: [
    { id: 'pc1-address', requirement: 'address', points: 1, check: { kind: 'interfaceIp', params: { device: 'PC1', port: 'FastEthernet0', address: '192.168.1.11/24' } } },
    { id: 'pc1-to-pc0', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '192.168.1.10' } } },
    { id: 'pc1-to-gw', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '192.168.1.1' } } },
  ],
  start: lanStart,
  reference: lanSolved,
  wrong: [lanRouterDown],
};
