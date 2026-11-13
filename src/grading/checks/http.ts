// A web page load from a host's browser: DNS (if a name is used), then HTTP,
// through every ACL and NAT on the way, exactly as the Web Browser app does.
import { z } from 'zod';
import { browse } from '../../apps/client';
import { createDisk } from '../../engine/plugins/apps/disk';
import type { CheckPlugin } from '../types';
import { hostname } from './common';

const schema = z
  .object({
    from: hostname,
    url: z.string().min(1).max(200),
    expect: z.enum(['loads', 'fails']).default('loads'),
    /** Optional text the page must contain (case-insensitive), to prove it is the RIGHT server. */
    contains: z.string().min(1).max(100).optional(),
  })
  .strict();
type Params = z.infer<typeof schema>;

export const httpCheck: CheckPlugin<Params> = {
  kind: 'http',
  schema,
  behaviour: true,
  describe: (p) => (p.expect === 'loads' ? `${p.from} opens ${p.url}${p.contains ? ` and sees "${p.contains}"` : ''}` : `${p.from} cannot open ${p.url}`),
  replay: (p) => ({ kind: 'http', from: p.from, url: p.url }),
  run(ctx, p) {
    const src = ctx.device(p.from);
    if (!src) return { pass: false, detail: `There is no device named ${p.from}.` };
    const startTick = ctx.sim.tick;
    const r = browse(ctx.sim, createDisk(), src.id, p.url);
    if (!r.ok) {
      const pass = p.expect === 'fails';
      return { pass, detail: pass ? `${p.url} does not load from ${p.from}, as required.` : `${p.url} does not load from ${p.from}. ${r.error}`, dropAt: pass ? undefined : ctx.dropSince(startTick) };
    }
    if (p.expect === 'fails') return { pass: false, detail: `${p.from} can still open ${p.url}; it should be blocked.` };
    const text = `${r.value.title}\n${r.value.body}`.toLowerCase();
    if (p.contains && !text.includes(p.contains.toLowerCase())) return { pass: false, detail: `${p.url} loads, but it is not the expected page (no "${p.contains}"). Is the name pointing at the right server?` };
    return { pass: true, detail: `${p.from} opens ${p.url} (HTTP ${r.value.status}).` };
  },
};
