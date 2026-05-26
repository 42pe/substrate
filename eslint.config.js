// ESLint flat config (ESLint 9). See https://eslint.org/docs/latest/use/configure/configuration-files
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      // The ui/ subpackage has its own tsconfig (different lib, jsx,
      // bundler module resolution). Root ESLint cannot resolve its files
      // via the root tsconfig.json's "project" reference. Phase 5 may
      // add a UI-specific ESLint config; for Phase 1 we just exclude it.
      'ui/**',
      'coverage/**',
      '.substrate/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'import/no-cycle': ['error', { maxDepth: 10 }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
