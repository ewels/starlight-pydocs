import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.astro/**',
      'docs/playwright-report/**',
      'docs/test-results/**',
      'fixtures/**/*.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  ...astro.configs['jsx-a11y-recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Custom-element runtime lives in scoped <script> tags compiled by Astro;
    // these globals are part of the DOM lib.
    files: ['**/*.astro'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    plugins: { 'jsx-a11y': jsxA11y },
  },
  {
    // Ambient declaration files legitimately use `import()` types and the
    // empty-interface augmentation pattern (extending Starlight's I18n).
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
