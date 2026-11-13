# Writing a problem

A problem is one object of type `ProblemSpec` (`src/problems/spec.ts`) in a
module under `src/problems/catalog/`. This page is the checklist for adding
one. How the tests are run is in [grading.md](grading.md).

## The parts

| Field | What it is |
| --- | --- |
| `slug` | The URL id (`#/problems/<slug>`). Saved progress is keyed by it, so never rename one. |
| `version` | Bump it whenever the tests change. A learner's old attempt is then dropped, their solved mark and best score are kept. |
| `title`, `topic`, `difficulty`, `type` | `topic` must be one of `TOPICS` in `catalog/index.ts`. `type` is `configure`, `troubleshoot` or `predict` (see below). |
| `statement` | Plain text, rendered as text (never HTML). Say what must be true at the end, not which button to press. |
| `requirements` | What the learner must achieve, each with exactly three hints: the idea, where to look, the exact fix. |
| `tests` | Test cases. Each names a requirement, a number of points and a check (`kind` + `params`). |
| `start(params)` | Builds the network the learner opens. |
| `reference(params)` | Builds a network that must score 100%. |
| `wrong` | Plausible wrong answers. Each must fail at least one test. |
| `layout` | Canvas positions by device id. |
| `solution` | Plain text: what the fix is and why it works. |
| `params(rng)` | Randomized problems only: the values for one seed. |

## Building the networks

Use `Draft` from `src/model/draft.ts` with `{ stableIds: true }` (the helper
`stable()` in `catalog/nets.ts` does that). With stable ids a device's id is
its hostname, so one static `layout` fits every randomized variant, and tests
can name devices by hostname.

Shared shapes live in `catalog/nets.ts` (`twoLans`, `threeInARow`,
`officeEdge`). Write `start` and `reference` as the same builder with one
argument changed. Two separately written networks drift apart; one builder
with a `fixed` flag cannot.

Port names that trip people up: a PC's port is `FastEthernet0`, a server's is
`GigabitEthernet0`. On a router `Gi0/0` and `Gi0/1` are copper and `Gi0/2` is
fiber. On a switch `Fa0/1` to `Fa0/8` and `Gi0/1` are copper, `Gi0/2` is fiber.

## Choosing tests

Available checks (`src/grading/checks/`):

| Kind | Asserts | Sends traffic |
| --- | --- | --- |
| `reach` | a ping ends as `success`, `unreachable`, `prohibited`, `lost`, ... | yes |
| `tcp` | a TCP connection to a port succeeds, is refused, is blocked | yes |
| `http` | a page is fetched | yes |
| `dhcpLease` | a client got a lease (optionally in a subnet, from a given server) | yes |
| `route` | a router has a route to a prefix (optionally via a next hop or protocol) | no |
| `stpRoot` | a switch is the root bridge of a VLAN | no |
| `interfaceIp` | a port has an address | no |
| `accessVlan` | a switch port is in a VLAN | no |

Rules of thumb, each learned from a problem that was wrong at first:

1. **Test the outcome, then pin the cheat.** "PC1 reaches PC2" can often be
   passed a lazy way (one flat VLAN, a DHCP pool on the wrong router, a static
   route where OSPF was asked for). Add a config check that fails the lazy way,
   and add that lazy way to `wrong` so CI proves it fails.
2. **Negative tests need a positive twin.** "The guest cannot reach the
   engineers" is also true of a network with every cable pulled out.
3. **Never depend on a tie.** MAC addresses are random per build, so an STP
   election between equal priorities has a different winner each time.
4. **Know the outcome word.** No route back gives `lost`; a host in another
   VLAN on the same subnet gives `unreachable`; a closed port gives `refused`;
   an ACL gives `prohibited`.
5. **Hints must use commands this CLI accepts.** For example there is no
   `interface range` here.

Visibility is decided by difficulty: easy shows every test, medium shows the
ones that send traffic and hides the config checks, hard hides everything
unless a test says `visibility: 'shown'`. Give a hard problem at least one
shown test so **Run** is not useless.

## Predict problems

A predict problem is a finished network plus questions about what traffic on
it will do. Write it with `predictProblem({...})` from `spec.ts` (see
`catalog/predicts.ts`): there are no requirements, tests, reference or wrong
solutions. Each question has a `prompt`, the `traffic` to send (a ping or a
TCP connection), the `choices` offered and an `explanation`.

The answer is never written down. It is whatever the simulation does on the
start network, so a question cannot go stale when the engine improves. Two
things keep that honest:

- `verifyProblem` fails if a question's real outcome is not among its choices.
- `catalog/predicts.test.ts` pins the outcome each explanation was written
  for. Add your problem to its table. If the engine later behaves
  differently, that test fails and you re-read the explanation.

Good predict questions come in pairs that look alike and end differently
(the same missing route seen from both ends; a refused port next to a
filtered one). A problem whose questions all have the same answer is
rejected by the test.

Writing these found two engine bugs, which is a reason to keep writing them:
a ping whose reply was dropped on the way back was reported as "unreachable"
to the sender, and a TCP test ignored the Services settings.

## Randomized problems

Add `params(rng)` and use `{{key}}` placeholders in the statement, hints,
solution and test params. `instantiate(spec, seed)` fills them in. The seed is
saved with the learner's progress, so a reload shows the same variant and
**Start over** draws a new one. Use the `rng` you are given and nothing else:
`Math.random()` would make the server (phase 6) grade a different network
from the one the learner saw.

## Registering it

1. Export the spec from its module.
2. Add it to a stage in `STAGES` in `catalog/index.ts`. The order there is the
   order on the Problems page and in the tracks.
3. If it is solved on a router or switch, add the commands to `SCRIPTS` in
   `catalog/cliSolutions.test.ts`.
4. `npm test`.

## What CI checks for every problem

`catalog.test.ts` runs `verifyProblem` on each one (randomized problems on 25
seeds):

- the spec is well-formed and every test's params fit its check's schema;
- the start network does **not** already pass;
- the reference scores 100%;
- every entry in `wrong` fails at least one test.

That grading the same network twice gives the same report is tested once for
the grader itself (`src/grading/__tests__/grade.test.ts`).

`cliSolutions.test.ts` types the commands the hints quote into the simulated
IOS CLI, starting from the start network, and requires every test to pass.
That catches a hint that names a command the CLI rejects, and a problem that
can only be solved through the Config tab when the hints say CLI.
