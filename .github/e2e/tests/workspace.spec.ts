import { expect, test } from '@playwright/test';
import { watchForProblems } from './guards';

test('the workspace loads and renders without errors', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('./');

  // The production CSP must be present (it is only added by `vite build`).
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("connect-src 'self'");

  // React mounted a visible UI (a blank page means the bundle crashed).
  await expect(page.locator('#root *:visible').first()).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(problems).toEqual([]);
});
