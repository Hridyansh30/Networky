// The one grading entry point the app uses, by slug: look the problem up in
// the catalog, rebuild the variant from its seed, grade. The worker and the
// main-thread fallback both call this, so they cannot disagree.
//
// It takes a slug, not a spec, because a spec holds functions (the networks
// are code) and functions cannot be posted to a worker. The phase 6 server
// judge will take the same request.

import type { Topology } from '../model/types';
import { problemBySlug } from '../problems/catalog';
import { instantiate } from '../problems/params';
import { grade } from './grade';
import type { GradeReport } from './types';

export interface GradeRequest {
  slug: string;
  seed?: number;
  scope: 'run' | 'submit';
  topology: Topology;
}

export function gradeProblem(req: GradeRequest): GradeReport {
  const spec = problemBySlug(req.slug);
  if (!spec) throw new Error(`Unknown problem '${req.slug}'`);
  const variant = instantiate(spec, req.seed);
  return grade(req.topology, variant, { scope: req.scope, seed: req.seed });
}
