// Must be the FIRST import in main.tsx.
//
// Zod 4 compiles fast validators with `new Function(...)` and probes for it at
// start-up. Our Content-Security-Policy (script-src 'self', see vite.config.ts)
// correctly forbids eval, so the probe raises a CSP violation report even
// though Zod catches the error. Jitless mode skips the probe and the compiled
// validators; validation results are identical, only slightly slower, and our
// files are small (2 MB cap). We keep the strict CSP rather than adding
// 'unsafe-eval', which would re-enable eval for any injected script too.
//
// It is a separate module because ES imports are hoisted: a z.config() call in
// main.tsx's body would run after every other module (and its schemas) loaded.
import { z } from 'zod';

z.config({ jitless: true });
