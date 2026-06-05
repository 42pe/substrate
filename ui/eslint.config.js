import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * UI ESLint (flat config). Separate from the root config (which ignores ui/**).
 *
 * The load-bearing rule (R-P5-3): `dangerouslySetInnerHTML` is BANNED everywhere
 * except `Markdown.tsx`, which carries one justified eslint-disable. This turns
 * the "single sanitized render path" invariant from a convention into CI.
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            'dangerouslySetInnerHTML is banned. Render author content via <Markdown>, which is the single DOMPurify-sanitized path.',
        },
      ],
    },
  },
  {
    // Markdown.tsx is the ONE allowed render path — the rule is disabled inline there.
    files: ['src/components/Markdown.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Data-fetching hooks: setting state inside the effect after an async
    // resolve is the canonical pattern (with an active-token guard), not the
    // anti-pattern this rule targets.
    files: ['src/lib/use*.ts'],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
