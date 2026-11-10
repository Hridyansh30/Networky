// Records the "See it working" demo clips from a running workspace.
//
//   npm run dev                                  (in the repo root, the workspace)
//   node scripts/record-demo.cjs <outDir> dark  > dark.json
//   node scripts/record-demo.cjs <outDir> light > light.json
//   python3 scripts/encode-demo.py dark.json light.json public/videos
//
// Optional 3rd argument records one clip only: simulate | cli | apps.
// WORKSPACE_URL overrides where the workspace runs (default http://localhost:5173/).
// Each clip prints one JSON line: the raw file plus the seconds where the
// action starts and ends, so the encoder can trim the page-loading part.

const { chromium } = require('playwright');
const out = process.argv[2]; const theme = process.argv[3] || 'dark'; const only = process.argv[4];
const WS = process.env.WORKSPACE_URL || 'http://localhost:5173/';
const W = 1920, H = 1080;
async function clip(b, name, setup, act) {
  if (only && only !== name) return;
  const ctx = await b.newContext({ viewport: { width: W, height: H }, colorScheme: theme, recordVideo: { dir: `${out}/raw-${theme}-${name}`, size: { width: W, height: H } } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('networky-theme', t); } catch {} }, theme);
  const t0 = Date.now();
  const p = await ctx.newPage();
  await setup(p);
  const start = (Date.now() - t0) / 1000;
  await act(p);
  const end = (Date.now() - t0) / 1000;
  await ctx.close();
  console.log(JSON.stringify({ name, theme, file: await p.video().path(), start, end }));
}
const openLab = async (p, lab) => {
  await p.goto(WS + '#/learn'); await p.waitForTimeout(800);
  await p.locator('.lab-card', { hasText: lab }).getByText('Open lab').click(); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Fit to screen' }).click(); await p.waitForTimeout(500);
};
const type = (p, s, d = 55) => p.keyboard.type(s, { delay: d });
(async () => {
  const b = await chromium.launch();
  await clip(b, 'simulate', async (p) => {
    await openLab(p, 'Two LANs, one router');
    await p.getByRole('radio', { name: 'Simulation' }).click(); await p.waitForTimeout(600);
    await p.getByRole('button', { name: 'Fit to screen' }).click(); await p.waitForTimeout(400);
  }, async (p) => {
    await p.waitForTimeout(400);
    await p.locator('input[aria-label="Destination address"]').click();
    await type(p, '192.168.2.10', 70);
    await p.waitForTimeout(300);
    await p.locator('.send-form button[type=submit]').click();
    await p.waitForTimeout(10500);
  });
  await clip(b, 'cli', async (p) => {
    await openLab(p, 'Two routers, static routes');
    const r = p.locator('.react-flow__node', { hasText: 'R1' }).first();
    await r.dblclick(); await p.waitForTimeout(500);
    await p.locator('.modal [role=tab]', { hasText: 'CLI' }).click(); await p.waitForTimeout(400);
  }, async (p) => {
    await p.waitForTimeout(400);
    const input = p.locator('.term-input-row input').first(); await input.click();
    for (const line of ['enable', 'show ip interface brief', 'show ip route', 'ping 10.2.0.10']) {
      await type(p, line, 60); await p.keyboard.press('Enter'); await p.waitForTimeout(1300);
    }
    await p.waitForTimeout(1500);
  });
  await clip(b, 'apps', async (p) => {
    await openLab(p, 'Office edge');
    await p.locator('.react-flow__node', { hasText: 'PC1' }).first().dblclick(); await p.waitForTimeout(500);
  }, async (p) => {
    await p.waitForTimeout(600);
    await p.locator('.app-tile', { hasText: 'Web Browser' }).click(); await p.waitForTimeout(500);
    await p.locator('.browser-url').click(); await p.keyboard.press('ControlOrMeta+a');
    await type(p, 'http://203.0.113.80/', 70); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
    await p.getByText(/Show what happened/).click(); await p.waitForTimeout(1800);
    await p.locator('.browser-doc a').first().click(); await p.waitForTimeout(1800);
    await p.locator('.app-bar button').first().click(); await p.waitForTimeout(400);
    await p.locator('.app-tile', { hasText: 'FTP Client' }).click(); await p.waitForTimeout(400);
    await p.locator('input[placeholder^="10.0.0.5"]').click(); await type(p, '203.0.113.80', 60);
    await p.locator('.ftp .app-form input').nth(1).click(); await type(p, 'kavya', 60);
    await p.locator('.ftp .app-form input[type=password]').click(); await type(p, 'cisco', 60);
    await p.getByRole('button', { name: 'Connect' }).click(); await p.waitForTimeout(2500);
  });
  await b.close();
})();
