import { expect, test } from '@playwright/test';
import { watchForProblems } from './guards';

test('the landing page loads without errors', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('./');

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  await expect(page.locator('h1')).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(problems).toEqual([]);
});

test('workspace links point at the configured workspace URL', async ({ page }) => {
  await page.goto('./');
  const html = await page.content();
  expect(html).not.toContain('__WORKSPACE_URL__'); // placeholder must be replaced at build time

  const expected = process.env.VITE_WORKSPACE_URL;
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  const external = hrefs.filter((h) => /^https?:/.test(h));
  expect(external.length).toBeGreaterThan(0);
  for (const href of external) expect(href.startsWith('https://') || href.startsWith('http://localhost')).toBe(true);
  if (expected) expect(hrefs.some((h) => h.startsWith(expected))).toBe(true);
});
