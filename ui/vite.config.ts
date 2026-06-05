import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

/**
 * Substrate Web UI build config.
 *
 * Output: `../dist/ui/` (one level up from this Vite root). The Hono server
 * serves these as static assets via `src/http/routes/static.ts`. The
 * published npm package bundles `dist/ui/`, so end-users never run Vite.
 *
 * Tailwind v4 uses the Vite plugin (`@tailwindcss/vite`) — not the
 * PostCSS-based v3 toolchain. CSS-first config: see `src/styles.css`
 * (`@import 'tailwindcss';` and any `@theme` blocks live there).
 *
 * React 19 (not 18 as the Phase 1 plan originally assumed): pnpm pulled
 * 19.2.6 as current. createRoot API is unchanged from 18; no source-level
 * differences for our minimal shell.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@core` → the server's source-of-truth types. UI imports TYPES ONLY
    // (`import type`), so nothing is emitted into the bundle.
    alias: { '@core': resolve(__dirname, '..', 'src', 'core') },
  },
  build: {
    outDir: resolve(__dirname, '..', 'dist', 'ui'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    // Dev-only proxy. In production, the Hono server serves both /api/* and
    // the static UI from the same origin. During `vite dev`, proxy /api to
    // a separately-running substrate serve.
    proxy: {
      '/api': 'http://localhost:7475',
    },
  },
});
