import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Import the reference codec straight from its TypeScript source — no build,
// no publish. The demo is always in sync with reference/js/src.
export default defineConfig({
  // Relative asset URLs, so the built demo works both when served from a
  // subpath (GitHub Pages at /posy/demo/) and when opened straight from disk.
  base: './',
  resolve: {
    alias: {
      posy: fileURLToPath(new URL('../../reference/js/src/index.ts', import.meta.url)),
    },
  },
  server: { open: true },
});
