// Checks the WEB bundle (dist/assets, what every visitor downloads) for things
// that must only ever be in the server: the private content pack and server
// code. Run by CI after `npm run build`, next to check-worker.mjs.
//
// Why a check on the output and not just a rule in the code: a single stray
// import (a test helper, a shared util that pulls in server/content.ts) would
// put every hidden test into the bundle, and nothing else would notice.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../dist/assets/', import.meta.url);
const FORBIDDEN = [
  ['networky-private-content', 'the private content pack'],
  ['PRIVATE_PROBLEMS', 'server/privateContent.ts'],
  ['GITHUB_CLIENT_SECRET', 'server code (auth)'],
  ['token_hash', 'server code (sessions)'],
];
let bad = 0;
let files = 0;
for (const name of readdirSync(dir)) {
  if (!/\.(js|css|html|json|map)$/.test(name)) continue;
  files++;
  const text = readFileSync(new URL(name, dir), 'utf8');
  for (const [needle, what] of FORBIDDEN) {
    if (text.includes(needle)) {
      console.error(`check-bundle: dist/assets/${name} contains "${needle}" (${what}). The web bundle must not include it.`);
      bad++;
    }
  }
}
if (bad) process.exit(1);
if (!files) {
  console.error('check-bundle: dist/assets is empty; run npm run build first');
  process.exit(1);
}
console.log(`check-bundle: ok (${files} files, no server-only content)`);
