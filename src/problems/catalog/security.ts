// NAT and access-list problems.
import type { Draft } from '../../model/draft';
import type { ProblemSpec } from '../spec';
import { officeEdge, twoLans } from './nets';

// ---------------------------------------------------------------- medium: ACL

/** twoLans with an extended ACL 110 on R1. `apply` = bind it inbound on the staff port. */
function filtered(rules: string[] | null, apply = true) {
  const d = twoLans();
  if (rules) d.acl('R1', '110', 'extended', ...rules);
  if (rules && apply) d.opts('R1', 'GigabitEthernet0/0', { aclIn: '110' });
  return d.done();
}

export const aclWebOnly: ProblemSpec = {
  slug: 'acl-block-ssh',
  version: 1,
  title: 'Web yes, SSH no',
  topic: 'NAT & ACL',
  difficulty: 'medium',
  type: 'configure',
  statement:
    'Security policy: staff (10.0.1.0/24) may browse the intranet on Server1 (10.0.2.10, TCP port 80) and may ping it for troubleshooting. They must not be able to open SSH (TCP port 22) to it.\n\nEnforce the policy on R1 with an access list. A blocked SSH attempt must be rejected by the router, not just fail because the server happens to run no SSH service today.',
  requirements: [
    { id: 'ssh', text: 'SSH from staff to Server1 is blocked by R1', hints: ['An extended ACL matches protocol, source, destination and port.', 'Deny TCP to port 22, and apply the list inbound on the port where staff traffic enters R1.', 'access-list 110 deny tcp 10.0.1.0 0.0.0.255 any eq 22, then on gi0/0: ip access-group 110 in.'] },
    { id: 'allowed', text: 'Web and ping from staff still work', hints: ['Every ACL ends with an invisible "deny everything".', 'After your deny line you need permit lines for what must still pass.', 'Add: access-list 110 permit tcp 10.0.1.0 0.0.0.255 any eq 80 and access-list 110 permit icmp any any.'] },
  ],
  tests: [
    { id: 'ssh-blocked', requirement: 'ssh', points: 3, check: { kind: 'tcp', params: { from: 'PC1', to: '10.0.2.10', port: 22, expect: 'prohibited' } } },
    { id: 'ssh-blocked-pc2', requirement: 'ssh', points: 1, check: { kind: 'tcp', params: { from: 'PC2', to: '10.0.2.10', port: 22, expect: 'prohibited' } } },
    { id: 'web-allowed', requirement: 'allowed', points: 2, check: { kind: 'tcp', params: { from: 'PC1', to: '10.0.2.10', port: 80 } } },
    { id: 'ping-allowed', requirement: 'allowed', points: 2, check: { kind: 'reach', params: { from: 'PC2', to: '10.0.2.10' } } },
  ],
  solution:
    'On R1: "access-list 110 deny tcp 10.0.1.0 0.0.0.255 any eq 22", "access-list 110 permit tcp 10.0.1.0 0.0.0.255 any eq 80", "access-list 110 permit icmp any any", then "ip access-group 110 in" on GigabitEthernet0/0. Rules are read top down and the first match wins; anything that matches no line hits the implicit deny at the end. That is why a list with only the deny line also kills web and ping, and why a list that is never applied to an interface does nothing at all.',
  layout: twoLans().done().layout,
  start: () => filtered(null).topology,
  reference: () => filtered(['deny tcp 10.0.1.0 0.0.0.255 any eq 22', 'permit tcp 10.0.1.0 0.0.0.255 any eq 80', 'permit icmp any any']).topology,
  wrong: [
    () => filtered(['deny tcp any any eq 22']).topology, // the implicit deny blocks everything else too
    () => filtered(['deny tcp any any eq 22', 'permit tcp any any eq 80', 'permit icmp any any'], false).topology, // written, never applied
    () => filtered(['permit ip any any', 'deny tcp any any eq 22']).topology, // order: the permit matches first
  ],
};

// ---------------------------------------------------------------- medium + hard: the office edge

interface Edge {
  pat?: boolean;
  roles?: boolean;
  acl?: string[];
}

function edge(o: Edge = {}) {
  const d: Draft = officeEdge();
  if (o.pat) d.acl('R1', '1', 'standard', 'permit 192.168.1.0 0.0.0.255').nat('R1', (port) => ({ statics: [], overload: { acl: '1', outsideInterfaceId: port('GigabitEthernet0/1') } }));
  if (o.roles) d.opts('R1', 'GigabitEthernet0/0', { nat: 'inside' }).opts('R1', 'GigabitEthernet0/1', { nat: 'outside' });
  if (o.acl) d.acl('R1', '110', 'extended', ...o.acl).opts('R1', 'GigabitEthernet0/0', { aclIn: '110' });
  return d.done();
}

