# Profiles, stats and drills (phase 7)

Phase 7 adds two things on top of the phase 6 judge:

- **Drills** (`#/drills`): sets of 10 short questions, generated fresh from a
  seed, graded instantly. Problems teach a skill once; drills make it
  automatic. Signed in, right answers earn **practice XP** for the weekly board.
- **Profiles** (`#/u/<handle>`): one page with a public half anyone can see
  and a private half only its owner sees.

The plan this was built from (with the trade-offs argued out) is the phase 7
plan doc: https://claude.ai/artifact/PTcUteTVvTcEjkpseCmb1j

## Drills

### How a drill works

```
 kind + level + seed  ──generate()──▶  question  ──checkAnswer()──▶  right / wrong
        ▲                                                               │
        └──────── nextLevel(): 3 right in a row → up, 2 wrong → down ◀──┘
```

- Every drill kind is a plugin in `src/drills/kinds/`, registered in
  `src/drills/registry.ts`. A kind is pure: `generate(rng, level)` returns the
  same question for the same seed, so a question is rebuilt anywhere (the
  browser, the server, a test, a bug report) from three numbers.
- A set is `kind + start level + seed`. Question *i* is generated from
  `questionSeed(seed, i)` at the level the rule gives after questions
  0..i-1. `replaySet()` replays a whole set from the answers alone; the
  browser and the server both use it, so they cannot disagree about levels.
- `#/drills/<kind>?level=2&seed=81723` reproduces a set exactly. Replayed
  sets are practice only.

| Kind | Topic | Answer | Checked against (tests) |
| --- | --- | --- | --- |
| `subnet-range` | IP Addressing | 4 addresses | bit-string subnetting |
| `mask-cidr` | IP Addressing | mask, prefix or host count | counting bits |
| `same-subnet` | IP Addressing | yes / no | dividing by the block size |
| `longest-match` | Routing | pick a route | comparing bit strings |
| `mac-table` | Switching | forward / flood / filter | replaying the prompt text |
| `ipv6-shorten` | IPv6 | short or full address | an independent RFC 5952 implementation |
| `will-it-reach` | VLANs | a ping outcome | **the simulator itself** |

Every kind is tested on thousands of seeds against an **independent oracle**:
a different method from the generator's (the way a person would do it by
hand). A bug in one is caught by the other. `will-it-reach` goes further: its
answer is what the engine does (`actualOutcome()`), and the generator's own
prediction, which is what the explanation says, must match it on every
variant (`willItReach.test.ts`).

### Answers are read strictly

`src/drills/answers.ts`. Spaces around an answer are ignored and a prefix may
be `/21` or `21`, but **leading zeros are refused** (`10.010.0.1`): many real
tools (`inet_aton`, `ping` on several systems) read `010` as octal 8, so the
address is not the one it looks like. An IPv6 answer that is the right address
in a non-standard form is wrong, with the reason "same address, but not the
shortest standard form".

### Practice XP

Kavya's call in the phase 7 review: practice matters, so drills earn XP. The
design keeps that from breaking the leaderboard:

- A right answer is worth its level (1, 2 or 3).
- **At most 30 practice XP a day** (UTC). The generators are public, so a
  script can answer any drill; with a cap it earns exactly what a diligent
  learner earns, so writing one gains nothing. The cap is also an honest
  model of diminishing returns.
