// Predict problems: the network is finished and nothing needs fixing. Each
// question asks what one ping or connection will do. The right answer is
// whatever the simulation does on the start network (see ../predict.ts), so
// this file never states it as data; predicts.test.ts pins the outcomes the
// explanations were written for, and fails if the engine ever disagrees.
import { predictProblem } from '../spec';
import { officeEdge, stable, threeInARow, twoLans } from './nets';

// ---------------------------------------------------------------- easy: local or remote

/** twoLans, but PC2 was given an address and no default gateway. */
const noGateway = () => twoLans({ pc2: true }).ip('PC2', 'FastEthernet0', '10.0.1.11', 24).done();

export const predictLocalOrRemote = predictProblem({
  slug: 'predict-local-or-remote',
  version: 1,
  title: 'Local or remote?',
  topic: 'IP Addressing',
  difficulty: 'easy',
  statement:
    'Nothing is broken on purpose here and nothing needs fixing. Read the network, then say what each ping will do before you try anything.\n\nPC1 is fully configured. PC2 has an address and mask but its default gateway was left empty. Server1 sits behind the router R1.',
  questions: [
    { id: 'pc1-server', prompt: 'PC1 pings Server1 (10.0.2.10).', traffic: { kind: 'ping', from: 'PC1', to: '10.0.2.10' }, choices: ['success', 'unreachable', 'lost'], explanation: '10.0.2.10 is not in PC1\'s subnet (10.0.1.0/24), so PC1 hands the packet to its gateway 10.0.1.1. R1 is connected to both LANs and Server1 has a gateway for the way back. Both directions work.' },
    { id: 'pc2-pc1', prompt: 'PC2 (no gateway) pings PC1 (10.0.1.10).', traffic: { kind: 'ping', from: 'PC2', to: '10.0.1.10' }, choices: ['success', 'unreachable', 'lost'], explanation: 'A gateway is only used for destinations outside your own subnet. PC1 is in 10.0.1.0/24 like PC2, so PC2 ARPs for it directly and the switch delivers the frames. No router is involved.' },
    { id: 'pc2-server', prompt: 'PC2 (no gateway) pings Server1 (10.0.2.10).', traffic: { kind: 'ping', from: 'PC2', to: '10.0.2.10' }, choices: ['success', 'unreachable', 'lost'], explanation: 'PC2 compares 10.0.2.10 with its own subnet, sees it is remote, and looks for a gateway. There is none, so PC2 itself gives up with "network unreachable". Not a single frame leaves the PC.' },
    { id: 'server-pc2', prompt: 'Server1 pings PC2 (10.0.1.11).', traffic: { kind: 'ping', from: 'Server1', to: '10.0.1.11' }, choices: ['success', 'unreachable', 'lost'], explanation: 'The request does arrive: Server1 has a gateway and R1 delivers the packet to PC2. The reply is the problem. PC2 must answer 10.0.2.10, which is remote, and it has no gateway, so the reply is never sent. Server1 just waits and times out. A ping needs a working path in both directions.' },
  ],
  layout: twoLans().done().layout,
  start: () => noGateway().topology,
});

// ---------------------------------------------------------------- easy: VLAN walls

/** Two switches joined by a trunk. Sales is VLAN 10, HR is VLAN 20, and every PC is in 10.10.0.0/24. */
function vlanWalls() {
  return stable()
    .dev('switch', 'S1', 140, 0)
    .dev('switch', 'S2', 520, 0)
    .dev('pc', 'Sales1', 0, 180)
    .dev('pc', 'HR1', 240, 180)
    .dev('pc', 'Sales2', 420, 180)
    .dev('pc', 'HR2', 660, 180)
    .link('S1', 'GigabitEthernet0/1', 'S2', 'GigabitEthernet0/1', 'copper-cross')
    .link('Sales1', 'FastEthernet0', 'S1', 'FastEthernet0/1')
    .link('HR1', 'FastEthernet0', 'S1', 'FastEthernet0/2')
    .link('Sales2', 'FastEthernet0', 'S2', 'FastEthernet0/1')
    .link('HR2', 'FastEthernet0', 'S2', 'FastEthernet0/2')
    .access('S1', 'FastEthernet0/1', 10)
    .access('S1', 'FastEthernet0/2', 20)
    .access('S2', 'FastEthernet0/1', 10)
    .access('S2', 'FastEthernet0/2', 20)
    .trunk('S1', 'GigabitEthernet0/1')
    .trunk('S2', 'GigabitEthernet0/1')
    .ip('Sales1', 'FastEthernet0', '10.10.0.1', 24)
    .ip('HR1', 'FastEthernet0', '10.10.0.2', 24)
    .ip('Sales2', 'FastEthernet0', '10.10.0.3', 24)
    .ip('HR2', 'FastEthernet0', '10.10.0.4', 24)
    .done();
}

