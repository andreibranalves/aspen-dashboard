import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import { plugin as shadcn } from '@shadcn/lint';

const ICON_SIZES = [12, 14, 16, 20, 24, 32, 48];
const Z_INDEX_MESSAGE = 'Use as camadas z-sticky, z-nav, z-floating ou z-overlay.';
const HEADING_TYPE = String.raw`\b(text-(3xs|2xs|xs|sm|base|lead|lg|xl|stat|title|hero)|font-(medium|semibold|bold))\b`;

const designScaleSyntax = [
  {
    selector: `JSXAttribute[name.name='size'] > JSXExpressionContainer > Literal${ICON_SIZES.map((n) => `[value!=${n}]`).join('')}`,
    message: `Tamanho de ícone fora da escala (${ICON_SIZES.join('/')}).`,
  },
  {
    selector:
      "JSXOpeningElement[name.name=/^(div|span|p|li|ul|ol|section|article|header|footer|main|aside|nav|td|th|tr|img|label|form)$/]:has(> JSXAttribute[name.name='onClick']):not(:has(> JSXAttribute[name.name=/^(role|aria-hidden)$/])):not(:has(CallExpression[callee.property.name='stopPropagation']))",
    message:
      'onClick em elemento não interativo: use Button, MenuItem ou TableRow. Camada só de ponteiro (fechar ao clicar fora) declara aria-hidden="true"; stopPropagation é aceito.',
  },
  { selector: String.raw`Literal[value=/(^|\s)-?z-\d/]`, message: Z_INDEX_MESSAGE },
  { selector: String.raw`TemplateElement[value.raw=/(^|\s)-?z-\d/]`, message: Z_INDEX_MESSAGE },
];

const featureSyntax = [
  {
    selector:
      "JSXOpeningElement[name.name='button']:not(:has(JSXAttribute[name.name=/^(role|aria-expanded|aria-pressed|aria-selected|aria-current)$/]))",
    message:
      'Use Button ou MenuItem de @/components/ui. <button> cru só para toggle (aria-expanded), seleção (aria-pressed/aria-selected) ou navegação (aria-current).',
  },
  {
    selector:
      "JSXOpeningElement[name.name='Button']:has(JSXAttribute[name.name='size'][value.value=/^icon/]):not(:has(JSXAttribute[name.name=/^aria-label(ledby)?$/]))",
    message: 'Botão só com ícone precisa de aria-label.',
  },
  {
    selector: `JSXOpeningElement[name.name=/^h[1-6]$/]:has(JSXAttribute[name.name='className'] :matches(Literal[value=/${HEADING_TYPE}/], TemplateElement[value.raw=/${HEADING_TYPE}/]))`,
    message: 'Use Heading de @/components/ui/heading para tipografia de título.',
  },
];

export default [
  {
    ignores: [
      'public/assets/**',
      '**/public/assets/**',
      'dist/**',
      'node_modules/**',
      '.worktrees/**',
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
            { pattern: '^Heading$', allow: ['layout', 'truncate', 'gap-*'] },
          ],
        },
      ],
      // Medidas de layout (grids, alturas de gráfico) podem ser arbitrárias; aparência usa tokens do tema.
      'shadcn/no-arbitrary-values': ['error', { allow: ['layout', 'transition-[width]'] }],
    },
  },
  // ── Escalas do design system em todo o front ──
  // Ícone: 12/14/16/20 na UI; 24/32/48 em empty state e placeholder; camadas: z-sticky/nav/floating/overlay.
  {
    files: ['src/**/*.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...designScaleSyntax] },
  },
  // ── Features compõem primitivos (Button, MenuItem, Heading) ──
  // <button> cru só é aceito quando declara semântica que não é ação
  // (toggle, seleção, navegação); demais exceções usam eslint-disable com motivo.
  {
    files: ['src/features/**/*.tsx', 'src/app/**/*.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...designScaleSyntax, ...featureSyntax] },
  },
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
  // ── Scripts de teste (node + globals de browser) ──
  {
    files: ['scripts/test-*.mjs'],
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