- Practice XP counts on the **weekly board** (which rewards coming back) and
  **not** on the all-time board or your level (which mean "what you can
  solve").
- The server draws the seed (`POST /drills/:kind/sets`) and replays the
  answers at the finish (`POST /drill-sets/:id/finish`); the client never
  says which level a question was or whether it was right. A set counts once:
  a retried finish returns the first result.
- `will-it-reach` runs the simulator once per question. Replaying 10
  simulations in one request would not fit the free plan's 10 ms of CPU, so
  it is graded in the browser and earns no XP (the server answers 409).
- Guests' drill records stay in this browser (`networky-drills` IndexedDB),
  labelled "this device", validated on every read.

### Adding a drill kind

1. Write `src/drills/kinds/<name>.ts` exporting a `DrillKind`: an `id`
   (never renamed: saved records and links use it), a `topic` from the
   catalog's `TOPICS`, one line per level, and `generate(r, level)`. Use only
   the seeded `r`, never `Math.random` or the clock (`core.boundary.test.ts`
   fails otherwise).
2. Return `{ type: 'fields', fields, expected, explanation }` for typed
   answers (formats in `answers.ts`) or `{ type: 'choice', choices,
   expected, explanation }`. Explanations are the worked steps, one per line.
3. Add it to `DRILL_KINDS` in `registry.ts`. `drills.test.ts` then checks it
   on every level and many seeds: one right answer, accepted by its own
   checker, distinct choices, deterministic.
4. Add an oracle test: compute the answer a second, different way.
5. If it runs the engine, set `runsEngine: true` (browser only, no XP).

## Profiles

### One page, two endpoints

| Endpoint | Who | Cache | What |
| --- | --- | --- | --- |
| `GET /users/:handle` | anyone | `public, max-age=60` | the public half |
| `GET /me/profile` | the owner | `no-store` | public half + private half + visibility |
| `PUT /me/visibility` | the owner | | `public` or `hidden` |

The public endpoint **never reads the session**. Its answer is the same for
every visitor, so it may be cached, and a cached copy can never hold anyone's
private data. Splitting by URL makes "a cache served my stats to a stranger"
impossible by construction instead of depending on a correct cache key.

### What is public and what is not

| Shown | Public | Owner only | Why |
| --- | --- | --- | --- |
| Name, handle, GitHub avatar, member since | yes | | already on the leaderboard and GitHub |
| XP, level, rank, solved by difficulty and topic, solved list | yes | | only what passed the judge |
| Activity calendar (UTC days, last year) | yes | | days only: hours would reveal a routine and a time zone |
| Hints, failed submits, acceptance, solutions opened | | yes | public hint counts would punish using hints |
| XP per week (problems and practice), unsolved problems, drill practice | | yes | coaching, not a showcase |
| Time to solve | no | no | wall-clock time includes every hour a tab sat open: a precise-looking number that means nothing |

**Hidden profiles**: hidden, banned and unknown handles all answer the same
404, so a visitor cannot tell them apart. A hidden learner keeps their place on
the leaderboard as "Hidden learner", without a name, picture or link.

### Computed on read

No stats table was added. On D1's free plan writes are the scarce quota
(100,000 rows a day, against 5 million reads), and each index on a written
table adds a written row. A cache bumped on every submit would make every
submit more expensive to make a rarely viewed page cheaper. Every number on
a profile is a query over records that already exist; one index was added
(`xp_events(user_id, created_at)`) so "XP per week" reads one learner's
events, not the whole site's.

## The free-plan budget, measured

| Limit (free) | Phase 7 cost |
| --- | --- |
| 100,000 worker requests a day | 1 per profile view; 2 per drill set (start, finish); guest drills 0 |
| 10 ms CPU per request | profile: no grading, a few small queries; drill finish: 10 tiny generators and checks (microseconds); engine drills never reach the server |
| 5 million D1 rows read a day | about 400 + rank per profile view |
| 100,000 D1 rows written a day | about 4 per drill set; practice XP is capped, so its ledger rows are too |
| **500 MB per database** | the real ceiling (below) |

Measured on the catalog (reference networks and graded reports): a stored
network is **3.9 to 10.3 KB (median 7.8 KB)**, a redacted report 0.5 to 1.7 KB
(median 0.85 KB). Before phase 7 the judge kept every passing network, the
latest failing one per attempt, and every old attempt's draft. That is roughly
0.8 MB for a learner who works through every problem, so 500 MB would hold
about 600 such learners.

Phase 7 keeps less (`server/routes/problems.ts`, tested in
`server/__tests__/storage.test.ts`):

- a failing network is kept only until its attempt passes;
- only the newest passing network per learner and problem;
- a replaced attempt's draft is dropped.

`network_hash` stays on every submission, so copied solutions can still be
found. **Still to measure in production**: real bytes per learner from D1's
dashboard, and real CPU time per request. Both depend on the phase 6 launch
(`docs/server-setup.md`), which has not run yet; the numbers above come from
the catalog, not from real learners.

## Things worth being able to explain

1. Why does a daily cap make practice XP safe even though anyone can script
   the answers? (It bounds what any client can earn, honest or not.)
2. Why do the public and private halves have different URLs? (Caching is
   keyed by URL; one URL with two shapes is one cache-key bug from a leak.)
3. Why compute profile stats on read instead of keeping counters? (Writes
   are the scarce quota on D1's free plan; reads are 50 times cheaper.)
4. Why does `will-it-reach` earn no XP? (Each question runs the simulator;
   ten of them in one request do not fit 10 ms of CPU.)
5. Why is the oracle in a drill test written differently from the generator?
   (Two implementations of the same mistake agree with each other.)
6. Why refuse `010` in an IPv4 answer? (Octal parsing in real tools.)
