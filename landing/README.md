# Networky landing page

The public front door for Networky. It is a separate app from the workspace
(the simulator in the repo root) and is built and deployed on its own.

```
networky/
├── src/ …          the workspace (React app, deploy #1, e.g. app.networky.dev)
└── landing/        this page (static site, deploy #2, e.g. networky.dev)
```

The two apps share no code and no build. The landing page only *links* to the
workspace; where the workspace lives is configured with one environment
variable.

## Run it

```bash
cd landing
npm install
npm run dev        # http://localhost:5174, buttons point at http://localhost:5173
npm test           # workspace URL validation tests
npm run build      # needs VITE_WORKSPACE_URL, see below
npm run preview    # serve the built site on http://localhost:4174
```

Run the workspace (`npm run dev` in the repo root) at the same time to click
through from one to the other.

## Configuration

| Variable | Required | Example |
| --- | --- | --- |
| `VITE_WORKSPACE_URL` | for `build` | `https://app.networky.dev/` |
| `VITE_SITE_URL` | no | `https://networky.dev/` |

Every "Start new" / "Open workspace" button points here. The value is checked
when the build starts (`src/workspaceUrl.ts`):

- it must be an absolute URL using `https` (plain `http` only for `localhost`),
- it must not contain a username or password,
- it is HTML-escaped before it goes into the page.

A missing or invalid value **fails the build** on purpose: a broken link in
production is worse than a red build. `npm run dev` falls back to the local
workspace and prints a warning instead. `.env.development` holds the dev value;
put a personal override in `.env.local` (git-ignored).

### Link previews

`VITE_SITE_URL` is where this landing page itself is deployed. When it is set,
the build adds `og:url`, `og:image` (`public/og-image.png`, 1200x630) and a
`twitter:card` tag, all as absolute URLs, so a link pasted into a chat or a
post shows a preview card. Crawlers ignore relative image paths, which is why
the page does not guess. Unset: the tags are left out and the build warns.
Set but invalid: the build fails, same rules as the workspace URL.

## Demo videos and lab links

- **Videos** (`public/videos/`) are real recordings of the workspace, one light
  and one dark take of each clip, as VP9 `.webm` with an H.264 `.mp4`
  fallback for Safari, plus a `.jpg` poster. `src/demo.ts` plays the clip only
  while it is on screen, swaps it with the theme, and never autoplays for
  visitors who ask for reduced motion. `preload="none"` means a visitor who
  never scrolls to it downloads nothing. Re-record after a UI change with
  `scripts/record-demo.cjs` and `scripts/encode-demo.py` (steps at the top of
  each file). `scripts/og-image.cjs` regenerates the preview image.
- **Lab cards** link to `VITE_WORKSPACE_URL#/lab/<id>`. The workspace opens a
  fresh copy of that lab, or sends an unknown id to its Learn page.
  `src/labs.test.ts` checks every card id against `src/model/examples.ts`
  when the workspace source is next to this folder.

## Deploy

Any static host works. Create a second project on the host that points at the
same repository with:

| Setting | Value |
| --- | --- |
| Root directory | `landing` |
| Install | `npm install` |
| Build | `npm run build` |
| Output | `landing/dist` |
| Env var | `VITE_WORKSPACE_URL=https://<your workspace domain>/` |

Changing the workspace domain later means changing that variable and
rebuilding the landing page. Nothing in the workspace changes.

### Security headers

The build adds a strict Content-Security-Policy `<meta>` tag (no inline
scripts, no inline styles, no network requests). Some protections only work as
real HTTP headers, so set these on the host too:

```
Content-Security-Policy: frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

## How it is built

- **No framework.** It is plain HTML, CSS and a little TypeScript. All the
  text is in `index.html`, so search engines and link previews read it without
  running any JavaScript.
- **Animations** (`src/motion.ts`) use GSAP with MotionPath (packets travel
  along the cables) and ScrollTrigger (sections reveal on scroll, the packet
  loop pauses when the hero is off screen). The page is complete without them:
  visitors with *reduce motion* turned on, or with JavaScript off, get the full
  static page.
- **Theme** follows the system, and the toggle pins a choice in
  `localStorage`. `public/theme.js` applies it before first paint; it is a
  separate file because the CSP forbids inline scripts.
- **Icons** live in `public/`: `favicon.svg` (modern browsers), `favicon.ico` (16/32/48, older browsers and tools that request `/favicon.ico`), `apple-touch-icon.png` (180, full-bleed because iOS rounds it), and `icon-192/512` plus a maskable 512 for `site.webmanifest`. The same set is meant for the workspace.
- **Fonts** are bundled (`@fontsource-variable/inter`), so no request goes to
  a font CDN.

Only features that exist in the workspace are listed. When the workspace gains
something new (or deep links like "open this lab"), update `index.html`.
