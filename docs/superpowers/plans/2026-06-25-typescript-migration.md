# TypeScript Migration — Implementation Plan (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir TypeScript no projeto de forma segura, começando pela menor superfície possível: duas libs puras do frontend. Validar que build, lint, testes e deploy continuam funcionando antes de expandir.

**Architecture:** TypeScript coexiste com JavaScript (`allowJs: true`, `checkJs: false`). Fase 1 converte apenas `src/lib/utils.js` e `src/lib/formatters.js` para `.ts`. O frontend usa imports extensionless (`@/lib/utils`) porque o Vite resolve. O backend (`api/`) permanece em `.js` sem type-check global; usaremos `@ts-check` por arquivo quando valer a pena.

**Tech Stack:** React 19, Vite 6, Node ESM, Vercel serverless, TypeScript 5.x, ESLint, Prettier.

## Global Constraints

- **ESM only** — imports locais continuam exigindo extensão `.js` em arquivos `.js`; imports TypeScript no frontend usam caminho extensionless (`@/lib/utils`) porque Vite resolve.
- **Vite build into `public/`** com `emptyOutDir: false`.
- **Não adicionar dependências sem aprovação explícita do usuário.** TypeScript e `@types/node` são devDependencies necessárias para esta tarefa.
- **Mensagens de erro da API em português brasileiro** permanecem inalteradas.
- **Build e deploy devem continuar funcionando** após cada task.
- **Testes unitários com `node --test`** devem continuar passando.
- **Não converter Button, hooks ou backend nesta fase.** Foco em provar o pipeline primeiro.

---

### Task 1: Instalar TypeScript e `@types/node`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: TypeScript e tipos do Node disponíveis como devDependencies.

- [ ] **Step 1: Instalar pacotes**

```bash
npm install -D typescript@^5.5.0 @types/node@^20.0.0
```

Expected: `package.json` atualizado com `typescript` e `@types/node` em `devDependencies`.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install TypeScript and Node types"
```

---

### Task 2: Criar `tsconfig.json`

**Files:**
- Create: `tsconfig.json`

**Interfaces:**
- Produces: configuração base que permite JS + TS coexistirem, sem emitir arquivos.

- [ ] **Step 1: Criar `tsconfig.json` na raiz**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "types": ["node", "vite/client"]
  },
  "include": ["src/**/*", "api/**/*", "scripts/**/*", "tests/**/*"],
  "exclude": ["node_modules", "public", "dist", "ts-out"]
}
```

- [ ] **Step 2: Adicionar script de type-check no `package.json`**

Modify `package.json` scripts section, adicionar:

```json
"type-check": "tsc --noEmit"
```

E atualizar `check`:

```json
"check": "npm run lint && npm run type-check && npm run build"
```

- [ ] **Step 3: Rodar type-check baseline**

```bash
npx tsc --noEmit
```

Expected: sucesso (0 erros), pois `checkJs` está `false`.

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json package.json
git commit -m "chore: add tsconfig with allowJs baseline"
```

---

### Task 3: Configurar ESLint e Prettier para TS

**Files:**
- Modify: `eslint.config.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `tsconfig.json`.
- Produces: lint e format reconhecem `.ts`/`.tsx`.

- [ ] **Step 1: Instalar plugin TypeScript para ESLint**

