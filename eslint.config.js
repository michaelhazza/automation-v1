import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'client/dist/**', 'coverage/**', 'migrations/**', '.worktrees/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-undef': 'off',
    },
  },
  {
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { project: './server/tsconfig.json' },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { project: './tsconfig.json' },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Worker T8 boundary — bans direct imports of the integrationConnections
  // Drizzle table from worker code. The single permitted importer is
  // worker/src/persistence/integrationConnections.ts, which exposes
  // tenant-isolated single-purpose fetchers (getWebLoginConnectionForRun, ...).
  // Spec: docs/reporting-agent-paywall-workflow-spec.md §6.6.2 (T8).
  // Ported from the legacy worker/.eslintrc.cjs (deleted) — ESLint v10 flat
  // config does not auto-load .eslintrc.* files, so the rule must live here
  // to be enforced.
  {
    files: ['worker/**/*.{ts,cjs,js}'],
    ignores: ['worker/src/persistence/integrationConnections.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/server/db/schema/integrationConnections',
                '**/server/db/schema/integrationConnections.js',
              ],
              message:
                'Worker code must not import the integrationConnections table directly. ' +
                'Use getWebLoginConnectionForRun() in worker/src/persistence/integrationConnections.ts. ' +
                'Spec: T8 / docs/reporting-agent-paywall-workflow-spec.md §6.6.2.',
            },
          ],
        },
      ],
    },
  },
);
