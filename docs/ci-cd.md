# CI/CD

Every pull request is linted, type-checked, unit-tested, built and opened in a
real browser. Only code that passed all of that reaches `main`, and only `main`
reaches the live sites. Each PR also gets its own preview URL.

```
PR / push
   │
   ▼
changes ──► check (workspace) ─┐  lint → typecheck → unit tests → build → audit
   │        check (landing)  ──┤  → browser smoke tests on the production build
   │                           │  → upload dist/ (the exact files that were tested)
   │                           ▼
   │                      deploy (per app)
   │                        PR from this repo → preview  (pr-<n>.<project>.pages.dev)
   │                        push to main      → production
   ▼
CI passed  ◄── the one required check for branch protection
```

| File | What it does |
| --- | --- |
| `.github/workflows/ci.yml` | The pipeline above |
| `.github/workflows/security.yml` | Weekly full `npm audit`, package signature check, workflow linting (actionlint, zizmor) |
| `.github/workflows/codeql.yml` | Static security analysis of the TypeScript |
| `.github/dependabot.yml` | Weekly grouped update PRs for npm packages and actions |
| `.github/actions/setup-app/` | Node + cached `npm ci`, shared by every job |
| `.github/actions/deploy-static/` | **The only host-specific file.** Upload a folder, return a URL |
| `.github/deploy/<app>/_headers` | HTTP security and cache headers, copied into each build |
| `.github/e2e/` | Browser smoke tests owned by CI (Playwright), run against both apps |
| `.github/scripts/changed-apps.sh` | Decides which apps a change touches (+ a self-test) |

## Why it is built this way

These are the decisions worth being able to defend in an interview.

**1. The host does not build from git; CI deploys.** Every static host offers
"connect your repo and we deploy every push". That is the easy path, and it
deploys code your tests never saw: the host builds in parallel with CI, not
after it. Here the host only receives a finished folder from a job that runs
after the checks. *Do not* connect the Pages projects to GitHub in the
Cloudflare dashboard, or you get both, and the untested one wins the race.

**2. Build once, deploy that artifact.** The check job uploads `dist/`, and the
deploy job downloads it. Rebuilding in the deploy job would ship files that were
never tested (different dependency resolution, different env).

**3. Unit tests passing is not "tested".** The browser test loads the
*production* build, because the Content-Security-Policy only exists there. It
found a real bug on day one: zod probes `new Function()` at startup, the strict
CSP blocks it, and the browser logs a CSP violation. All 253 unit tests were
green. (Fix: `z.config({ jitless: true })` in a module imported first in
`src/main.tsx`; handed to the app thread.)

**4. Path filtering inside the workflow, not with `on.paths`.** A workflow
skipped by `on: paths` never reports a status. If its check is required, the PR
waits for it forever. So the workflow always runs; a cheap first job decides
which apps changed, and a final `CI passed` job turns "ran and passed" or
"skipped, nothing changed" into one green check.

**5. One required check.** Branch protection requires `CI passed`, not each
job. Adding a job later needs no settings change, and nobody can forget to.

**6. Deploy failures don't block merges.** `CI passed` ignores the deploy job:
a Cloudflare outage should not stop reviewed, tested code from merging. A
failed production deploy still shows red on `main`.