```bash
npm install -D @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

- [ ] **Step 2: Atualizar `eslint.config.js`**

Adicionar imports no topo:

```js
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
```

Adicionar bloco TypeScript antes do bloco de tests:

```js
// ── TypeScript (frontend + backend futuro) ──
{
  files: ['src/**/*.{ts,tsx}', 'api/**/*.{ts,tsx}'],
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      project: './tsconfig.json',
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
```

Atualizar os globs existentes:
- `src/**/*.{js,jsx}` → `src/**/*.{js,jsx,ts,tsx}`
- `api/**/*.js` → `api/**/*.{js,ts}`

- [ ] **Step 3: Atualizar scripts de format**

```json
"format": "prettier --write \"**/*.{js,jsx,ts,tsx,json,css,md}\"",
"format:check": "prettier --check \"**/*.{js,jsx,ts,tsx,json,css,md}\""
```

- [ ] **Step 4: Rodar lint e build**

```bash
npm run lint
npm run build
```

Expected: ambos terminam com sucesso.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js package.json package-lock.json
git commit -m "chore: configure eslint and prettier for TypeScript"
```

---

### Task 4: Converter `src/lib/utils.js` para TypeScript

**Files:**
- Delete: `src/lib/utils.js`
- Create: `src/lib/utils.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[])` tipado.

- [ ] **Step 1: Criar `src/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Remover `src/lib/utils.js`**

```bash
rm src/lib/utils.js
```

- [ ] **Step 3: Validar**

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Expected: sucesso.

- [ ] **Step 4: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.js
git commit -m "refactor: convert src/lib/utils to TypeScript"
```

---

### Task 5: Converter `src/lib/formatters.js` para TypeScript com testes

**Files:**
- Delete: `src/lib/formatters.js`
- Create: `src/lib/formatters.ts`
- Create: `tests/unit/formatters.test.ts`

**Interfaces:**
- Produces: funções utilitárias de formatação tipadas e testadas.

- [ ] **Step 1: Criar `src/lib/formatters.ts`**

```ts
/**
 * Formatters — portados do dashboard.html original.
 */

/** R$ 1.455,30 (pontos nos milhares, vírgula decimal) */
export function formatBRL(value: string | number | null | undefined): string {
  const num = Number(value);
  if (Number.isNaN(num)) return 'R$ 0,00';
  const [int, dec] = Math.abs(num).toFixed(2).split('.');
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${num < 0 ? '-' : ''}R$ ${intFormatted},${dec}`;
}

export function normalizePhoneDigits(phone: unknown, maxDigits = 11): string {
  return String(phone ?? '').replace(/\D/g, '').slice(0, maxDigits);
}

