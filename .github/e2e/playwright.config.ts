import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests against the PRODUCTION build of each app, served by `vite preview`.
 * Testing the real build matters: the Content-Security-Policy is only added at
 * build time, so a dev-server test would never catch a CSP that breaks the page.
 *
 *   APP_DIR=/path/to/networky        npx playwright test --project=workspace
 *   APP_DIR=/path/to/networky/landing npx playwright test --project=landing
 *
 * The app must already be built (`npm run build` in APP_DIR).
 */
const APP = process.env.APP ?? 'workspace';
const APP_DIR = process.env.APP_DIR ?? '../..';
const PORT = APP === 'landing' ? 4174 : 4173; // landing's vite config pins 4174

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI, // a stray test.only must not silently skip the rest
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    // Local runs can point at an already installed Chromium.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'workspace', testMatch: /workspace\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'landing', testMatch: /landing\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    cwd: APP_DIR,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
