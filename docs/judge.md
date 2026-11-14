# The server judge (phase 6)

Phase 5 graded everything in the browser. That is fine for practice and
useless for a leaderboard: anything the browser stores, the learner can edit.
Phase 6 adds a small server whose one job is to be the only writer of
verdicts, solves, XP and counts.

The rule it is built around came from Kavya's review: **the server must
refuse to trust a client that says "I solved 12 problems" and count from its
own database instead.** Every design choice below follows from that rule.

## What runs where

```
 browser (React app, same as phase 5)          Cloudflare Pages (free plan)
 ─────────────────────────────────────         ──────────────────────────────────────
 Run      → grades locally, records nothing    static files (dist/)  ← never wake the worker
 Submit   → POST network ───────────────────▶  dist/_worker.js  (/api/* only, _routes.json)
 Hint     → POST "next hint for R2" ────────▶     Hono app, server/app.ts
 Answer   → POST "my answer is X" ──────────▶     grade() = the SAME pure function the browser runs
 Solution → POST "open it" ─────────────────▶     D1 (SQLite) ← the only record that counts
 XP bar, rank, leaderboard ◀─────────────────     numbers rebuilt from submissions
```

- `src/` is the app and the shared core (model, engine, grading, problems).
  The core is pure: no `Date.now`, no `Math.random`, no DOM. A test
  (`src/core.boundary.test.ts`) walks its imports and fails if that changes.
- `server/` is the API: `app.ts` wires the routes, `routes/*.ts` hold them,
  `judge.ts` holds the cache rebuild, `auth.ts` sign-in and sessions,
  `db/` the database interface (D1 in production, `node:sqlite` in tests and
  `npm run dev`).
- `migrations/` is the schema.

## The decisions, and why

**Same-origin API under `/api/v1`, served by the same Pages project.** One
origin means the session cookie needs no CORS rules and no `SameSite=None`.
`_routes.json` sends only `/api/*` to the worker, so the pages, scripts and
images are plain static files that never count against the free plan's
100,000 worker requests a day.

**The client sends actions, never results.** The phase 5 plan said "an HTTP
version of the progress repository". That interface is `put(row)`, and a row
holds `solved`, `best` and the hint count: an HTTP `put(row)` is the client
telling the server its score. So signed-in mode swaps the *actions* instead
(`src/store/remoteProgress.ts`): "here is my network", "show me the next
hint", "my answer is X". The server decides what each one is worth.

**Re-grade on submit, synchronously.** A grade takes 1 to 3 ms once the
engine is warm and the networks are 2.5 to 7 KB, so there is no queue: the
request grades and answers. The worker grades a tiny problem at load time
(`warmUp()` in `server/worker.ts`) so the JIT compile cost lands in the
startup budget (1 s), not in someone's Submit (10 ms of CPU on the free plan).

**A work budget instead of a timeout.** A wall-clock limit gives a different
verdict on a slower machine. The simulation counts work (steps plus frames
delivered) and stops at 3,000 units; the busiest real network needs 146.
Same network, same verdict, in the browser and on the server.

**Deterministic builds.** Ids and MACs during grading come from a seeded
source (`src/model/ids.ts`), so the server and the browser build identical
networks. `ENGINE_VERSION` (now `2`) is sent on every API answer
(`X-Engine-Version`); a tab running an older engine shows "Networky was
updated, reload".

**The server draws the seed.** Randomized problems get their variant from
the server when an attempt starts. A client that picked its own seed could
retry until it got an easy one.

**Records and caches.** `submissions`, `hint_unlocks`, `predict_answers` and
`attempts` are records: what happened. `user_problem`, `user_stats` and
`problem_stats` are caches: what it adds up to. Every write rebuilds the
caches for that user and problem *from the records*, in the same D1 batch
(`rebuild()` in `server/judge.ts`). There is no `xp = xp + 10` anywhere, so a
retried request or a race can never count something twice; running the
rebuild again changes nothing (tested).

