// Pieces shared by the check plugins.

import { z } from 'zod';
import { explainFailure } from '../../apps/client';
import type { Probe, ProbeRequest, ProbeStatus } from '../../engine/plugin';
import { isValidIPv4 } from '../../model/ip';
import { isValidIPv6 } from '../../model/ip6';
import type { CheckResult, GradeContext } from '../types';

export const hostname = z.string().min(1).max(64);
export const ipv4 = z.string().refine(isValidIPv4, 'not an IPv4 address');
/** A probe destination: IPv4 or IPv6. */
export const address = z.string().max(45).refine((s) => isValidIPv4(s) || isValidIPv6(s), 'not an IP address');
export const cidr = z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, 'expected a.b.c.d/len').refine((s) => {
  const [a, len] = s.split('/');
  return isValidIPv4(a) && Number(len) <= 32;
}, 'not a valid prefix');

/** The outcomes a learner can be asked to produce. 'pending' never ends a test. */
export const expectation = z.enum(['success', 'refused', 'unreachable', 'prohibited', 'ttl-exceeded', 'lost']);
export type Expectation = z.infer<typeof expectation>;

export const OUTCOME_WORDS: Record<Expectation, string> = {
  success: 'succeeds',
  refused: 'is refused',
  unreachable: 'is unreachable',
  prohibited: 'is blocked by an ACL',
  'ttl-exceeded': 'runs out of TTL',
  lost: 'gets no answer',
};

const SHOULD: Record<Expectation, string> = {
  success: 'succeed',
  refused: 'be refused',
  unreachable: 'be unreachable',
  prohibited: 'be blocked by an ACL',
  'ttl-exceeded': 'run out of TTL',
  lost: 'get no answer',
};

const statusWords = (s: ProbeStatus) => (s === 'pending' ? 'did not finish' : OUTCOME_WORDS[s]);

/** Send a probe from a named host and compare the outcome with what the test expects. */
export function probeCheck(ctx: GradeContext, from: string, request: Omit<ProbeRequest, 'sourceDeviceId'>, expect: Expectation): CheckResult {
  const src = ctx.device(from);
  if (!src) return { pass: false, detail: `There is no device named ${from}.` };
  const startTick = ctx.sim.tick;
  const p: Probe = ctx.probe({ ...request, sourceDeviceId: src.id });
  const pass = p.status === expect;
  const what = request.kind === 'tcp' ? `TCP ${from} → ${request.destination}:${request.port}` : `ping ${from} → ${request.destination}`;
  if (pass) return { pass, detail: `${what} ${statusWords(p.status)}, as required.` };
  const why = p.status === 'success' ? '' : ` ${explainFailure(p)}`;
  return {
    pass,
    detail: `${what} ${statusWords(p.status)}, but it should ${SHOULD[expect]}.${why}`,
    dropAt: p.status === 'success' ? undefined : (respondentDrop(ctx, p) ?? ctx.dropSince(startTick)),
  };
}

/** A router that answered with an ICMP error (ACL, no route, TTL) is where the packet died. */
function respondentDrop(ctx: GradeContext, p: Probe) {
  if (!p.respondent || p.respondent === p.destination) return undefined;
  const owner = Object.values(ctx.topology.interfaces).find((i) => i.ipv4?.address === p.respondent || i.ipv6?.address === p.respondent);
  const device = owner ? ctx.topology.devices[owner.deviceId]?.hostname : undefined;
  return device ? { device, reason: explainFailure(p) } : undefined;
}
