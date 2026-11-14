# Deferred features

Things that were designed or drawn in a mockup but are **not built yet**, so
the UI does not show them. Nothing here is cancelled. Each entry says what it
waits for, so it can be picked up when that lands. Update this file when an
item ships (move it to the README) or when a new cut is made.

Rule behind the cuts: the app shows only features that exist and never shows
invented numbers.

| Feature | From | Waits for | Notes |
| --- | --- | --- | --- |
| Per-user stats page ("View Stats") | Problems mockup | Phase 7 profiles | Phase 6 shipped the global solve total (under the problem table) and XP, solved and rank in the account menu. |
| Public profiles (`/u/:handle`) | Both Problems mockups | Phase 7 profiles | The avatar menu shipped in phase 6. |
| Notifications bell | Both Problems mockups | Phase 6 accounts | Nothing to notify about without accounts. |
| Compete menu, Contests card, timed contests | Both Problems mockups | Phase 8 | Needs the server judge plus anti-cheat. |
| Discuss | Both Problems mockups | Phase 7+ | Needs accounts and moderation. |
| Interview Prep card / track | Problems mockup (light) | Content | 30 problems exist now, so a curated track is possible. Needs a decision on which problems go in. |
| Randomized predict problems | Predict chunk | Content | The spec and placeholders support it (tested); none of the six predict problems is randomized yet, so a repeat attempt sees the same questions. |
| Locking the device CLI and Desktop during a predict problem | Predict chunk | A read-only mode for device windows | The ping panel is hidden until all answers are in, but a learner can still open a device and ping from its CLI. Signed in, answers are judged on the server, but the learner can still try the ping on a device first. |
| `interface range` in the CLI | Found while writing problems | Small CLI work | Real IOS has it; here each port is configured on its own. Hints were written to match. |
| Upgrade to Pro / Premium | Both Problems mockups | A business decision | No paid tier exists. Cloudflare free plan is fine for commercial use; Vercel's is not (see docs/ci-cd.md). |
| Left sidebar navigation (Home, Problems, Learn, Playground, My Labs, Saved Topologies, Submissions) | Problems mockup (light) | Revisit when there are more sections | Duplicated the top nav. My Labs and Saved Topologies are the Projects page today. |
| Topic dropdown on Problems | Problems mockup (light) | Nothing; dropped as a duplicate | The topic chips do the same job. Bring it back if the chip row ever gets too long. |
| Sort by "Newest" | Problems mockup | Problems carrying a publish date | Today: default order, difficulty, title. |
| Buddies, Job Filter, streak flame | Problems mockup (dark) | Phase 7+ | Social and jobs features. |
| AI tutor | Platform plan | Phase 8 | |
| Private problems in the web app | Phase 6 design | The first private problem | The server side is wired (`NETWORKY_PRIVATE_CONTENT`, docs/judge.md). The web app still needs the public half of a private problem (statement, start network, visible tests) in its catalog; that format is decided with the first such problem. |
| Other sign-in providers (Google, email) | Phase 6 design | Demand | GitHub only: the audience has accounts, and one provider means one OAuth flow to secure. The `identities` table already allows more. |
| Account deletion and data export | Phase 6 security pass | Before a public launch | Needed for GDPR-style requests. Today an admin deletes the rows by hand (docs/judge.md). |
| Banning from the UI | Phase 6 | Abuse | `users.banned_at` hides a user from boards; set it with a D1 query. |
