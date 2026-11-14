// Runs before every test file.
//
// UI tests render pages that ask the API who is signed in. There is no server
// in a unit test, so in the browser-like (jsdom) environment fetch fails at
// once, exactly like a static copy of Networky with no /api: the app falls
// back to guest mode in this browser. Tests that need a server stub fetch
// themselves (see src/store/remoteProgress.test.ts).
import { vi } from 'vitest';

if (typeof document !== 'undefined') {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('No server in unit tests'))));
}