export const predictVlanWalls = predictProblem({
  slug: 'predict-vlan-walls',
  version: 1,
  title: 'Walls inside a switch',
  topic: 'VLANs',
  difficulty: 'easy',
  statement:
    'Two switches are joined by a trunk. The Sales PCs sit in VLAN 10 and the HR PCs in VLAN 20. Whoever addressed the PCs put all four in the same IP subnet, 10.10.0.0/24. There is no router.\n\nSay what each ping will do.',
  questions: [
    { id: 'same-vlan-far', prompt: 'Sales1 pings Sales2 (10.10.0.3), which is on the other switch.', traffic: { kind: 'ping', from: 'Sales1', to: '10.10.0.3' }, choices: ['success', 'unreachable', 'lost'], explanation: 'Both are in VLAN 10. The trunk carries frames of every VLAN between the switches, each tagged with its VLAN number, so S2 knows the frame belongs to VLAN 10 and delivers it to Sales2.' },
    { id: 'other-vlan-near', prompt: 'Sales1 pings HR1 (10.10.0.2), which is on the same switch, one port away.', traffic: { kind: 'ping', from: 'Sales1', to: '10.10.0.2' }, choices: ['success', 'unreachable', 'lost'], explanation: 'Sales1 believes HR1 is a neighbour (same subnet) and ARPs for it. The ARP broadcast is flooded only inside VLAN 10, and HR1\'s port is in VLAN 20, so nobody answers. With no MAC address to send to, the ping fails as "host unreachable". Being on the same switch and in the same subnet does not help: a VLAN is a separate layer 2 network.' },
    { id: 'hr-far', prompt: 'HR1 pings HR2 (10.10.0.4) on the other switch.', traffic: { kind: 'ping', from: 'HR1', to: '10.10.0.4' }, choices: ['success', 'unreachable', 'lost'], explanation: 'Same reasoning as the first question, in VLAN 20. The one trunk cable carries both VLANs side by side and keeps them apart.' },
  ],
  layout: vlanWalls().layout,
  start: () => vlanWalls().topology,
});

// ---------------------------------------------------------------- easy: ping is not a service

export const predictPingVsPort = predictProblem({
  slug: 'predict-ping-vs-port',
  version: 1,
  title: 'It pings, so it works?',
  topic: 'Applications',
  difficulty: 'easy',
  statement:
    'Server1 (10.0.2.10) runs a web server on TCP port 80. Its FTP service (TCP port 21) is switched off. There is no firewall or access list anywhere.\n\nSay what PC1 will see in each case.',
  questions: [
    { id: 'ping', prompt: 'PC1 pings 10.0.2.10.', traffic: { kind: 'ping', from: 'PC1', to: '10.0.2.10' }, choices: ['success', 'refused', 'unreachable', 'lost'], explanation: 'Ping is ICMP. It is answered by the server\'s IP stack and tells you the path works in both directions. It says nothing about any service.' },
    { id: 'web', prompt: 'PC1 opens a TCP connection to 10.0.2.10 port 80.', traffic: { kind: 'tcp', from: 'PC1', to: '10.0.2.10', port: 80 }, choices: ['success', 'refused', 'unreachable', 'lost'], explanation: 'The web service is listening on port 80, so the server answers PC1\'s SYN with SYN-ACK and the three-way handshake completes.' },
    { id: 'ftp', prompt: 'PC1 opens a TCP connection to 10.0.2.10 port 21.', traffic: { kind: 'tcp', from: 'PC1', to: '10.0.2.10', port: 21 }, choices: ['success', 'refused', 'unreachable', 'lost'], explanation: 'The SYN reaches the server, but nothing listens on port 21, so the server answers with a TCP reset (RST). The client reports "connection refused", and it does so immediately. That speed is the clue: a refusal means the host is alive and reachable and only the service is missing. A firewall silently dropping the SYN would look like a timeout instead.' },
  ],
  layout: twoLans().done().layout,
  start: () => twoLans().done().topology,
});

