import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import { plugin as shadcn } from '@shadcn/lint';

export default [
  {
    ignores: [
      'public/assets/**',
      '**/public/assets/**',
      'dist/**',
      'node_modules/**',
      '.worktrees/**',
      'scripts/playwright-*.mjs',
      'api/**/*.js',
      'api/**/*.js.map',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  js.configs.recommended,
  prettierConfig,
  // ── Node.js (API handlers, libs, scripts, tests) ──
  {
    files: [
      'api/**/*.{js,ts}',
      'scripts/**/*.{js,mjs}',
      'test_local.mjs',
      '*.config.js',
    ],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        require: 'readonly',
        module: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  // ── Browser (React frontend) ──
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        navigator: 'readonly',
        FormData: 'readonly',
        FileReader: 'readonly',
        URLSearchParams: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLAnchorElement: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        DragEvent: 'readonly',
        ClipboardEvent: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        structuredClone: 'readonly',
      },
    },
    plugins: {
      shadcn,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'react-hooks/exhaustive-deps': 'off',
      'shadcn/no-unknown-classes': 'error',
      'shadcn/no-raw-colors': 'error',
      'shadcn/no-inline-styles': 'error',
      'shadcn/require-static-classes': 'error',
      // Layout livre; aparência vem de variant/size/density dos componentes em src/components/ui.
      'shadcn/no-restyle': [
        'error',
        {
          allow: ['layout'],
          contracts: [
            { pattern: '^Table$', allow: ['layout', 'typography'] },
            {
              pattern: '^TableCell$',
              allow: ['layout', 'typography', 'text-fg-muted', 'text-destructive'],
            },
            { pattern: '^Button$', allow: ['layout', 'font-mono', 'font-normal', 'font-semibold', 'truncate', 'shadow-*'] },
            { pattern: '^Input$', allow: ['layout', 'font-mono', 'font-medium', 'tracking-widest', 'pl-*', 'pr-*'] },
            { pattern: '^Textarea$', allow: ['layout', 'font-mono', 'pt-*'] },
          ],
        },
      ],
      // Medidas de layout (grids, alturas de gráfico) podem ser arbitrárias; aparência usa tokens do tema.
      'shadcn/no-arbitrary-values': ['error', { allow: ['layout', 'transition-[width]'] }],
    },
  },
  // ── TypeScript (frontend + backend futuro) ──
  {
    files: ['src/**/*.{ts,tsx}', 'api/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json', './api/tsconfig.api.json'],
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // ── Tests (Playwright) ──
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  // ── Playwright / browser test scripts (node env + browser globals) ──
  {
    files: ['scripts/playwright-*.mjs', 'scripts/test-*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        location: 'readonly',
        document: 'readonly',
        window: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-useless-escape': 'off',
    },
  },
];
