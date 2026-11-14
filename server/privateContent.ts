// The private problems the judge knows about.
//
// Empty in the public repo. When NETWORKY_PRIVATE_CONTENT points at a
// checkout of the private content repo, the WORKER build (vite.worker.config.ts)
// swaps this file for that repo's `server.ts`, so hidden tests, references and
// hints of new problems never appear in this repository or in the web
// bundle. scripts/check-bundle.mjs fails the build if the pack's marker ever
// shows up in the web bundle. docs/judge.md explains the whole wiring.

import type { ProblemSpec } from '../src/problems/spec';

export const PRIVATE_PROBLEMS: readonly ProblemSpec[] = [];

/** Which content pack the server was built with; /api/v1/meta reports it. A private pack exports 'networky-private-content:<version>'. */
export const CONTENT_PACK: string = 'open';
