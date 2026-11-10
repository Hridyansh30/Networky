// Renders public/og-image.png (1200x630), the picture shown when someone
// shares the landing page link. It is the dark hero with the nav, buttons and
// everything below the hero hidden, and reduced motion on so nothing is
// caught half-animated.
//
//   npm run build && npm run preview     (serves http://localhost:4174)
//   node scripts/og-image.cjs [url] [out]
//
// The page's CSP blocks injected <style> tags, so the hiding is done through
// element.style, which a CSP allows.
const { chromium } = require('playwright');

const url = process.argv[2] || 'http://localhost:4174/';
const out = process.argv[3] || 'public/og-image.png';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'dark', reducedMotion: 'reduce', deviceScaleFactor: 1 });
  await page.goto(url);
  await page.evaluate(() => {
    document.querySelectorAll('.nav, .hero-actions, main > :not(.hero), footer').forEach((el) => (el.style.display = 'none'));
    document.querySelector('.hero').style.paddingTop = '116px';
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: out });
  await browser.close();
  console.log('wrote', out, '(about 125 KB; a 256-colour quantise brings it under 50 KB)');
})();
