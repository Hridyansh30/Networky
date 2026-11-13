// A router's routing table holds a route to a prefix, optionally learned a
// particular way (static, RIP, OSPF) or through a particular next hop.
import { z } from 'zod';
import type { CheckPlugin } from '../types';
import { cidr, hostname, ipv4 } from './common';

const schema = z
  .object({
    device: hostname,
    prefix: cidr,
    source: z.enum(['connected', 'static', 'rip', 'ospf']).optional(),
    via: ipv4.optional(),
  })
  .strict();
type Params = z.infer<typeof schema>;

export const routeCheck: CheckPlugin<Params> = {
  kind: 'route',
  schema,
  behaviour: false,
  describe: (p) => `${p.device} has a ${p.source ? `${p.source.toUpperCase() === 'RIP' || p.source === 'ospf' ? p.source.toUpperCase() : p.source} ` : ''}route to ${p.prefix}${p.via ? ` via ${p.via}` : ''}`,
  run(ctx, p) {
    const dev = ctx.device(p.device);
    if (!dev) return { pass: false, detail: `There is no device named ${p.device}.` };
    const [net, len] = p.prefix.split('/');
    const routes = ctx.sim.routes(dev.id).filter((r) => r.network === net && r.prefixLength === Number(len));
    if (!routes.length) return { pass: false, detail: `${p.device} has no route to ${p.prefix}.` };
    const fits = routes.find((r) => (!p.source || r.source === p.source) && (!p.via || r.nextHop === p.via));
    if (!fits) {
      const r = routes[0];
      return { pass: false, detail: `${p.device} reaches ${p.prefix} by ${r.source}${r.nextHop ? ` via ${r.nextHop}` : ''}, not ${[p.source, p.via && `via ${p.via}`].filter(Boolean).join(' ')}.` };
    }
    return { pass: true, detail: `${p.device} routes ${p.prefix} by ${fits.source}${fits.nextHop ? ` via ${fits.nextHop}` : ''}.` };
  },
};
