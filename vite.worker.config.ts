// Builds the API for Cloudflare Pages: server/worker.ts -> dist/_worker.js.
// Runs after the app build (npm run build), into the same dist/ folder, so
// the existing deploy step uploads both without knowing about the API.
//
// One ES module, everything bundled (Hono, zod, the engine): Workers load no
// packages at runtime.
//
// Private content: with NETWORKY_PRIVATE_CONTENT=<path to a checkout of the
// private content repo>, the import of server/privateContent.ts is redirected
// to <path>/server.ts. Only this (server) build does that; the web build never
// sees the variable, and scripts/check-bundle.mjs checks it stayed out.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function privateContent(): Plugin | null {
  const dir = process.env.NETWORKY_PRIVATE_CONTENT;
  if (!dir) return null;
  const entry = resolve(dir, 'server.ts');
  if (!existsSync(entry)) throw new Error(`NETWORKY_PRIVATE_CONTENT is set but ${entry} does not exist`);
  const stub = resolve(__dirname, 'server/privateContent.ts');
  return {
    name: 'networky-private-content',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.endsWith('privateContent')) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      return r?.id === stub ? entry : null;
    },
  };
}

export default defineConfig({
  plugins: [privateContent()],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false, // the app is already there
    target: 'es2022',
    minify: true,
    sourcemap: false,
    ssr: 'server/worker.ts',
    rollupOptions: {
      output: { entryFileNames: '_worker.js', format: 'es', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true, target: 'webworker' },
});
