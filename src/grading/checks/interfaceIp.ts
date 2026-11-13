// A configuration check: a port has exactly this address. Use it only where
// the exact setting is the point (easy problems, or a fixed addressing plan);
// prefer behaviour checks everywhere else, because they accept every design
// that works.
import { z } from 'zod';
import type { CheckPlugin } from '../types';
import { cidr, hostname } from './common';

const schema = z.object({ device: hostname, port: z.string().min(1).max(64), address: cidr }).strict();
type Params = z.infer<typeof schema>;

export const interfaceIpCheck: CheckPlugin<Params> = {
  kind: 'interfaceIp',
  schema,
  behaviour: false,
  describe: (p) => `${p.device} ${p.port} is ${p.address}`,
  run(ctx, p) {
    const dev = ctx.device(p.device);
    if (!dev) return { pass: false, detail: `There is no device named ${p.device}.` };
    const port = ctx.port(dev, p.port);
    if (!port) return { pass: false, detail: `${p.device} has no port ${p.port}.` };
    const ip = port.ipv4;
    const got = ip ? `${ip.address}/${ip.prefixLength}` : undefined;
    if (got !== p.address) return { pass: false, detail: got ? `${p.device} ${p.port} is ${got}, not ${p.address}.` : `${p.device} ${p.port} has no IPv4 address.` };
    if (port.adminUp === false) return { pass: false, detail: `${p.device} ${p.port} has the right address but is shut down.` };
    return { pass: true, detail: `${p.device} ${p.port} is ${got}.` };
  },
};