**7. Secrets live in GitHub environments, not the repo.** `production` only
accepts jobs from `main`. PRs from forks and Dependabot get no secrets at all
(GitHub's rule), so they are checked but not previewed. Never "fix" that with
`pull_request_target`: it runs with secrets and is the classic way repos get
their tokens stolen.

**8. Actions are pinned to commit SHAs.** A tag like `@v4` can be moved by
whoever controls the action's repo. In March 2025 `tj-actions/changed-files`
was compromised that way and leaked secrets from thousands of repos. A SHA
cannot move. Dependabot still bumps them, with the version in a comment.

**9. Least privilege.** Every workflow starts at `contents: read`. Only CodeQL
gets `security-events: write`. Checkouts don't keep the token on disk
(`persist-credentials: false`). `npm ci --ignore-scripts` stops a compromised
package from running code at install time.

**10. Audit without alert fatigue.** PRs fail only on high-severity advisories
in production dependencies (what users download). Dev-tool advisories go to the
weekly security run, so a CVE published this morning in a test library does not
turn every PR red. Dependabot waits 7 days before proposing a new release; most
malicious versions are pulled within that window.

**11. Cache the download cache, not `node_modules`.** `setup-node` caches
`~/.npm` keyed on the lockfile. `npm ci` still installs cleanly from the
lockfile, just without the network. Caching `node_modules` is faster but can
hide a broken lockfile.

## Picking a host

Both apps are static files, so any static host works. Recommendation:
**Cloudflare Pages**.

| | Cloudflare Pages | Netlify | Vercel | GitHub Pages |
| --- | --- | --- | --- | --- |
| Free bandwidth | Unlimited | Credit-based, capped | 100 GB, **non-commercial only** | 100 GB soft |
| PR previews | Yes, stable per-PR alias | Yes | Yes | No |
| `_headers` file (CSP, frame-ancestors) | Yes | Yes | No (`vercel.json`) | No custom headers |
| Deploy from CI | `wrangler pages deploy` | `netlify deploy` | `vercel deploy --prebuilt` | `actions/deploy-pages` (no secret, OIDC) |

Why Cloudflare: unlimited bandwidth on the free plan, and the `_headers` file
works unchanged. Vercel's free plan forbids commercial use, which matters if
Networky ever charges. GitHub Pages needs no secrets at all, which is the most
secure option, but it cannot set `frame-ancestors` (clickjacking protection)
and has no PR previews.

Honest caveat: Cloudflare now steers *new* projects toward Workers with static
assets. Pages is still supported and is simpler for two static sites. If you
ever need server code, that is the moment to move.

### Switching host

Rewrite `.github/actions/deploy-static/action.yml` and keep its inputs and the
`url` output. Nothing else changes. Netlify, for example:

```yaml
    - name: Upload to Netlify
      id: deploy
      shell: bash
      env:
        NETLIFY_AUTH_TOKEN: ${{ inputs.api-token }}
        NETLIFY_SITE_ID: ${{ inputs.account-id }}   # rename the input to site-id
        PROD: ${{ inputs.production }}
        ALIAS: ${{ inputs.preview-name }}
        DIR: ${{ inputs.dir }}
      run: |
        if [ "$PROD" = "true" ]; then flags="--prod"; else flags="--alias=$ALIAS"; fi
        out=$(npx --yes netlify-cli@<pinned version> deploy --dir="$DIR" $flags --json)
        echo "url=$(echo "$out" | jq -r '.deploy_url')" >> "$GITHUB_OUTPUT"
```

## Setup for the repo owner (Hridyansh)

Only the repo owner can do these. About 20 minutes. Do them in this order.

### 1. Cloudflare (once)

1. Create a free Cloudflare account, open **Workers & Pages**.
2. Create both projects as **Direct Upload**, not "Connect to Git" (see
   decision 1). From any terminal:
   ```bash
   npx wrangler@4.152.0 login
   npx wrangler@4.152.0 pages project create networky --production-branch=main
   npx wrangler@4.152.0 pages project create networky-landing --production-branch=main
   ```
   If those names are taken, pick others and set the repo variables
   `CF_PAGES_PROJECT_WORKSPACE` / `CF_PAGES_PROJECT_LANDING` to them.
3. **My Profile → API Tokens → Create Token → Custom token**. Permission:
   *Account → Cloudflare Pages → Edit*. Account resources: only your account.
   Nothing else. Set an expiry (e.g. 1 year) and a calendar reminder.
4. Copy your **Account ID** (right sidebar of the Workers & Pages overview).
5. Optional: add custom domains under each project → *Custom domains*.

### 2. GitHub environments and secrets

**Settings → Environments → New environment**

- `production`
  - *Deployment branches and tags* → *Selected branches* → add `main`.
  - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
  - Optional: *Required reviewers* → yourself, if you want to click "approve"
    before each live deploy.
- `preview`
  - No branch rule.
  - Same two secrets. (Stricter: a second token, so a leak from a PR job can be
    revoked without touching production. Note any collaborator with write
    access can edit a workflow in a PR and read preview secrets; that is why
    the token is scoped to Pages only.)

**Settings → Secrets and variables → Actions → Variables** (repository):

- `WORKSPACE_URL` = the workspace's live URL with a trailing slash, e.g.
  `https://networky.pages.dev/` or your custom domain. The landing page's
  buttons point here. It is a *variable*, not a secret: it ends up in public
  HTML. Production landing deploys refuse to run without it.

- `LANDING_URL` (optional) = the landing page's own live URL, e.g.
  `https://networky-landing.pages.dev/`. Adds link-preview images (og:image).
  Must be https.

Until the secrets exist, PR previews are skipped with a notice instead of
failing.

### 3. Actions settings

**Settings → Actions → General**

- *Actions permissions*: allow GitHub-made actions plus selected ones:
  `cloudflare/wrangler-action@*`. Tick **Require actions to be pinned to a
  full-length commit SHA**.
- *Fork pull request workflows*: **Require approval for all external
  contributors**.
- *Workflow permissions*: **Read repository contents and packages
  permissions**. Untick *Allow GitHub Actions to create and approve pull
  requests*.

### 4. Security features

**Settings → Code security**: turn on Dependabot alerts, Dependabot security
updates, secret scanning and **push protection** (blocks a push that contains
a token).

### 5. Branch protection (after CI has run once)

GitHub only offers checks it has seen, so merge the PR that adds these files
first, then:

**Settings → Rules → Rulesets → New branch ruleset**

- Name `main`, enforcement **Active**, target **Default branch**.
- **Restrict deletions**, **Block force pushes**.
- **Require a pull request before merging**: 1 approval, *Dismiss stale
  approvals when new commits are pushed*.
- **Require status checks to pass**: add `CI passed`. Tick *Require branches
  to be up to date* (tested together with the latest `main`, not just on
  their own).
- Bypass list: empty. If an emergency fix ever needs it, add yourself
  temporarily and remove it after.

### 6. Check it works

1. Open a PR that changes one line in `src/`. Expect: `Check workspace`, no
   landing job, a preview link on the PR's *Deployments* box, `CI passed`
   green.
2. Merge it. Expect a production deploy of the workspace only.
3. **Actions → CI/CD → Run workflow** on `main` redeploys both apps.

## Day to day

- **Rollback:** Cloudflare dashboard → project → *Deployments* → older
  deployment → *Rollback*. Instant, no rebuild. Then fix forward with a PR.
- **Redeploy everything:** run the CI/CD workflow manually on `main`.
- **A Dependabot PR is red:** the update broke something. That is the system
  working. Fix it in that branch or close the PR.
- **Run the browser tests locally:**
  ```bash
  npm run build                                  # (or in landing/)
  cd .github/e2e && npm ci && npx playwright install chromium
  APP=workspace APP_DIR=$PWD/../.. npx playwright test --project=workspace
  APP=landing APP_DIR=$PWD/../../landing VITE_WORKSPACE_URL=https://app.example.com/ \
    npx playwright test --project=landing
  ```
- **Adding lint or the apps' own browser tests:** add a `lint` or `test:e2e`
  script to the app's `package.json`. CI picks them up automatically
  (`--if-present`).
