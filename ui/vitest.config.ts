import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * UI test runner — jsdom (the root Vitest is node-only). Covers the markdown
 * sanitizer (security-critical) and light component tests. The `@core` alias
 * mirrors vite.config.ts / tsconfig.json so type-only imports resolve here too.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, '..', 'src', 'core'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
});
