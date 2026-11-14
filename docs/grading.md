# How grading works

Phase 5 turns Networky into a problem platform. This page explains the
design and why each decision was made. To add a problem, read
[problems.md](problems.md).

## One sentence

`grade(topology, spec, { scope, seed })` in `src/grading/grade.ts` is a pure
function: it takes the learner's network and a problem, boots a fresh
simulation, runs every test, and returns a report. Nothing else in the app
decides whether a problem is solved.

## The path of a Submit

```
ProblemPage  ->  problemStore.submit()
                   gradeAsync({ slug, seed, scope, topology })     src/grading/gradeClient.ts
                     new Worker, postMessage, 20 s timer
                       worker.ts -> gradeProblem() -> instantiate(spec, seed) -> grade()
                         Simulation(topology).boot().run(budget)
                         for each test: check plugin .run(ctx, params)
                     report comes back, worker is terminated
                   scoreWithHints(report, hintsUsed)
                   ProgressRepository.put(row)                      IndexedDB "networky-progress"
```

## Decisions and their reasons

**The grader is pure and deterministic.** The simulation is a tick-based
state machine with no wall clock and no randomness that affects outcomes, so
the same network always gives the same report. That is what makes a hidden
test fair, a CI check of every problem possible, and a server judge (phase 6)
able to re-run a submission and get the learner's exact result.

**Tests are behaviour first.** Most tests send real traffic through the
simulated network ("PC1 can ping 10.0.2.5") instead of comparing
configuration text. Any correct solution passes, including ones the author
never thought of. Config checks exist only to rule out a shortcut.

**Checks are plugins.** One file per kind in `src/grading/checks/`, listed in
`checks/index.ts`, the same pattern as engine protocols. A check has a strict
zod schema for its params (an unknown key is an error in the problem, caught
by CI), a `describe` sentence for the Tests tab, a `behaviour` flag, `run`,
and optionally `replay`, which powers **Show me**: the failed traffic is
re-sent in Simulation mode so the learner watches where it is dropped.

**Run and Submit differ.** Run grades the shown tests only and records
nothing. Submit grades everything and records the verdict. Hidden tests stop
"edit until green" without understanding.

**Grading runs in a Web Worker, one per request.** A learner can build a
network that never goes quiet (a switching loop with STP off). On the main
thread that freezes the tab. In a worker the page stays responsive and after
20 seconds the worker is terminated, which is the only way to stop
synchronous JavaScript from outside. A new worker per request means no state
leaks between grades. If workers are unavailable the same function runs on
the main thread.

**A work budget, not only a clock (phase 6).** The 20 s timer protects the
tab, but it cannot be part of the verdict: a slow laptop would fail a
network that a fast one passes, and the server must reach the same verdict
as the browser. So the simulation also counts work, in units of one step
plus one per frame delivered (`Simulation.work`), and a grade stops at
`WORK_BUDGET` = 3,000 units (`src/grading/grade.ts`). The busiest network in
the catalog needs 146, so a real solution never comes near it; a network
that never goes quiet hits it, and the report says `limitExceeded`. Same
network, same count, on every machine.

**Deterministic ids and MACs (phase 6).** Grading builds networks with
`seededIds` (`src/model/ids.ts`): device and link ids and MAC addresses come
from a counter and a seeded generator, not from `crypto`. Building the same
problem twice gives byte-identical networks (a test checks every problem),
which is what lets the server and the browser agree on an STP election
between equal priorities. The canvas still uses random ids, since two
devices you add by hand must never collide. `ENGINE_VERSION` went to 2 for
this change.

**Only the slug and seed cross to the worker, not the spec.** A spec holds
functions (the builders of its networks), and functions cannot be copied to
another thread by `postMessage`. The worker looks the problem up in its own
copy of the catalog. The same request shape is what a server judge will
accept in phase 6: it must use its own tests, never ones the client sends.

**Hints cost points, the solution costs XP.** Each of the three hints for a
requirement removes 25% of that requirement's earned points
(`src/grading/hints.ts`). The solution unlocks after a solve or three failed
submits; opening it before the first solve sets that problem's XP to zero.
XP is `difficulty base x best hinted score`, counted once per problem
(`src/problems/xp.ts`), so repeating an easy problem earns nothing.

**Predict problems are scored on the first attempt.** An answer is final and
its explanation appears at once, so a second attempt proves memory, not
understanding. The share right on the first complete attempt is stored as
`firstTry` and is what XP uses; a later all-correct attempt marks the problem
solved but cannot raise that share. Answers are judged against the problem's
own start network (`problemStore.answer`), not the canvas, so editing the
network changes nothing. They are judged on the main thread: the network is
authored and verified in CI, so it cannot be one that never settles.

**Progress is a separate database and is never trusted.** Rows live in
IndexedDB `networky-progress`, apart from projects, and every row is parsed
with zod on read. A row edited in devtools into a bad shape is dropped. A row
edited into a *valid* lie (solved: true) is accepted, because nothing local
can prevent that. This is why XP is shown as personal motivation only and why
a leaderboard has to wait for a server that re-grades submissions.

## Security notes

- The Content Security Policy stays `script-src 'self'`; the worker is a
  bundled module, no `eval`, no blob URLs.
- Statements, hints and solutions are rendered as text nodes.
- A saved attempt goes through the same `deserialize` validation as an
  opened project file; a damaged one is discarded and the start network is
  loaded.
- The work budget (3,000 units) bounds what a hostile network can make the
  grader do, identically in the browser and on the server; the 20 s timeout
  is the backstop for the tab.
- Signed in, the server grades every Submit again and keeps the only record
  that counts. See [judge.md](judge.md).

## Limits today

- Guests: everything is local to one browser, as before. Signed-in
  learners: Submit, hints, answers and the solution go through the server
  judge ([judge.md](judge.md)); Run stays local.
- 36 problems: 30 configure or troubleshoot, 6 predict. None of the predict
  problems is randomized yet.
- The problem workspace is tight below about 1440 px wide.
- See [deferred.md](deferred.md) for everything designed but not built.

## Things worth being able to explain

If you built this, an interviewer can reasonably ask:

1. Why does determinism matter for a judge, and what would break it?
   (Wall-clock timers, `Math.random`, iteration order of unordered data.)
2. Why a Web Worker and not `setTimeout` or a promise? (JavaScript on one
   thread cannot be interrupted; only terminating another thread can stop a
   runaway loop.)
3. Why behaviour tests over config diffing, and what is the cost? (Accepts
   any correct answer; costs a full simulation per grade and needs extra
   checks to block shortcuts.)
4. Why can't a client-only leaderboard be trusted, and what is the minimum
   server that fixes it? (Send the topology, re-grade on the server with the
   same pure function, store only server verdicts.)
5. Why key progress by slug and carry a version? (Stable identity across
   reorders; a version bump invalidates attempts without erasing what was
   earned.)
6. What is the plugin pattern buying here? (A new check or protocol is one
   file and one list entry; the grader and UI never change. Open for
   extension, closed for modification.)
