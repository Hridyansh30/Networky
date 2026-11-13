import { expect, test } from '@playwright/test';
import { watchForProblems } from './guards';

// The phase 5 loop end to end, on the production build (strict CSP, real
// grader Web Worker, real IndexedDB): open a problem, fix the network,
// submit, see it accepted, reload, and find the progress still there.

// Wide enough that the canvas shows every device clear of the legend.
test.use({ viewport: { width: 1600, height: 1000 } });

test('solve a problem, then find it solved after a reload', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('./#/problems');
  await expect(page.getByRole('heading', { name: /Computer Networking Problems/ })).toBeVisible();
  await page.getByRole('link', { name: 'Your first ping', exact: true }).click();

  // The problem opens in the workspace with its start network.
  await expect(page.getByText('Saved automatically')).toBeVisible();
  await page.locator('.react-flow__node').filter({ hasText: 'PC1' }).click();
  const address = page.getByLabel('FastEthernet0 IPv4 address');
  await address.fill('192.168.1.11/24');
  await address.press('Enter');

  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Accepted. Every test passes.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/This problem now gives you 10 XP/)).toBeVisible();

  // Progress and the network survive a reload (IndexedDB).
  await page.reload();
  await expect(page.getByText('Saved automatically')).toBeVisible();
  await page.locator('.react-flow__node').filter({ hasText: 'PC1' }).click();
  await expect(page.getByLabel('FastEthernet0 IPv4 address')).toHaveValue('192.168.1.11/24');
  await page.goto('./#/problems');
  const row = page.getByRole('row').filter({ hasText: 'Your first ping' });
  await expect(row.getByText('Solved')).toBeVisible();
  await expect(page.locator('.topnav .xp-count')).toHaveText('10 / 50 XP');

  expect(problems).toEqual([]);
});

test('a hidden test stays hidden on Run and a failing visible test offers Show me', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('./#/problems/static-routes');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText(/Run: 0 of 2 visible tests pass/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Hidden test', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Show me' }).first().click();
  await expect(page.getByRole('radio', { name: /Simulation/ })).toHaveAttribute('aria-checked', 'true');
  expect(problems).toEqual([]);
});