**Why D1 batches and not transactions.** D1 has no interactive transactions
(BEGIN, read, decide, write). `batch()` runs a list of statements atomically,
so every write is phrased as statements that decide inside SQL (`INSERT ...
ON CONFLICT`, `MAX(level, excluded.level)`, `COALESCE`).

**Idempotent submits.** The client sends a random UUID per Submit. A retry
after a dropped connection sends the same one and gets the first answer
back, instead of a second submission.

**Hidden tests stay hidden in the answer.** The report the server returns
has no details for hidden tests (`redact()`), so Submit cannot be used to
read them one by one.

**XP that can be audited.** `xp_events` is a ledger of every XP change, so
the weekly board is a `SUM` over this week's events and any user's total can
be explained line by line.

**Acceptance only after 20 learners.** One learner's three failures would
read as "25%". The Problems page shows the rate once 20 people tried.

## Sign-in

GitHub OAuth only (the audience already has accounts; one provider is one
flow to secure). The flow uses `state` and PKCE. After the callback the
server creates a random session token, sends it in a cookie and stores only
its SHA-256: a leaked database does not leak sessions.

Cookie: `__Host-session`, `HttpOnly`, `Secure`, `SameSite=Lax`, 30 days,
extended while used. `__Host-` means it is bound to this exact host, over
HTTPS, with no `Domain` attribute that a subdomain could abuse.

Every non-GET request must carry an `Origin` header equal to the app's
origin. Together with `SameSite=Lax`, that stops another site from making a
signed-in learner's browser submit, unlock hints or open solutions.

## Threat model

| Threat | What stops it | Left over |
| --- | --- | --- |
| Editing local storage or the store to claim solves or XP | The server never reads them. Solves come only from its own grade. | Nothing for ranked numbers. Guest XP stays editable, and that is fine. |
| Sending a fake score or seed | No endpoint accepts one. Seeds are drawn by the server. | The one-time import accepts a seed, once per problem, because the saved network was built for it. |
| Reading hidden tests through Submit | Hidden results carry no detail. | **The first 36 problems are open book**: the repo is public, so their tests are on GitHub. Decided on purpose; new problems go to the private repo. |
| Copying someone else's network | Nothing technical. Passing networks are hashed (`network_hash`), so copying is detectable later. | Phase 8 (contests) needs more. |
| Predict problems: running the ping first | Nothing; the engine is in the browser. | Known (docs/deferred.md). |
| CSRF | `SameSite=Lax` plus the `Origin` check on every non-GET. | |
| XSS stealing the session | `HttpOnly` cookie, CSP `script-src 'self'`, no inline scripts, React text rendering. | |
| A huge or hostile network | 160 KB body cap, checked before parsing; device cap (start + 8, at most 32); strict zod schemas; the work budget. | On the free plan a network that runs the full 3,000 units can exceed 10 ms of CPU; Cloudflare then ends the request with an error and nothing is written. Watch the worker's CPU time in the dashboard after launch. |
| Flooding submits or attempts | 10 submits a minute, 10 new attempts a day per problem. | Counted with a read then a write, so a burst of parallel requests can slip a few past. Acceptable for a learning site. |
| A leaked database | Only session token hashes are stored. No passwords exist. | GitHub ids, handles and avatars are in it. |
| Dev sign-in reaching production | `devLogin` is set only by `server/devHandler.ts`; `scripts/check-worker.mjs` checks the built worker answers 404. | |
| Server code or private content in the web bundle | `scripts/check-bundle.mjs` fails CI if server-only strings show up in `dist/assets`. | |

## Private content

New problems can keep their hidden tests, reference and hints out of the
public repo:

1. The private repo (decided name: `networky-content`) has a `server.ts` that
   exports `PRIVATE_PROBLEMS` (full specs) and
   `CONTENT_PACK = 'networky-private-content:<version>'`.
2. CI checks it out next to this repo and builds the worker with
   `NETWORKY_PRIVATE_CONTENT=<that folder>`. `vite.worker.config.ts` then
   swaps `server/privateContent.ts` (empty here) for that file. Only the
   server build does this.
