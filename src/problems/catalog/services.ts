// DHCP, DNS and web-server problems on the two-LAN office.
import type { Draft } from '../../model/draft';
import type { DhcpPool } from '../../model/types';
import type { ProblemSpec } from '../spec';
import { stable, twoLans } from './nets';

const RECORDS = [{ name: 'www.office.lab', type: 'A' as const, address: '10.0.2.10' }];

/** twoLans where Server1 also answers DNS for www.office.lab and the PCs ask it. */
const withDns = (d: Draft, clients: string[] = ['PC1', 'PC2']) => clients.reduce((x, c) => x.dns(c, '10.0.2.10'), d.services('Server1', (s) => ({ ...s, dns: { enabled: true, records: RECORDS } })));

const L = twoLans().done().layout;

// ---------------------------------------------------------------- easy

export const webServerDown: ProblemSpec = {
  slug: 'web-server-down',
  version: 1,
  title: 'Ping works, the website does not',
  topic: 'Applications',
  difficulty: 'easy',
  type: 'troubleshoot',
  statement:
    'Users say the intranet site on Server1 (http://10.0.2.10/) is down. You ping 10.0.2.10 from PC1 and it answers every time.\n\nSo the network is fine and the server is on. Find out why the page does not load, and fix it.',
  requirements: [
    { id: 'web', text: 'PC1 opens http://10.0.2.10/', hints: ['A ping proves layers 1 to 3. A web page also needs something listening on TCP port 80.', 'Run a TCP test to 10.0.2.10 port 80: "refused" means the host is there but no service answers.', 'Open Server1, go to Services, and switch the HTTP service on.'] },
  ],
  tests: [
    { id: 'port-80', requirement: 'web', points: 2, check: { kind: 'tcp', params: { from: 'PC1', to: '10.0.2.10', port: 80 } } },
    { id: 'page-loads', requirement: 'web', points: 3, check: { kind: 'http', params: { from: 'PC1', url: 'http://10.0.2.10/' } } },
  ],
  solution:
    'The HTTP service on Server1 is switched off. The server still answers pings, because ICMP is handled by the operating system, but a TCP connection to port 80 is refused: nothing is listening. Enable HTTP in Server1\'s Services tab. This is the classic "but I can ping it" ticket: reachability and a running service are two different things.',
  layout: L,
  start: () => twoLans().services('Server1', (s) => ({ ...s, http: { ...s.http!, enabled: false } })).done().topology,
  reference: () => twoLans().done().topology,
  wrong: [() => twoLans().services('Server1', (s) => ({ ...s, http: { ...s.http!, enabled: false }, ftp: { enabled: true, accounts: [], files: [] } })).done().topology], // turned on the wrong service
};

export const dnsName: ProblemSpec = {
  slug: 'name-not-found',
  version: 1,
  title: 'The name that will not resolve',
  topic: 'DHCP & DNS',
  difficulty: 'easy',
  type: 'troubleshoot',
  statement:
    'Everyone opens the intranet as http://www.office.lab/. On PC2 that works. On PC1 the browser says the name cannot be found, although http://10.0.2.10/ loads fine on PC1.\n\nServer1 (10.0.2.10) is both the web server and the DNS server. Fix PC1.',
  requirements: [
    { id: 'name', text: 'PC1 opens http://www.office.lab/', hints: ['Before a browser can connect to a name, something must turn the name into an address.', 'Compare the DNS server setting on PC1 and PC2.', 'On PC1, set the DNS server to 10.0.2.10.'] },
  ],
  tests: [
    { id: 'by-address', requirement: 'name', points: 1, check: { kind: 'http', params: { from: 'PC1', url: 'http://10.0.2.10/' } } },
    { id: 'by-name', requirement: 'name', points: 3, check: { kind: 'http', params: { from: 'PC1', url: 'http://www.office.lab/', contains: 'Server1' } } },
  ],
  solution:
    'PC1 has no DNS server configured, so it has nobody to ask what www.office.lab is. The page loads by IP address because that needs no lookup. Set PC1\'s DNS server to 10.0.2.10, the host that holds the A record. Pointing it at the router (10.0.2.1 or 10.0.1.1) does not help: R1 does not run a DNS service.',
  layout: L,
  start: () => withDns(twoLans(), ['PC2']).done().topology,
  reference: () => withDns(twoLans()).done().topology,
  wrong: [() => withDns(twoLans(), ['PC2']).dns('PC1', '10.0.1.1').done().topology],
};

const STAFF_POOL: DhcpPool = { name: 'STAFF', network: '10.0.1.0', prefixLength: 24, defaultRouter: '10.0.1.1', dnsServer: '10.0.2.10', excluded: ['10.0.1.1', '10.0.1.10'] };

