import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the Phase 5b UI smoke. Separate from Vitest — these
 * `*.spec.ts` files are NOT matched by any vitest project and are NOT part of
 * `pnpm test`. Run via `pnpm test:smoke:ui`, which builds `dist/ui` first
 * (the smoke serves the real build, not the placeholder — plan C5).
 */
export default defineConfig({
  testDir: './tests/smoke',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  timeout: 30_000,
  use: {
    headless: true,
  },
});