// ---------------------------------------------------------------- medium: the way back

/** R1 and R3 point a default route at R2. R2 knows the 10.3 LAN but has no route to the 10.1 LAN. */
const oneWay = () => threeInARow().route('R1', '0.0.0.0', 0, '10.0.12.2').route('R3', '0.0.0.0', 0, '10.0.23.1').route('R2', '10.3.0.0', 24, '10.0.23.2').done();

export const predictWayBack = predictProblem({
  slug: 'predict-the-way-back',
  version: 1,
  title: 'The way back',
  topic: 'Routing',
  difficulty: 'medium',
  statement:
    'Three routers in a row, static routes only:\n\nR1: default route to R2 (10.0.12.2).\nR2: a route to 10.3.0.0/24 through R3 (10.0.23.2). Nothing else.\nR3: default route to R2 (10.0.23.1).\n\nPC1 is 10.1.0.10 behind R1 and PC3 is 10.3.0.10 behind R3. R2 has no route to PC1\'s LAN, 10.1.0.0/24. Say what each ping will do. Follow the request, then follow the reply.',
  questions: [
    { id: 'pc1-pc3', prompt: 'PC1 pings PC3 (10.3.0.10).', traffic: { kind: 'ping', from: 'PC1', to: '10.3.0.10' }, choices: ['success', 'unreachable', 'lost'], explanation: 'The request gets all the way: R1 uses its default route, R2 knows 10.3.0.0/24, R3 delivers. PC3 replies to 10.1.0.10. R3 sends that to R2 by its default route, and R2 has no route to 10.1.0.0/24, so it drops the reply. PC1 sees a timeout, and its request did reach PC3.' },
    { id: 'pc3-pc1', prompt: 'PC3 pings PC1 (10.1.0.10).', traffic: { kind: 'ping', from: 'PC3', to: '10.1.0.10' }, choices: ['success', 'unreachable', 'lost'], explanation: 'This time the request itself dies at R2, which has no route to 10.1.0.0/24. A router that drops a packet for lack of a route tells the sender with an ICMP "destination unreachable", and R2 does have a route back to PC3 (10.3.0.0/24), so PC3 gets that message. Same missing route as before, different symptom, because of where the sender sits.' },
    { id: 'pc1-r2', prompt: 'PC1 pings R2\'s nearest address, 10.0.12.2.', traffic: { kind: 'ping', from: 'PC1', to: '10.0.12.2' }, choices: ['success', 'unreachable', 'lost'], explanation: 'R2 receives the request on a directly connected network. To reply it must route to 10.1.0.10, and it has no route for that. The reply is never sent. Being one hop from a router does not mean it can answer you: it still needs a route to your network.' },
    { id: 'pc1-nowhere', prompt: 'PC1 pings 10.9.9.9, an address that exists nowhere.', traffic: { kind: 'ping', from: 'PC1', to: '10.9.9.9' }, choices: ['success', 'unreachable', 'lost'], explanation: 'R1 forwards it by default route to R2. R2 has no route for 10.9.9.9 and wants to send "destination unreachable" back to 10.1.0.10, but it has no route to PC1 either, so even the error message cannot be delivered. PC1 hears nothing at all.' },
  ],
  layout: threeInARow().done().layout,
  start: () => oneWay().topology,
});

// ---------------------------------------------------------------- medium: reading an ACL

