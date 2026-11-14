# Setting up the server (phase 6)

Everything here is on the **free** plans (Cloudflare Pages, Workers, D1;
a GitHub OAuth app). Nothing needs a card. It is a one-time setup on the
Cloudflare account that already hosts the workspace (docs/ci-cd.md), done by
its owner (Hridyansh). About 20 minutes.

Until these steps are done, the deployed site keeps working exactly like
phase 5: `/api/v1/meta` reports `"ready": false` (no database bound), the
app stays in "saved in this browser" mode, and no sign-in button or
leaderboard link is shown.

## 1. Create the database

```sh
npx wrangler login
npx wrangler d1 create networky
npx wrangler d1 execute networky --remote --file migrations/0001_init.sql
```

`d1 create` prints a `database_id`; you do not need to paste it anywhere.

For pull-request previews, create a second one so test sign-ins never land in
the real leaderboard:

```sh
npx wrangler d1 create networky-preview
npx wrangler d1 execute networky-preview --remote --file migrations/0001_init.sql
```

**Later schema changes** come as new files `migrations/0002_*.sql`, and so
on. Run each once, in order, with the same `d1 execute ... --file` command,
**before** deploying the code that needs it. Never edit a file that has
already run.

## 2. Bind it to the Pages project

Cloudflare dashboard → Workers & Pages → the workspace project → Settings →
Bindings → Add → D1 database:

| Environment | Variable name | Database |
| --- | --- | --- |
| Production | `DB` | `networky` |
| Preview | `DB` | `networky-preview` |

The name must be exactly `DB`.

## 3. Create the GitHub OAuth app

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App:

- Application name: `Networky`
- Homepage URL: the workspace's production URL, e.g. `https://networky.pages.dev`
- Authorization callback URL: the same URL + `/api/v1/auth/github/callback`

Then "Generate a new client secret". Copy the client id and the secret.

The app asks GitHub for no scopes, so it can read only the public profile
(id, login, name, avatar). It cannot see repositories or email.

## 4. Add the variables and secrets

Same Pages project → Settings → Variables and Secrets, **Production only**:

| Name | Type | Value |
| --- | --- | --- |
| `APP_ORIGIN` | Text | the production URL, no trailing slash |
| `GITHUB_CLIENT_ID` | Text | from step 3 |
| `GITHUB_CLIENT_SECRET` | Secret | from step 3 |

Leave all three **unset for Preview**. A preview then has a working API (with
its own database) and simply shows no sign-in button, because a GitHub OAuth
app accepts only one callback URL.

## 5. Deploy and check

Push to `main` (or re-run the last CI/CD run). Then:

```sh
curl https://<your-url>/api/v1/meta
```

should print something like
`{"engineVersion":"2","problemCount":36,"contentPack":"open","ready":true,"signIn":{"github":true,"dev":false}}`.
Open the site: the top nav now has "Sign in with GitHub" and a Leaderboard
link.

## 6. Watch it for the first week

Workers & Pages → the project → Metrics (Functions): look at **CPU time**.
The free plan allows 10 ms per request. Measured locally, a warm grade takes
1 to 3 ms and the worst real network about 4 ms, but Cloudflare's numbers
are the ones that count. If p99 gets close to 10 ms, tell whoever is working
on the judge: the options are a lower work budget or the paid plan's 30 s,
and the second costs money, which the project has ruled out.

## Private content (when the first private problem exists)

See [judge.md](judge.md#private-content). In CI this becomes: check out the
private repo with a read-only deploy key stored as a secret, then build with
`NETWORKY_PRIVATE_CONTENT=<folder>`.

## Housekeeping by hand (until there is an admin page)

```sh
# hide a user from the leaderboards
npx wrangler d1 execute networky --remote --command "UPDATE users SET banned_at = unixepoch() * 1000 WHERE handle = 'someone'"
# delete expired sessions (harmless if never run; they are rejected anyway)
npx wrangler d1 execute networky --remote --command "DELETE FROM sessions WHERE expires_at < unixepoch() * 1000"
```
