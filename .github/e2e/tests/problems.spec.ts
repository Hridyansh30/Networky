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

test('Start over keeps the cables on the canvas', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('./#/problems/static-routes');
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Start over' }).click();
  // The rebuilt network has the same hostnames with new port ids.
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  expect(problems).toEqual([]);
});

test('a predict problem: answer, see why, replay, and keep the first-try XP', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('./#/problems/predict-ping-vs-port');
  await expect(page.getByText('Saved automatically')).toBeVisible();
  // Nothing to run or submit, and no ping panel until every answer is in.
  await expect(page.getByRole('button', { name: 'Submit' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /Simulation/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Questions' }).click();

  const answer = async (n: number, label: string) => {
    const card = page.locator('.question').nth(n);
    await card.getByLabel(label).check();
    await card.getByRole('button', { name: 'Lock in answer' }).click();
  };
  await answer(0, 'It succeeds');
  await expect(page.locator('.question').nth(0).getByText('Correct.')).toBeVisible();
  await answer(1, 'It succeeds');
  await answer(2, 'It gets no answer'); // wrong on purpose: the port refuses
  await expect(page.getByText('Not this time. It is refused.')).toBeVisible();
  await expect(page.getByText('2 of 3 correct')).toBeVisible();

  // Now the replay and the ping panel are available.
  await page.locator('.question').nth(2).getByRole('button', { name: 'Show me' }).click();
  await expect(page.getByRole('radio', { name: /Simulation/ })).toHaveAttribute('aria-checked', 'true');

  // Second attempt, all right: solved, but XP stays at the first try's share (2/3 of 10).
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Try again' }).click();
  await answer(0, 'It succeeds');
  await answer(1, 'It succeeds');
  await answer(2, 'It is refused');
  await expect(page.getByText('3 of 3 correct')).toBeVisible();
  await expect(page.getByText(/gives you 6 XP, from your first attempt \(67% right\)/)).toBeVisible();

  await page.reload();
  await page.getByRole('tab', { name: 'Questions' }).click();
  await expect(page.getByText('3 of 3 correct')).toBeVisible();
  expect(problems).toEqual([]);
});
