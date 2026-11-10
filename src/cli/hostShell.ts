// The command prompt on PCs, laptops and servers (the Desktop tab), modelled
// on the Windows commands Packet Tracer also uses: ping, tracert, ipconfig,
// arp -a. Like the IOS CLI it only reads the model and the simulation.

import { leasesOf } from '../engine/plugins/dhcp';
import { globalOf, ipv6Enabled, linkLocalOf, slaacOf } from '../engine/plugins/ipv6';
import { prefixToMask } from '../model/ip';
import type { CliEnv } from './ios';
import { tokenize } from './parse';

export const HOST_PROMPT = 'C:\\>';

const HELP = [
  'Available commands:',
  '  ping <address>        send 4 ICMP echo requests (IPv4 or IPv6)',
  '  tracert <address>     list the routers on the way',
  '  ipconfig [/all]       show this computer\'s addresses',
  '  arp -a                show the ARP cache',
  '  connect <addr> <port> test a TCP connection (e.g. connect 10.0.0.5 80)',
  '  help                  this list',
];

const msg = (status: string) =>
  ({
    unreachable: 'Destination host unreachable.',
    prohibited: 'Destination net unreachable (administratively prohibited).',
    'ttl-exceeded': 'TTL expired in transit.',
    lost: 'Request timed out.',
    pending: 'Request timed out.',
    refused: 'Connection refused.',
  })[status] ?? 'Request timed out.';

export function runHostCommand(deviceId: string, line: string, env: CliEnv): string[] {
  const t = env.topology();
  const device = t.devices[deviceId];
  const [cmd, ...args] = tokenize(line);
  if (!cmd) return [];
  const sim = env.sim();
  const ifs = device.interfaceIds.map((id) => t.interfaces[id]);

  switch (cmd.toLowerCase()) {
    case 'help':
    case '?':
      return HELP;

    case 'ping': {
      const dst = args.find((a) => !a.startsWith('-'));
      if (!dst) return ['Usage: ping <address>'];
      const out = ['', `Pinging ${dst} with 32 bytes of data:`, ''];
      let ok = 0;
      const rtts: number[] = [];
      for (let seq = 1; seq <= 4; seq++) {
        const p = env.probe({ kind: 'ping', sourceDeviceId: deviceId, destination: dst, seq });
        if (p.status === 'success') {
          ok++;
          rtts.push(p.rttTicks ?? 0);
          out.push(`Reply from ${dst}: bytes=32 time=${p.rttTicks ?? 0}ms`);
        } else if (p.respondent && p.respondent !== dst) out.push(`Reply from ${p.respondent}: ${msg(p.status)}`);
        else if (p.status === 'unreachable' && !p.respondent) {
          out.push(`${msg(p.status)} (${p.detail})`);
        } else out.push(msg(p.status));
      }
      out.push('', `Ping statistics for ${dst}:`, `    Packets: Sent = 4, Received = ${ok}, Lost = ${4 - ok} (${(4 - ok) * 25}% loss),`);
      if (ok) out.push('Approximate round trip times in milli-seconds:', `    Minimum = ${Math.min(...rtts)}ms, Maximum = ${Math.max(...rtts)}ms, Average = ${Math.round(rtts.reduce((a, b) => a + b, 0) / ok)}ms`);
      return out;
    }

    case 'tracert':
    case 'traceroute': {
      if (!args[0]) return ['Usage: tracert <address>'];
      const out = ['', `Tracing route to ${args[0]} over a maximum of 16 hops:`, ''];
      for (const h of env.traceroute(deviceId, args[0])) {
        if (h.status === 'no-answer') out.push(`${String(h.ttl).padStart(3)}     *        *        *     Request timed out.`);
        else out.push(`${String(h.ttl).padStart(3)}     ${h.address}${h.status === 'unreachable' ? '  reports: Destination host unreachable.' : ''}`);
      }
      out.push('', 'Trace complete.');
      return out;
    }

    case 'ipconfig': {
      const all = args[0]?.toLowerCase() === '/all';
      const out: string[] = [];
      for (const i of ifs) {
        const ip = sim.ipv4Of(i);
        const lease = leasesOf(sim)[i.id];
        const gw = lease?.router ?? device.defaultGateway;
        out.push('', `${i.name} Connection:`, '');
        if (all) out.push(`   Physical Address................: ${i.mac.toUpperCase().replace(/:/g, '-')}`, `   DHCP Enabled....................: ${i.dhcp ? 'Yes' : 'No'}`);
        if (ipv6Enabled(sim, i)) {
          out.push(`   Link-local IPv6 Address.........: ${linkLocalOf(i)}`);
          const g = globalOf(sim, i);
          if (g) out.push(`   IPv6 Address....................: ${g.address}${slaacOf(sim, i.id) ? ' (SLAAC)' : ''}`);
        }
        if (ip) out.push(`   IPv4 Address....................: ${ip.address}`, `   Subnet Mask.....................: ${prefixToMask(ip.prefixLength)}`);
        else out.push(`   IPv4 Address....................: ${i.dhcp ? '0.0.0.0 (DHCP request failed)' : 'not set'}`);
        out.push(`   Default Gateway.................: ${gw ?? ''}`);
        const gw6 = device.defaultGatewayV6 ?? slaacOf(sim, i.id)?.router;
        if (gw6) out.push(`   IPv6 Default Gateway............: ${gw6}`);
        if (all && lease) out.push(`   DHCP Server.....................: ${lease.server}`, `   DNS Server......................: ${lease.dns ?? ''}`);
      }
      return out;
    }

    case 'arp': {
      if (args[0] !== '-a') return ['Usage: arp -a'];
      const entries = Object.entries(sim.arp[deviceId] ?? {});
      if (!entries.length) return ['No ARP Entries Found'];
      return ['  Internet Address      Physical Address      Type', ...entries.map(([ip, e]) => `  ${ip.padEnd(22)}${e.mac.replace(/:/g, '-').padEnd(22)}dynamic`)];
    }

    case 'connect': {
      const port = Number(args[1]);
      if (!args[0] || !Number.isInteger(port)) return ['Usage: connect <address> <port>'];
      const p = env.probe({ kind: 'tcp', sourceDeviceId: deviceId, destination: args[0], port });
      if (p.status === 'success') return [`Connected to ${args[0]}:${port} (SYN, SYN-ACK received).`];
      return [`Could not connect to ${args[0]}:${port}: ${p.detail ?? msg(p.status)}`];
    }

    default:
      return [`Invalid Command. Type 'help' for the list.`];
  }
}
