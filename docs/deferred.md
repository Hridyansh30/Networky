# Deferred features

Things that were designed or drawn in a mockup but are **not built yet**, so
the UI does not show them. Nothing here is cancelled. Each entry says what it
waits for, so it can be picked up when that lands. Update this file when an
item ships (move it to the README) or when a new cut is made.

Rule behind the cuts: the app shows only features that exist and never shows
invented numbers.

| Feature | From | Waits for | Notes |
| --- | --- | --- | --- |
| Notifications bell | Both Problems mockups | Something to notify about | Accounts exist since phase 6, but nothing sends a notification yet (no contests, replies or follows). |
| Compete menu, Contests card, timed contests | Both Problems mockups | Phase 8 | Needs the server judge plus anti-cheat. |
| Discuss | Both Problems mockups | Moderation | Accounts exist since phase 6; a public comment area still needs moderation and abuse handling. |
| Interview Prep card / track | Problems mockup (light) | Content | 36 problems exist now, so a curated track is possible. Needs a decision on which problems go in. |
| Randomized predict problems | Predict chunk | Content | The spec and placeholders support it (tested); none of the six predict problems is randomized yet, so a repeat attempt sees the same questions. |
| Locking the device CLI and Desktop during a predict problem | Predict chunk | A read-only mode for device windows | The ping panel is hidden until all answers are in, but a learner can still open a device and ping from its CLI. Signed in, answers are judged on the server, but the learner can still try the ping on a device first. |
| Upgrade to Pro / Premium | Both Problems mockups | A business decision | No paid tier exists. Cloudflare free plan is fine for commercial use; Vercel's is not (see docs/ci-cd.md). |
| Left sidebar navigation (Home, Problems, Learn, Playground, My Labs, Saved Topologies, Submissions) | Problems mockup (light) | Revisit when there are more sections | Duplicated the top nav. My Labs and Saved Topologies are the Projects page today. |
| Topic dropdown on Problems | Problems mockup (light) | Nothing; dropped as a duplicate | The topic chips do the same job. Bring it back if the chip row ever gets too long. |
| Sort by "Newest" | Problems mockup | Problems carrying a publish date | Today: default order, difficulty, title. |
| Buddies, Job Filter, streak flame | Problems mockup (dark) | Not scheduled | Social and jobs features. Phase 7 shipped profiles and an activity calendar, not these. |
| AI tutor | Platform plan | Phase 8 | |
| Private problems in the web app | Phase 6 design | The first private problem | The server side is wired (`NETWORKY_PRIVATE_CONTENT`, docs/judge.md). The web app still needs the public half of a private problem (statement, start network, visible tests) in its catalog; that format is decided with the first such problem. |
| Other sign-in providers (Google, email) | Phase 6 design | Demand | GitHub only: the audience has accounts, and one provider means one OAuth flow to secure. The `identities` table already allows more. |
| Banning from the UI | Phase 6 | Abuse | `users.banned_at` hides a user from boards; set it with a D1 query. |
| Percentile on profiles ("better than 64%") | Phase 7 plan | 20+ ranked learners, and a cheap count | Counting every ranked learner per profile view reads one row per learner. Rank alone is shown. |
| Shared cache for public profiles (Cloudflare Cache API) | Phase 7 plan | The production launch | `Cache-Control` only helps the visitor's own browser. Check whether the Cache API works on the `pages.dev` address before relying on it. |
| Per-IP rate limit on public profiles | Phase 7 plan | Abuse | Counting in D1 would spend a written row per view. Use Cloudflare's own rate limiting if the free plan offers it for this setup. |
| Link previews for shared profiles | Phase 7 plan | Real sharing | Needs the worker to render HTML for every crawler, which spends the 100,000 requests a day. |
| Changing your handle | Phase 7 plan | Demand | Profile links use the handle; a rename needs redirects for old links. |
| Spaced repetition for drills | Phase 7 plan | Data on how drills are used | Bring back the kinds you got wrong days later. |
| Syncing guest drill records to an account | Phase 7 | Demand | Signed-in drill sets are already on the server; guests' stay on their device. |
| Practice XP for engine-backed drills | Phase 7 | CPU measurements | 10 simulations in one request do not fit 10 ms of CPU. |
| Compressing stored networks | Phase 7 storage review | Real D1 size numbers | gzip would roughly quarter the 500 MB pressure but costs CPU on every submit. |