/** The office edge with PAT and ACL 110 inbound on the LAN port. */
const filteredEdge = () =>
  officeEdge()
    .acl('R1', '1', 'standard', 'permit 192.168.1.0 0.0.0.255')
    .nat('R1', (port) => ({ statics: [], overload: { acl: '1', outsideInterfaceId: port('GigabitEthernet0/1') } }))
    .opts('R1', 'GigabitEthernet0/0', { nat: 'inside', aclIn: '110' })
    .opts('R1', 'GigabitEthernet0/1', { nat: 'outside' })
    .acl('R1', '110', 'extended', 'deny tcp host 192.168.1.11 any eq 80', 'permit tcp 192.168.1.0 0.0.0.255 any eq 80', 'permit icmp any any')
    .done();

export const predictAclOrder = predictProblem({
  slug: 'predict-acl-first-match',
  version: 1,
  title: 'First match wins',
  topic: 'NAT & ACL',
  difficulty: 'medium',
  statement:
    'R1 does PAT for the office (192.168.1.0/24) and has this access list applied inbound on its LAN port Gi0/0:\n\naccess-list 110 deny tcp host 192.168.1.11 any eq 80\naccess-list 110 permit tcp 192.168.1.0 0.0.0.255 any eq 80\naccess-list 110 permit icmp any any\n\nPC1 is 192.168.1.10 and PC2 is 192.168.1.11. The public web server is 203.0.113.80; it serves web pages on port 80 and accepts SSH on port 22. ISP-PC (203.0.113.50) is an outside host with no gateway.',
  questions: [
    { id: 'pc1-web', prompt: 'PC1 opens TCP port 80 on 203.0.113.80.', traffic: { kind: 'tcp', from: 'PC1', to: '203.0.113.80', port: 80 }, choices: ['success', 'refused', 'prohibited', 'lost'], explanation: 'Line 1 is about host .11 only, so it does not match PC1. Line 2 permits TCP 80 from the office subnet. R1 then translates the source to 203.0.113.1 and the server answers that public address.' },
    { id: 'pc2-web', prompt: 'PC2 opens TCP port 80 on 203.0.113.80.', traffic: { kind: 'tcp', from: 'PC2', to: '203.0.113.80', port: 80 }, choices: ['success', 'refused', 'prohibited', 'lost'], explanation: 'An ACL is read top down and stops at the first line that matches. Line 1 matches PC2 and denies. Line 2 would also match and permit, but it is never reached. R1 drops the packet and returns "administratively prohibited".' },
    { id: 'pc1-ssh', prompt: 'PC1 opens TCP port 22 on 203.0.113.80.', traffic: { kind: 'tcp', from: 'PC1', to: '203.0.113.80', port: 22 }, choices: ['success', 'refused', 'prohibited', 'lost'], explanation: 'No line mentions port 22, so the packet falls through to the invisible last line every ACL has: deny everything. R1 blocks it and returns "administratively prohibited". The server would have accepted the connection, but the packet never gets that far. The usual mistake is to read the list as "deny these, allow the rest"; it is the opposite.' },
    { id: 'pc2-ping', prompt: 'PC2 pings 203.0.113.80.', traffic: { kind: 'ping', from: 'PC2', to: '203.0.113.80' }, choices: ['success', 'unreachable', 'prohibited', 'lost'], explanation: 'Line 1 denies PC2 only for TCP port 80. A ping is ICMP, so lines 1 and 2 do not match and line 3 permits it. Blocking one service for a host does not cut it off.' },
    { id: 'outside-in', prompt: 'ISP-PC pings PC1\'s private address, 192.168.1.10.', traffic: { kind: 'ping', from: 'ISP-PC', to: '192.168.1.10' }, choices: ['success', 'unreachable', 'prohibited', 'lost'], explanation: 'This has nothing to do with the ACL. 192.168.1.10 is not in ISP-PC\'s subnet and ISP-PC has no gateway, so it cannot even send the packet. That mirrors the real Internet, where private addresses are not routed: outside hosts can only talk to the office\'s public address.' },
  ],
  layout: officeEdge().done().layout,
  start: () => filteredEdge().topology,
});

