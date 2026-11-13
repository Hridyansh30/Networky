// ping from a host to an address, with the outcome the problem requires.
import { z } from 'zod';
import type { CheckPlugin } from '../types';
import { address, expectation, hostname, OUTCOME_WORDS, probeCheck } from './common';

const schema = z.object({ from: hostname, to: address, expect: expectation.default('success') }).strict();
type Params = z.infer<typeof schema>;

export const reachCheck: CheckPlugin<Params> = {
  kind: 'reach',
  schema,
  behaviour: true,
  describe: (p) => `ping ${p.from} → ${p.to} ${OUTCOME_WORDS[p.expect]}`,
  run: (ctx, p) => probeCheck(ctx, p.from, { kind: 'ping', destination: p.to }, p.expect),
};
