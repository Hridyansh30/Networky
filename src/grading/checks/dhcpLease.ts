// A host got its address from DHCP, inside the subnet the problem asks for.
import { z } from 'zod';
import { leasesOf } from '../../engine/plugins/dhcp';
import { inSubnet } from '../../model/ip';
import type { CheckPlugin } from '../types';
import { cidr, hostname } from './common';

const schema = z.object({ host: hostname, subnet: cidr }).strict();
type Params = z.infer<typeof schema>;

export const dhcpLeaseCheck: CheckPlugin<Params> = {
  kind: 'dhcpLease',
  schema,
  behaviour: true,
  describe: (p) => `${p.host} gets an address in ${p.subnet} from DHCP`,
  run(ctx, p) {
    const host = ctx.device(p.host);
    if (!host) return { pass: false, detail: `There is no device named ${p.host}.` };
    const [net, len] = p.subnet.split('/');
    const leases = leasesOf(ctx.sim);
    const lease = host.interfaceIds.map((id) => leases[id]).find(Boolean);
    if (!lease) {
      const usesDhcp = host.interfaceIds.some((id) => ctx.topology.interfaces[id].dhcp);
      return { pass: false, detail: usesDhcp ? `${p.host} asked for an address but no DHCP server answered. Is there a pool for its subnet, and a relay if the server is on another network?` : `${p.host} is not set to get its address from DHCP.` };
    }
    if (!inSubnet(lease.ip, net, Number(len))) return { pass: false, detail: `${p.host} got ${lease.ip}/${lease.prefixLength}, which is outside ${p.subnet}. Check which pool answered.` };
    return { pass: true, detail: `${p.host} leased ${lease.ip}/${lease.prefixLength} from ${lease.server}.` };
  },
};