// ---------------------------------------------------------------- hard: longest match and a loop

/**
 * R2 has a correct /24 route to the 10.3 LAN and a leftover, more specific
 * /25 for its upper half pointing back at R1, whose default route points at R2.
 */
const leftoverRoute = () =>
  threeInARow()
    .route('R1', '0.0.0.0', 0, '10.0.12.2')
    .route('R3', '0.0.0.0', 0, '10.0.23.1')
    .route('R2', '10.1.0.0', 24, '10.0.12.1')
    .route('R2', '10.3.0.0', 24, '10.0.23.2')
    .route('R2', '10.3.0.128', 25, '10.0.12.1')
    .done();

export const predictLongestMatch = predictProblem({
  slug: 'predict-longest-match',
  version: 1,
  title: 'The leftover route',
  topic: 'Routing',
  difficulty: 'hard',
  statement:
    'Static routes only:\n\nR1: default route to R2 (10.0.12.2).\nR3: default route to R2 (10.0.23.1).\nR2: 10.1.0.0/24 via R1 (10.0.12.1)\nR2: 10.3.0.0/24 via R3 (10.0.23.2)\nR2: 10.3.0.128/25 via R1 (10.0.12.1), left over from an old migration.\n\nPC1 is 10.1.0.10 behind R1. PC3 is 10.3.0.10 behind R3 and is the only host on 10.3.0.0/24. Say what PC1 sees for each ping.',
  questions: [
    { id: 'low-host', prompt: 'PC1 pings PC3 (10.3.0.10).', traffic: { kind: 'ping', from: 'PC1', to: '10.3.0.10' }, choices: ['success', 'unreachable', 'ttl-exceeded', 'lost'], explanation: '10.3.0.10 is in 10.3.0.0/24 but not in 10.3.0.128/25 (that covers .128 to .255), so only the /24 matches and R2 sends it to R3. The reply comes back through R2\'s route to 10.1.0.0/24. The leftover route does no harm to this address.' },
    { id: 'high-half', prompt: 'PC1 pings 10.3.0.200.', traffic: { kind: 'ping', from: 'PC1', to: '10.3.0.200' }, choices: ['success', 'unreachable', 'ttl-exceeded', 'lost'], explanation: 'Both the /24 and the /25 match 10.3.0.200. A router always uses the longest (most specific) prefix, so R2 picks the /25 and sends the packet back to R1. R1 only has a default route, which points at R2. The packet bounces between them, each hop taking 1 off its TTL, until a router sees the TTL reach 0, drops it and reports "time exceeded" to PC1. That message is how a routing loop shows up in a ping.' },
    { id: 'low-empty', prompt: 'PC1 pings 10.3.0.99, where no host exists.', traffic: { kind: 'ping', from: 'PC1', to: '10.3.0.99' }, choices: ['success', 'unreachable', 'ttl-exceeded', 'lost'], explanation: '.99 is in the lower half, so routing is correct all the way to R3, which is directly connected to 10.3.0.0/24. R3 ARPs for 10.3.0.99 and nobody answers. Routing worked; the last hop could not find the host. R3 reports "host unreachable" back to PC1.' },
    { id: 'no-route', prompt: 'PC1 pings 10.7.7.7.', traffic: { kind: 'ping', from: 'PC1', to: '10.7.7.7' }, choices: ['success', 'unreachable', 'ttl-exceeded', 'lost'], explanation: 'R1 forwards by default route to R2. R2 has no default route and no prefix that covers 10.7.7.7, so it drops the packet and sends "destination unreachable" to PC1, which it can reach through its route to 10.1.0.0/24. Compare with the previous question: the same word on PC1\'s screen, produced by a different router for a different reason.' },
  ],
  layout: threeInARow().done().layout,
  start: () => leftoverRoute().topology,
});

export const PREDICTS = [predictLocalOrRemote, predictVlanWalls, predictPingVsPort, predictWayBack, predictAclOrder, predictLongestMatch];