/** (99) 99999-9999 */
export function fmtPhone(phone: unknown): string {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function formatPhoneInput(phone: unknown): string {
  return fmtPhone(normalizePhoneDigits(phone));
}

/** Nome Próprio → Cada Palavra Capitalizada */
export function capitalize(str: unknown): string {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** ISO date → DD/MM/YYYY */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('pt-BR');
}

/** Bom dia / Boa tarde / Boa noite */
export function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
```

- [ ] **Step 2: Criar `tests/unit/formatters.test.ts`**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBRL, fmtPhone, capitalize, formatDate } from '../../src/lib/formatters.ts';

describe('formatBRL', () => {
  it('formats integer with BRL', () => {
    assert.equal(formatBRL(1455.3), 'R$ 1.455,30');
  });

  it('returns zero for invalid input', () => {
    assert.equal(formatBRL('abc'), 'R$ 0,00');
  });
});

describe('fmtPhone', () => {
  it('formats 11-digit mobile', () => {
    assert.equal(fmtPhone('11999998888'), '(11) 99999-8888');
  });

  it('returns empty for empty input', () => {
    assert.equal(fmtPhone(''), '');
  });
});

describe('capitalize', () => {
  it('capitalizes each word', () => {
    assert.equal(capitalize('joão silva'), 'João Silva');
  });
});

describe('formatDate', () => {
  it('formats ISO date to pt-BR', () => {
    assert.equal(formatDate('2024-05-20'), '20/05/2024');
  });
});
```

- [ ] **Step 3: Atualizar script de teste unitário**

No `package.json`:

```json
"test:unit": "node --test tests/unit/*.test.{js,ts}"
```

> Nota: `node --test` com arquivos `.ts` requer Node 22+ com type stripping. O ambiente atual usa Node 24, então funciona. Se o CI usar Node mais antigo, este teste precisa ser transpilado.

- [ ] **Step 4: Remover `src/lib/formatters.js`**

```bash
rm src/lib/formatters.js
```

- [ ] **Step 5: Validar tudo**

```bash
npm run test:unit
npm run lint
npx tsc --noEmit
npm run build
```

Expected: todos sucesso.

- [ ] **Step 6: Commit**

```bash
git add src/lib/formatters.ts tests/unit/formatters.test.ts package.json src/lib/formatters.js
git commit -m "refactor: convert formatters to TypeScript and add tests"
```

---

### Task 6: Documentar próximos passos e decisões

**Files:**
- Create: `docs/typescript-migration-next-steps.md`

**Interfaces:**
- Produces: documento vivo com o que foi feito, próximos passos e armadilhas.

- [ ] **Step 1: Criar documento**

```markdown
# TypeScript Migration — Next Steps

## Fase 1 concluída

- TypeScript + `@types/node` instalados.
- `tsconfig.json` com `allowJs: true`, `checkJs: false`, `noEmit: true`.
- ESLint e Prettier configurados para `.ts`/`.tsx`.
- Convertidos para TypeScript:
  - `src/lib/utils.ts`
  - `src/lib/formatters.ts` (com testes)
- Pipeline validado: `test:unit`, `lint`, `type-check`, `build`.

## Decisões tomadas

- **Imports extensionless no frontend:** usamos `@/lib/utils` ao invés de `@/lib/utils.ts`. O Vite resolve. Isso evita problemas com `allowImportingTsExtensions` e deixa o código mais limpo.
- **Backend continua em JS:** não ativamos `checkJs` globalmente. Quando quisermos type safety em um arquivo `.js` específico, usamos `// @ts-check` no topo do arquivo.
- **Node type stripping:** os testes `.ts` usam `node --test` com type stripping (Node 22+). O ambiente atual usa Node 24.

## Próximos passos sugeridos (em ordem)

1. **Frontend libs puras**
   - `src/lib/constants.js`
   - `src/lib/erpLinks.js`
   - `src/lib/printFormats.js`
   - `src/lib/api.js`

2. **Componentes UI atômicos**
   - `src/components/ui/input.jsx`
   - `src/components/ui/badge.jsx`
   - `src/components/ui/table.jsx`
   - `src/components/ui/back-button.jsx`

3. **Hooks pequenos**
   - `src/hooks/useDarkMode.js`
   - `src/hooks/useImageInput.js`

4. **Backend libs puras (com `// @ts-check` ou `.ts`)**
   - `api/_functions/lib/time-greeting.js`
   - `api/_functions/lib/quote-response.js`
   - `api/_functions/lib/client-metadata.js`

5. **Handlers de API (futuro, maior risco)**
   - Requer validar build no Vercel com `.ts` em `api/`.
   - Começar por `login.js` / `logout.js`.
   - Deixar `pricing.js`, `extract.js`, `orcamento.js` para o final.

## Quando parar

- Pare quando o custo de tipar um arquivo superar o benefício claro.
- Não é necessário converter 100% do projeto.
- Integrações externas mal documentadas (ERPNext, Frappe) podem usar `any` ou interfaces parciais.

## Riscos a monitorar

- `checkJs: true` global no backend gera muitos erros — não ative sem planejamento.
- Vercel Functions com `.ts` precisam ser testados em deploy de preview antes de produção.
- `node --test` com `.ts` pode falhar em Node < 22.
```

- [ ] **Step 2: Commit**

```bash
git add docs/typescript-migration-next-steps.md
git commit -m "docs: add TypeScript migration next steps"
```

---

## Self-Review

**1. Spec coverage:** A Fase 1 cobre instalação, configuração, lint/format, conversão de duas libs puras e testes. Próximos passos estão documentados. Nenhum requisito do usuário ficou sem task.

**2. Placeholder scan:** Nenhum "TBD", "TODO", "implement later" ou "add appropriate error handling". Código e comandos estão completos.

**3. Type consistency:** `cn` em `utils.ts` retorna `string` e é consumido por componentes JSX. `formatBRL`, `fmtPhone`, `capitalize` e `formatDate` têm assinaturas consistentes entre implementação e testes.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-25-typescript-migration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
