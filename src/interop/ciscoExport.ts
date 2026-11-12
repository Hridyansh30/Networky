// Export: the running-config of every router and switch, in one text file.
//
// This reuses cli/runningConfig.ts, the same code behind 'show running-config',
// so the export can never disagree with what the CLI shows. Each device's
// block can be pasted into a real router after 'configure terminal'.

import { runningConfig } from '../cli/runningConfig';
import type { Topology } from '../model/types';
import type { Exporter } from './types';

/** IOS config lines for one device, without the 'show run' banner lines. */
export function deviceConfig(t: Topology, deviceId: string): string[] {
  const lines = runningConfig(t, deviceId);
  const start = lines.findIndex((l) => l.startsWith('hostname '));
  return lines.slice(start);
}

export const ciscoExporter: Exporter = {
  id: 'cisco',
  title: 'Cisco IOS configuration',
  description: 'The running-config of every router and switch, ready to paste after "configure terminal".',
  language: 'Cisco IOS',
  export({ topology, name }) {
    const devices = Object.values(topology.devices)
      .filter((d) => d.kind === 'router' || d.kind === 'switch')
      .sort((a, b) => a.hostname.localeCompare(b.hostname));
    const notes: string[] = [];
    const hosts = Object.values(topology.devices).filter((d) => d.kind !== 'router' && d.kind !== 'switch' && d.kind !== 'hub');
    if (hosts.length) notes.push(`${hosts.length} PC/laptop/server ${hosts.length === 1 ? 'is' : 'are'} not included: they are not configured with IOS commands. Their addresses are listed as comments at the end.`);
    if (Object.keys(topology.links).length) notes.push('Cables are not part of a device configuration. Real routers learn their neighbours with CDP or LLDP; here the export only lists them as comments.');
    if (Object.values(topology.devices).some((d) => d.kind === 'hub')) notes.push('Hubs have no configuration and are left out.');
    if (!devices.length) notes.push('There are no routers or switches in this network, so there is nothing to configure.');

    const out = [`! Networky export: ${name}`, `! ${devices.length} device configuration${devices.length === 1 ? '' : 's'}. Each block starts at "hostname".`, '!'];
    for (const d of devices) out.push(`! ===== ${d.hostname} (${d.kind}) =====`, ...deviceConfig(topology, d.id), '');

    const ifName = (id: string) => {
      const i = topology.interfaces[id];
      return `${topology.devices[i.deviceId].hostname} ${i.name}`;
    };
    const links = Object.values(topology.links);
    if (links.length) {
      out.push('! ===== Cabling (for reference) =====');
      for (const l of links) out.push(`!   ${ifName(l.a)}  <->  ${ifName(l.b)}  (${l.cable})`);
      out.push('!');
    }
    if (hosts.length) {
      out.push('! ===== End devices (for reference) =====');
      for (const h of hosts.sort((a, b) => a.hostname.localeCompare(b.hostname))) {
        const addrs = h.interfaceIds
          .map((id) => topology.interfaces[id])
          .map((i) => (i.dhcp ? `${i.name} DHCP` : i.ipv4 ? `${i.name} ${i.ipv4.address}/${i.ipv4.prefixLength}` : null))
          .filter(Boolean);
        out.push(`!   ${h.hostname}: ${addrs.join(', ') || 'no address'}${h.defaultGateway ? `, gateway ${h.defaultGateway}` : ''}`);
      }
      out.push('!');
    }
    return { fileName: `${name}-cisco.txt`, mime: 'text/plain', text: out.join('\n') + '\n', notes };
  },
};
