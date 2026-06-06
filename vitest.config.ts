import { defineConfig } from 'vitest/config';

// Multi-project setup:
//  - "unit": fast, parallel, source-collocated *.test.ts files in src/
//  - "integration": serialized (fileParallelism: false) integration tests
//    in tests/integration/ — needed because some integration tests bind to
//    a fixed port (substrate.serve uses 7475 by default).
//
// Smoke tests live in tests/smoke/ and run via dedicated `pnpm test:smoke:*`
// scripts; they are excluded from the default `pnpm test` run.
//
// Notes on Vitest 4: `poolOptions` is no longer a project-level option;
// the file-parallelism control moved to `fileParallelism` (boolean) and lives
// at the project level. See https://vitest.dev/guide/migration#pool-rework.

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          // Several integration tests spawn the CLI (`npx tsx` → node) and
          // wait up to 15s for the server to bind. The default 5s per-test
          // timeout fires before those internal waits on a cold CI runner
          // (cold tsx compile + process spawn), so raise it well above 15s.
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'smoke',
          include: ['tests/smoke/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          // Smoke tests are long (60s+). Default pnpm test scripts filter
          // them out via `--project=unit --project=integration`; only
          // `pnpm test:smoke:*` runs them.
          testTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Phase 1 doesn't have src/policy/ yet — added in Phase 3.
      include: ['src/core/**', 'src/storage/**'],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
      },
    },
  },
});
