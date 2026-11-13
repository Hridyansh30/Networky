// A configuration check: a switch port is an access port in a VLAN.
import { z } from 'zod';
import type { CheckPlugin } from '../types';
import { hostname } from './common';

const schema = z.object({ switch: hostname, port: z.string().min(1).max(64), vlan: z.number().int().min(1).max(4094) }).strict();
type Params = z.infer<typeof schema>;

export const accessVlanCheck: CheckPlugin<Params> = {
  kind: 'accessVlan',
  schema,
  behaviour: false,
  describe: (p) => `${p.switch} ${p.port} is an access port in VLAN ${p.vlan}`,
  run(ctx, p) {
    const sw = ctx.device(p.switch);
    if (!sw) return { pass: false, detail: `There is no device named ${p.switch}.` };
    const port = ctx.port(sw, p.port);
    if (!port) return { pass: false, detail: `${p.switch} has no port ${p.port}.` };
    const sp = port.switchport ?? { mode: 'access', accessVlan: 1 };
    if (sp.mode !== 'access') return { pass: false, detail: `${p.switch} ${p.port} is a trunk, not an access port.` };
    if (sp.accessVlan !== p.vlan) return { pass: false, detail: `${p.switch} ${p.port} is in VLAN ${sp.accessVlan}, not ${p.vlan}.` };
    return { pass: true, detail: `${p.switch} ${p.port} is in VLAN ${p.vlan}.` };
  },
};