export const dhcpClient: ProblemSpec = {
  slug: 'dhcp-client',
  version: 1,
  title: 'Stop typing addresses',
  topic: 'DHCP & DNS',
  difficulty: 'easy',
  type: 'configure',
  statement:
    'PC2 came from another office and still has its old static address, 192.168.0.5. R1 already runs a DHCP server for the staff LAN (10.0.1.0/24).\n\nMake PC2 get its address, gateway and DNS server automatically, so it reaches Server1 (10.0.2.10).',
  requirements: [
    { id: 'lease', text: 'PC2 gets its address from DHCP', hints: ['DHCP hands a host its address, mask, gateway and DNS server in one exchange.', 'Open PC2 > Config and look at the IPv4 setting: Static or DHCP.', 'Switch PC2\'s IPv4 from Static to DHCP.'] },
    { id: 'reach', text: 'PC2 reaches Server1', hints: ['The lease includes the default gateway, so nothing else needs typing.', 'Watch Discover, Offer, Request, Ack in Simulation mode.', 'After the lease, ping 10.0.2.10 from PC2.'] },
  ],
  tests: [
    { id: 'pc2-lease', requirement: 'lease', points: 3, check: { kind: 'dhcpLease', params: { host: 'PC2', subnet: '10.0.1.0/24' } } },
    { id: 'pc2-to-server', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC2', to: '10.0.2.10' } } },
  ],
  solution:
    'Set PC2\'s IPv4 configuration to DHCP. PC2 broadcasts a Discover, R1 offers an address from its STAFF pool, and the Ack carries the mask, the default gateway 10.0.1.1 and the DNS server. Typing a free 10.0.1.x address by hand also makes the ping work, but it is exactly what DHCP exists to avoid: the next person may pick the same address.',
  layout: L,
  start: () => twoLans({ pc2: true }).pools('R1', [STAFF_POOL]).ip('PC2', 'FastEthernet0', '192.168.0.5', 24).gw('PC2', '192.168.0.1').done().topology,
  reference: () => twoLans({ pc2: true }).pools('R1', [STAFF_POOL]).opts('PC2', 'FastEthernet0', { dhcp: true }).done().topology,
  wrong: [() => twoLans({ pc2: true }).pools('R1', [STAFF_POOL]).ip('PC2', 'FastEthernet0', '10.0.1.50', 24).gw('PC2', '10.0.1.1').done().topology], // typed by hand
};

// ---------------------------------------------------------------- medium

/** Both staff PCs are DHCP clients. `pool` goes on R1; `relay` = helper address per R1 port; `serverPool` on Server1. */
function dhcpOffice(o: { pool?: DhcpPool; serverPool?: DhcpPool; helper?: Record<string, string> } = {}) {
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
    .ip('Server1', 'GigabitEthernet0', '10.0.2.10', 24)
    .gw('Server1', '10.0.2.1')
    .services('Server1', (s) => ({ ...s, dns: { enabled: true, records: RECORDS } }))
    .opts('PC1', 'FastEthernet0', { dhcp: true })
    .opts('PC2', 'FastEthernet0', { dhcp: true });
  if (o.pool) d.pools('R1', [o.pool]);
  if (o.serverPool) d.pools('Server1', [o.serverPool]);
  for (const [port, address] of Object.entries(o.helper ?? {})) d.opts('R1', port, { helperAddress: address });
  return d.done();
}

const FULL: DhcpPool = { name: 'STAFF', network: '10.0.1.0', prefixLength: 24, defaultRouter: '10.0.1.1', dnsServer: '10.0.2.10' };

export const dhcpPool: ProblemSpec = {
  slug: 'dhcp-pool',
  version: 1,
  title: 'Build a DHCP pool',
  topic: 'DHCP & DNS',
  difficulty: 'medium',
  type: 'configure',
  statement:
    'The staff PCs are set to DHCP, but there is no DHCP server yet, so they have no address at all.\n\nMake R1 the DHCP server for the staff LAN 10.0.1.0/24. A lease must give a PC everything it needs to open http://www.office.lab/, which lives on Server1 (10.0.2.10, also the DNS server) in the other LAN.',
  requirements: [
    { id: 'lease', text: 'PC1 and PC2 get addresses in 10.0.1.0/24', hints: ['A DHCP pool is a network plus the options to hand out with each address.', 'On R1, create a pool whose network is the staff LAN.', 'On R1: ip dhcp pool STAFF, network 10.0.1.0 255.255.255.0.'] },
    { id: 'gateway', text: 'Leased PCs reach the other LAN', hints: ['An address alone only reaches the local LAN.', 'The pool must also hand out the default gateway.', 'In the pool: default-router 10.0.1.1.'] },
    { id: 'dns', text: 'Leased PCs resolve www.office.lab', hints: ['Names need a DNS server, and DHCP can hand that out too.', 'Which host answers DNS in this network?', 'In the pool: dns-server 10.0.2.10.'] },
  ],
  tests: [
    { id: 'pc1-lease', requirement: 'lease', points: 2, check: { kind: 'dhcpLease', params: { host: 'PC1', subnet: '10.0.1.0/24' } } },
    { id: 'pc2-lease', requirement: 'lease', points: 2, check: { kind: 'dhcpLease', params: { host: 'PC2', subnet: '10.0.1.0/24' } } },
    { id: 'pc1-to-server', requirement: 'gateway', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '10.0.2.10' } } },
    { id: 'pc2-by-name', requirement: 'dns', points: 2, check: { kind: 'http', params: { from: 'PC2', url: 'http://www.office.lab/' } } },
  ],
  solution:
    'On R1: "ip dhcp pool STAFF", "network 10.0.1.0 255.255.255.0", "default-router 10.0.1.1", "dns-server 10.0.2.10". The network line makes R1 answer Discovers arriving on its 10.0.1.1 port. Without default-router the PCs get an address but cannot leave their LAN; without dns-server they reach 10.0.2.10 but cannot resolve www.office.lab.',
  layout: dhcpOffice().layout,
  start: () => dhcpOffice().topology,
  reference: () => dhcpOffice({ pool: FULL }).topology,
  wrong: [
    () => dhcpOffice({ pool: { ...FULL, defaultRouter: undefined } }).topology,
    () => dhcpOffice({ pool: { ...FULL, dnsServer: undefined } }).topology,
    () => dhcpOffice({ pool: { ...FULL, network: '10.0.2.0', defaultRouter: '10.0.2.1' } }).topology, // a pool for the wrong LAN
  ],
};