3. `/api/v1/meta` reports `contentPack`, so you can see which pack is
   deployed, and `check-bundle.mjs` fails if the marker reaches the web
   bundle.

What is **not** done yet: the web app also needs the *public half* of a
private problem (statement, start network, visible tests) in its catalog to
show it. That format is decided with the first private problem
(docs/deferred.md).

## API

All under `/api/v1`, JSON, cookie session. Errors are
`{ "error": "<code>", "message": "<for humans>" }`.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /meta` | anyone | engine version, problem count, content pack, `ready` (database bound), which sign-ins exist |
| `GET /me` | anyone | `{ user: null }`, or the user, stats, rank, import state and one row per problem |
| `GET /problems/stats` | anyone | tried, solvers and acceptance per problem; total solves. Cached 60 s. |
| `GET /leaderboard?period=all\|week&page=N` | anyone | 50 rows a page. Cached 60 s. |
| `GET /auth/github/start?return=/#/...` | anyone | redirect to GitHub |
| `GET /auth/github/callback` | GitHub | creates the session, redirects back |
| `POST /auth/logout` | user | ends the session |
| `GET /problems/:slug/attempt` | user | the active attempt (network, seed, hints, answers) |
| `POST /problems/:slug/attempts` | user | start or start over; the server draws the seed |
| `PUT /attempts/:id/network` | user | autosave of the draft (every 20 s and when the tab hides) |
| `POST /attempts/:id/submissions` | user | `{ submissionId, network }` → graded report, new progress |
| `POST /attempts/:id/hints` | user | `{ requirement }` → next hint level and its texts |
| `POST /attempts/:id/solution` | user | after a solve or 3 failed submits; costs the XP if unsolved |
| `POST /attempts/:id/answers` | user | `{ questionId, choice }` → final answer, with the real outcome |
| `GET /submissions?slug=` | user | the last 50 submissions |
| `POST /import/:slug` then `POST /import/done` | user | one-time import of browser progress (below) |

## Importing phase 5 progress

A learner who signs in for the first time is offered, once, to bring the
progress saved in this browser into the account. The rule: **the client may
report things that lower its score, never things that raise it.**

- Saved networks are graded again. Only a pass becomes a solve.
- Hints used and "solution opened first" are applied as reported (claiming
  fewer is the only possible lie, and it only matters on a network that
  really passes).
- Predict answers are checked against the engine.
- The browser's own `solved`, `best` and XP are ignored.

One request per problem, because each runs the judge and a free request has
10 ms of CPU. `POST /import/done` closes the door for good.

## Running it

`npm run dev` serves the app and the API on one origin; the API uses
`.data/dev.sqlite` (git-ignored) and offers a "Dev sign in" box instead of
GitHub. `npm test` runs everything, including `server/__tests__/client.test.ts`,
which drives the real client stores against the real API in one process.

Production setup (GitHub app, D1, secrets): [server-setup.md](server-setup.md).

## Things worth being able to explain

1. Why is "the server re-grades" enough, and why must Run stay local? (The
   verdict that counts is computed where the learner cannot edit it. Run
   records nothing, so it costs the server nothing.)
2. Why rebuild caches from records instead of incrementing? (Idempotence: a
   retry or a race cannot double count, and the rebuild can be re-run to
   repair anything.)
3. Why store a hash of the session token? (A database leak then does not
   let anyone sign in as anyone.)
4. Why does the server, not the client, choose the random seed? (Otherwise
   a client re-rolls until it gets an easy variant.)
5. Why is a wall-clock timeout wrong for a judge? (It makes the verdict
   depend on the machine.)
6. What does `SameSite=Lax` stop, and why add an `Origin` check anyway?
   (Lax blocks cross-site POSTs carrying the cookie in modern browsers; the
   Origin check covers older ones and same-site subdomains.)
7. Why one import request per problem? (A per-request CPU limit. Many small
   bounded requests beat one unbounded one.)
