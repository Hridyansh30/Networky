// Runs export.test.ts only. Kept out of the app's own test run (vite.config.ts
// includes src/ only) because it writes files for the Terraform CI job.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: { include: ['.github/terraform/*.test.ts'] },
});