export const patOverload: ProblemSpec = {
  slug: 'pat-overload',
  version: 1,
  title: 'One public address for the whole office',
  topic: 'NAT & ACL',
  difficulty: 'medium',
  type: 'configure',
  statement:
    'The office LAN uses private addresses (192.168.1.0/24). R1\'s outside port has the office\'s only public address, 203.0.113.1. Hosts on the Internet side have no route to 192.168.1.0/24, exactly like the real Internet, so today nothing comes back when PC1 pings the web server at 203.0.113.80.\n\nConfigure R1 so every office PC can reach the Internet by sharing R1\'s public address.',
  requirements: [
    { id: 'nat', text: 'PC1 and PC2 reach the public web server', hints: ['The server cannot reply to a private address. The packet must leave with a public source address.', 'Port address translation (NAT overload) maps many inside hosts onto one outside address.', 'access-list 1 permit 192.168.1.0 0.0.0.255, then ip nat inside source list 1 interface gi0/1 overload.'] },
    { id: 'roles', text: 'Inside and outside are marked on the right ports', hints: ['NAT only translates traffic that goes from an inside port to an outside port.', 'Mark the LAN port inside and the Internet port outside.', 'gi0/0: ip nat inside. gi0/1: ip nat outside.'] },
  ],
  tests: [
    { id: 'pc1-out', requirement: 'nat', points: 3, check: { kind: 'reach', params: { from: 'PC1', to: '203.0.113.80' } } },
    { id: 'pc2-web', requirement: 'nat', points: 2, check: { kind: 'http', params: { from: 'PC2', url: 'http://203.0.113.80/' } } },
    { id: 'pc1-to-outside-pc', requirement: 'roles', points: 2, check: { kind: 'reach', params: { from: 'PC1', to: '203.0.113.50' } } },
    { id: 'still-private', requirement: 'roles', points: 1, check: { kind: 'reach', params: { from: 'ISP-PC', to: '192.168.1.10', expect: 'unreachable' } } },
  ],
  solution:
    'Three pieces: an ACL that says who is translated ("access-list 1 permit 192.168.1.0 0.0.0.255"), the rule ("ip nat inside source list 1 interface GigabitEthernet0/1 overload"), and the interface roles ("ip nat inside" on Gi0/0, "ip nat outside" on Gi0/1). R1 then rewrites the source of each outgoing packet to 203.0.113.1 with a unique port and reverses it for the replies (see show ip nat translations). Miss any one piece and nothing is translated.',
  layout: edge().layout,
  start: () => edge().topology,
  reference: () => edge({ pat: true, roles: true }).topology,
  wrong: [
    () => edge({ pat: true }).topology, // rule without inside/outside
    () => edge({ roles: true }).topology, // roles without a rule
  ],
};

const POLICY = ['permit tcp 192.168.1.0 0.0.0.255 any eq 80', 'permit icmp any any'];

export const secureTheEdge: ProblemSpec = {
  slug: 'secure-the-edge',
  version: 1,
  title: 'Secure the office edge',
  topic: 'NAT & ACL',
  difficulty: 'hard',
  type: 'configure',
  statement:
    'You are handed a new office: private LAN 192.168.1.0/24, one public address on R1\'s outside port (203.0.113.1), and a written policy.\n\nPolicy: (1) all office PCs share the public address to reach the Internet; (2) from the office, only web browsing (TCP 80) and ping are allowed out; (3) everything else from the office, for example FTP (21) and SSH (22), is rejected by R1; (4) the Internet side must still be unable to reach private addresses.\n\nBuild it on R1.',
  requirements: [
    { id: 'share', text: 'Office PCs reach the Internet through one public address', hints: ['Private addresses are not routable outside: translate them.', 'You need a NAT overload rule, the ACL it refers to, and inside/outside on the ports.', 'access-list 1 permit 192.168.1.0 0.0.0.255; ip nat inside source list 1 interface gi0/1 overload; gi0/0 ip nat inside; gi0/1 ip nat outside.'] },
    { id: 'policy', text: 'Only web and ping leave the office; the rest is rejected by R1', hints: ['Filter where office traffic enters R1, before it is translated.', 'Permit exactly what the policy lists and let the implicit deny do the rest.', 'access-list 110 permit tcp 192.168.1.0 0.0.0.255 any eq 80; access-list 110 permit icmp any any; gi0/0: ip access-group 110 in.'] },
  ],
  tests: [
    { id: 'pc1-ping', requirement: 'share', points: 2, visibility: 'shown', check: { kind: 'reach', params: { from: 'PC1', to: '203.0.113.80' } } },
    { id: 'pc2-web', requirement: 'share', points: 2, check: { kind: 'http', params: { from: 'PC2', url: 'http://203.0.113.80/' } } },
    { id: 'private-stays-private', requirement: 'share', points: 1, check: { kind: 'reach', params: { from: 'ISP-PC', to: '192.168.1.10', expect: 'unreachable' } } },
    { id: 'web-out', requirement: 'policy', points: 1, check: { kind: 'tcp', params: { from: 'PC1', to: '203.0.113.80', port: 80 } } },
    { id: 'ssh-rejected', requirement: 'policy', points: 2, check: { kind: 'tcp', params: { from: 'PC1', to: '203.0.113.80', port: 22, expect: 'prohibited' } } },
    { id: 'ftp-rejected', requirement: 'policy', points: 2, check: { kind: 'tcp', params: { from: 'PC2', to: '203.0.113.80', port: 21, expect: 'prohibited' } } },
  ],
  solution:
    'NAT: "access-list 1 permit 192.168.1.0 0.0.0.255", "ip nat inside source list 1 interface GigabitEthernet0/1 overload", "ip nat inside" on Gi0/0 and "ip nat outside" on Gi0/1. Policy: "access-list 110 permit tcp 192.168.1.0 0.0.0.255 any eq 80", "access-list 110 permit icmp any any", applied with "ip access-group 110 in" on Gi0/0. The inbound ACL sees the packet with its private source, before NAT. A whitelist is the right shape for "only X is allowed": listing denies for 21 and 22 would let every other port through.',
  layout: edge().layout,
  start: () => edge().topology,
  reference: () => edge({ pat: true, roles: true, acl: POLICY }).topology,
  wrong: [
    () => edge({ pat: true, roles: true }).topology, // NAT only: no policy
    () => edge({ acl: POLICY }).topology, // policy only: nothing comes back
    () => edge({ pat: true, roles: true, acl: ['deny tcp any any eq 22', 'permit ip any any'] }).topology, // a blacklist: FTP still leaves
  ],
};
