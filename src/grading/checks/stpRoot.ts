// A switch won the spanning-tree root election.
import { z } from 'zod';
import { formatBridge, stpOf } from '../../engine/plugins/stp';
import type { CheckPlugin } from '../types';
import { hostname } from './common';

const schema = z.object({ switch: hostname }).strict();
type Params = z.infer<typeof schema>;

export const stpRootCheck: CheckPlugin<Params> = {
  kind: 'stpRoot',
  schema,
  behaviour: true,
  describe: (p) => `${p.switch} is the spanning-tree root`,
  run(ctx, p) {
    const sw = ctx.device(p.switch);
    if (!sw || sw.kind !== 'switch') return { pass: false, detail: `There is no switch named ${p.switch}.` };
    if (!ctx.sim.plugin('stp')) return { pass: false, detail: 'Spanning tree is not running in this network.' };
    const s = stpOf(ctx.sim, sw);
    const isRoot = s.root.mac === s.bridge.mac && s.root.priority === s.bridge.priority;
    return isRoot ? { pass: true, detail: `${p.switch} is the root bridge (${formatBridge(s.bridge)}).` } : { pass: false, detail: `The root bridge is ${formatBridge(s.root)}, not ${p.switch} (${formatBridge(s.bridge)}). Lower priority wins; the lowest MAC breaks ties.` };
  },
};