export const dhcpRelay: ProblemSpec = {
  slug: 'dhcp-relay',
  version: 1,
  title: 'The DHCP server is one router away',
  topic: 'DHCP & DNS',
  difficulty: 'medium',
  type: 'troubleshoot',
  statement:
    'The company moved DHCP from the router to Server1 (10.0.2.10), which now holds the pool for the staff LAN 10.0.1.0/24. Since the move, staff PCs get no address.\n\nThe pool on Server1 is correct. Make the staff PCs get their leases from it.',
  requirements: [
    { id: 'lease', text: 'PC1 and PC2 lease addresses in 10.0.1.0/24 from Server1', hints: ['A DHCP Discover is a broadcast, and routers do not forward broadcasts.', 'The router port facing the clients can relay their broadcasts to a server as unicast.', 'On R1: interface gi0/0, ip helper-address 10.0.2.10.'] },
    { id: 'reach', text: 'Leased PCs reach Server1', hints: ['The relay tells the server which LAN the request came from, so it picks the right pool.', 'The helper goes on the interface where the clients are, not where the server is.', 'Check that the helper address is the server\'s IP, not the router\'s.'] },
  ],
  tests: [
    { id: 'pc1-lease', requirement: 'lease', points: 3, check: { kind: 'dhcpLease', params: { host: 'PC1', subnet: '10.0.1.0/24', server: '10.0.2.10' } } },
    { id: 'pc2-lease', requirement: 'lease', points: 2, check: { kind: 'dhcpLease', params: { host: 'PC2', subnet: '10.0.1.0/24' } } },
    { id: 'pc1-to-server', requirement: 'reach', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '10.0.2.10' } } },
  ],
  solution:
    'PC1\'s Discover is a broadcast and stops at R1. "ip helper-address 10.0.2.10" on R1 GigabitEthernet0/0, the port facing the clients, turns R1 into a relay: it forwards the Discover to Server1 as unicast and stamps it with its own 10.0.1.1 address (giaddr), which is how the server knows to answer from the 10.0.1.0/24 pool. On Gi0/1 the helper does nothing, because no client broadcasts arrive there.',
  layout: dhcpOffice().layout,
  start: () => dhcpOffice({ serverPool: FULL }).topology,
  reference: () => dhcpOffice({ serverPool: FULL, helper: { 'GigabitEthernet0/0': '10.0.2.10' } }).topology,
  wrong: [
    () => dhcpOffice({ serverPool: FULL, helper: { 'GigabitEthernet0/1': '10.0.2.10' } }).topology, // helper on the server-side port
    () => dhcpOffice({ serverPool: FULL, helper: { 'GigabitEthernet0/0': '10.0.2.1' } }).topology, // relaying to the router itself
    () => dhcpOffice({ serverPool: FULL, pool: FULL }).topology, // gave up on the server and put the pool back on R1
  ],
};
