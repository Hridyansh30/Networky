// The protocols the simulation panel can filter and the colour each one has.
// Colours come from tokens.css so the canvas, the event table and the legend
// always agree.

export type ProtocolKey = 'arp' | 'icmp' | 'dhcp' | 'rip' | 'ospf' | 'stp' | 'tcp' | 'ndp' | 'app';

export const PROTOCOLS: { key: ProtocolKey; label: string; color: string; title: string }[] = [
  { key: 'arp', label: 'ARP', color: 'var(--proto-arp)', title: 'Address Resolution Protocol: IPv4 address → MAC' },
  { key: 'icmp', label: 'ICMP', color: 'var(--proto-icmp)', title: 'Ping, traceroute and error messages (IPv4 and IPv6)' },
  { key: 'dhcp', label: 'DHCP', color: 'var(--proto-dhcp)', title: 'Automatic address assignment' },
  { key: 'rip', label: 'RIP', color: 'var(--proto-rip)', title: 'Routing Information Protocol updates' },
  { key: 'ospf', label: 'OSPF', color: 'var(--proto-ospf)', title: 'OSPF hellos and link-state updates' },
  { key: 'stp', label: 'STP', color: 'var(--proto-stp)', title: 'Spanning Tree BPDUs' },
  { key: 'tcp', label: 'TCP', color: 'var(--proto-tcp)', title: 'TCP connection tests (SYN / SYN-ACK / RST)' },
  { key: 'ndp', label: 'NDP', color: 'var(--proto-ndp)', title: 'IPv6 Neighbor Discovery and SLAAC' },
  { key: 'app', label: 'App', color: 'var(--proto-app)', title: 'Application data: HTTP, DNS, SMTP, POP3, FTP and chat' },
];

/** Engine frame tag (sim.tagOf) -> filter protocol. */
export function protocolOfTag(tag: string): ProtocolKey {
  if (tag === 'icmp-error') return 'icmp';
  return (PROTOCOLS.some((p) => p.key === tag) ? tag : 'icmp') as ProtocolKey;
}

export const protocolInfo = (key: ProtocolKey) => PROTOCOLS.find((p) => p.key === key)!;
