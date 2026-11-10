import type { Page } from '@playwright/test';

/**
 * Collects everything that should never happen on a healthy page:
 * uncaught exceptions, console errors, failed requests and CSP violations.
 * Call before page.goto, then assert the list is empty.
 */
export function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => {
    // A browser routinely cancels part of a video download (it fetches the
    // start, then pauses or switches source). That is not a fault. A missing
    // video still fails the test through the HTTP status check below.
    if (r.resourceType() === 'media' && r.failure()?.errorText === 'net::ERR_ABORTED') return;
    problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  // CSP violations are reported as DOM events, not always as console errors.
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`);
    });
  });
  return problems;
}
