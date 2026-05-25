import { defineConfig } from 'vitest/config';

// Multi-project setup:
//  - "unit": fast, parallel, source-collocated *.test.ts files in src/
//  - "integration": serialized (single fork) integration tests in tests/integration/
//
// Smoke tests live in tests/smoke/ and run via dedicated `pnpm test:smoke:*`
// scripts; they are not included in the default `pnpm test` run.

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
          pool: 'forks',
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/policy/**', 'src/storage/**'],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
      },
    },
  },
});
