// A TCP connection test: does a SYN to this port get through and get answered?
import { z } from 'zod';
import type { CheckPlugin } from '../types';
import { expectation, hostname, ipv4, OUTCOME_WORDS, probeCheck } from './common';

const schema = z.object({ from: hostname, to: ipv4, port: z.number().int().min(1).max(65535), expect: expectation.default('success') }).strict();
type Params = z.infer<typeof schema>;

export const tcpCheck: CheckPlugin<Params> = {
  kind: 'tcp',
  schema,
  behaviour: true,
  describe: (p) => `TCP ${p.from} → ${p.to}:${p.port} ${OUTCOME_WORDS[p.expect]}`,
  run: (ctx, p) => probeCheck(ctx, p.from, { kind: 'tcp', destination: p.to, port: p.port }, p.expect),
};
