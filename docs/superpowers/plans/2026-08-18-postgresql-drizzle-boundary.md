# PostgreSQL + Drizzle Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar o boundary PostgreSQL + Drizzle e impedir novos acessos diretos fora das exceções atuais, sem mudar comportamento de runtime.

**Architecture:** Um scanner estático nativo do Node.js examina somente módulos TypeScript sob `api/modules/` e compara cada import direto com uma allowlist de bindings atuais.
A documentação torna o fluxo `handler -> module/service -> repository -> infrastructure/db -> Drizzle -> PostgreSQL` explícito.
O check entra no `verify:fast` e em um job paralelo do CI antes do build.

**Tech Stack:** Node.js 22, npm, Node Test Runner, TypeScript, Markdown, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-18-postgresql-drizzle-boundary-design.md`

## Global Constraints

- A Fase 15 deve manter PostgreSQL e Drizzle, registrar o boundary vigente e impedir regressão estrutural sem alterar comportamento de negócio.
- O check deve aceitar as três exceções existentes e bloquear novos acessos diretos fora delas.
- Não trocar PostgreSQL, Drizzle, o driver `postgres`, o schema ou o modelo de repositories.
- Não mover `api/modules/operational-status.ts`, `api/modules/quotation-preview.ts` ou `api/modules/whatsapp-crm-match.ts` nesta fase.
- Não alterar tabelas, colunas, índices, constraints ou SQL histórico.
- Não executar ou gerar migrations.
- Não configurar banco staging, Preview, backup, canary ou deploy.
- Não remover dependências npm.
- Não alterar arquivos gerados em `public/` ou `api/`.
- Usar somente APIs nativas do Node.js no scanner.
- O scanner deve inspecionar imports estáticos e imports dinâmicos sob `api/modules/`.
- Os alvos diretos proibidos são `drizzle-orm`, qualquer subpath de `drizzle-orm`, `postgres`, qualquer subpath de `postgres`, `api/infrastructure/db/client.ts` ou `.js`, e `api/infrastructure/db/schema.ts` ou `.js`.
- Imports de `api/infrastructure/db/repositories/*.js` continuam permitidos em qualquer módulo.
- A allowlist deve comparar caminho normalizado, módulo importado e bindings efetivamente importados.
- Um novo binding direto dentro de um arquivo allowlisted deve falhar.
- O processo do scanner não deve ler valores de ambiente, abrir conexões ou executar comandos externos.
- O output do scanner não deve incluir credenciais, SQL de dados, payloads ou dados pessoais.
- O CI não deve executar migrations, E2E, deploy, chamadas externas ou usar secrets no job `boundary`.
- `verify:fast` deve preservar lint, typecheck e testes unitários, adicionando o check sem remover comandos existentes.
- Não alterar fixtures, rotas, assertions ou comportamento de testes existentes.
- Outputs TypeScript emitidos em `api/` devem ser removidos antes da conclusão.

---

## File Map

- `scripts/check-postgres-boundary.mjs`: scanner puro e CLI para detectar imports diretos.
- `tests/unit/postgres-boundary.test.ts`: testes unitários do scanner com fixtures em memória.
- `docs/postgresql-drizzle-boundary.md`: contrato arquitetural ativo para acesso PostgreSQL + Drizzle.
- `package.json`: script `check:db-boundary` e composição de `verify:fast`.
- `.github/workflows/ci.yml`: job paralelo `boundary` e dependência do job `build`.

## Task 1: Criar scanner estático com TDD

**Files:**

- Create: `tests/unit/postgres-boundary.test.ts`
- Create: `scripts/check-postgres-boundary.mjs`

**Interfaces:**

- Consumes: textos de módulos TypeScript com caminho relativo ao repository.
- Produces: `findPostgresBoundaryViolations(files)` retornando `{ path, line, target }[]` ordenado por caminho e linha.
- Later tasks consume: o comando CLI `node scripts/check-postgres-boundary.mjs` e a função exportada `findPostgresBoundaryViolations`.

- [ ] **Step 1: Escrever os testes vermelhos para a função pública**

Criar `tests/unit/postgres-boundary.test.ts` com Node Test Runner e `node:assert/strict`.

Usar este formato de fixture e estes comportamentos:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { findPostgresBoundaryViolations } from '../../scripts/check-postgres-boundary.mjs';

const source = (path: string, content: string) => ({ path, content });

test('rejects direct Drizzle imports in a new module with path and line', () => {
  const violations = findPostgresBoundaryViolations([
    source('api/modules/new-feature.ts', "import { eq } from 'drizzle-orm';\nexport const ok = true;\n"),
  ]);

  assert.deepEqual(violations, [
    { path: 'api/modules/new-feature.ts', line: 1, target: 'drizzle-orm' },
  ]);
});

test('rejects direct postgres imports and dynamic database imports', () => {
  const violations = findPostgresBoundaryViolations([
    source('api/modules/new-feature.ts', "import postgres from 'postgres';\n"),
    source('api/modules/other-feature.ts', "const load = () => import('../infrastructure/db/schema.js');\n"),
  ]);

  assert.deepEqual(violations, [
    { path: 'api/modules/new-feature.ts', line: 1, target: 'postgres' },
    { path: 'api/modules/other-feature.ts', line: 1, target: 'api/infrastructure/db/schema.ts' },
  ]);
});

test('accepts only the current bindings in every allowlisted module', () => {
  const violations = findPostgresBoundaryViolations([
    source(
      'api/modules/operational-status.ts',
      [
        "import { getDatabase } from '../infrastructure/db/client.js';",
        "import { appSettings } from '../infrastructure/db/schema.js';",
        "import { sql } from 'drizzle-orm';",
      ].join('\n'),
    ),
    source(
      'api/modules/quotation-preview.ts',
      "import { getDatabase } from '../infrastructure/db/client.js';\n",
    ),
    source(
      'api/modules/whatsapp-crm-match.ts',
      [
        "import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';",
        "import { getDatabase, type AppDatabase } from '../infrastructure/db/client.js';",
        "import { clients, crmDeals, quoteLeads, quoteRevisions, quotations } from '../infrastructure/db/schema.js';",
      ].join('\n'),
    ),
  ]);

  assert.deepEqual(violations, []);
});

test('rejects a new binding even inside an allowlisted module', () => {
  const violations = findPostgresBoundaryViolations([
    source(
      'api/modules/quotation-preview.ts',
      "import { getDatabase, createDatabaseConnection } from '../infrastructure/db/client.js';\n",
    ),
  ]);

  assert.deepEqual(violations, [
    {
      path: 'api/modules/quotation-preview.ts',
      line: 1,
      target: 'api/infrastructure/db/client.ts',
    },
  ]);
});

test('accepts repository imports from modules', () => {
  const violations = findPostgresBoundaryViolations([
    source(
      'api/modules/products-core.ts',
      "import { createProductsRepository } from '../infrastructure/db/repositories/products-repository.js';\n",
    ),
  ]);

  assert.deepEqual(violations, []);
});
```

The tests must contain no database connection, environment read, generated file or network call.

- [ ] **Step 2: Run the focused test and verify the expected red state**

Run:

```bash
node --test tests/unit/postgres-boundary.test.ts
```

Expected: the command fails because `scripts/check-postgres-boundary.mjs` does not exist or does not export `findPostgresBoundaryViolations`.

The failure must be a missing implementation failure, not a syntax error in the test.

- [ ] **Step 3: Implement the minimum scanner and allowlist**

Create `scripts/check-postgres-boundary.mjs` with these public types represented as JSDoc and this exported function:

```js
/** @typedef {{ path: string, content: string }} BoundarySourceFile */
/** @typedef {{ path: string, line: number, target: string }} BoundaryViolation */
/**
 * @param {readonly BoundarySourceFile[]} files
 * @returns {BoundaryViolation[]}
 */
export function findPostgresBoundaryViolations(files) {}
```

Implement the function with these exact rules:

1. Normalize every input path to forward slashes and repository-relative form.
2. Parse static `import ... from 'specifier'` declarations, side-effect imports, and `import('specifier')` expressions.
3. Record the 1-based line from the import token's position.
4. Treat a package specifier matching `^drizzle-orm(?:/|$)` as target `drizzle-orm`.
5. Treat a package specifier matching `^postgres(?:/|$)` as target `postgres`.
6. Resolve relative imports from the importing file and normalize `api/infrastructure/db/client.js` and `.ts` to target `api/infrastructure/db/client.ts`.
7. Resolve relative imports from the importing file and normalize `api/infrastructure/db/schema.js` and `.ts` to target `api/infrastructure/db/schema.ts`.
8. Ignore all other imports, including repository imports.
9. Parse named, default, namespace and type-only bindings, stripping `type` and aliases before comparing imported names.
10. Allow only these binding sets:

```js
const ALLOWED_IMPORTS = {
  'api/modules/operational-status.ts': {
    'api/infrastructure/db/client.ts': new Set(['getDatabase']),
    'api/infrastructure/db/schema.ts': new Set(['appSettings']),
    'drizzle-orm': new Set(['sql']),
  },
  'api/modules/quotation-preview.ts': {
    'api/infrastructure/db/client.ts': new Set(['getDatabase']),
  },
  'api/modules/whatsapp-crm-match.ts': {
    'drizzle-orm': new Set(['and', 'asc', 'desc', 'eq', 'inArray', 'ne', 'or', 'sql']),
    'api/infrastructure/db/client.ts': new Set(['getDatabase', 'AppDatabase']),
    'api/infrastructure/db/schema.ts': new Set([
      'clients',
      'crmDeals',
      'quoteLeads',
      'quoteRevisions',
      'quotations',
    ]),
  },
};
```

1. For a forbidden target, return one violation for the import declaration when the file or target is not allowlisted, or when any imported binding is not in the corresponding allowed set.
2. Treat a dynamic import as having no allowed binding set, so every direct dynamic import of a forbidden target is a violation.
3. Sort violations by normalized path, then line, then target.
4. Return only `{ path, line, target }` objects.

Use a small regular-expression parser over import declarations rather than adding a parser dependency.

The parser must handle the multiline named imports already used in the repository.

The scanner CLI must discover `.ts` files recursively below `api/modules/`, read UTF-8 text, call the exported function, print only deterministic diagnostics, and set `process.exitCode` to `1` when violations exist.

Use this CLI output format:

```text
api/modules/example.ts:4: direct PostgreSQL/Drizzle import from drizzle-orm
```

Guard CLI execution so importing the module from the unit test does not scan or exit the test process.

- [ ] **Step 4: Run the focused test and verify green**

Run:

```bash
node --test tests/unit/postgres-boundary.test.ts
```

Expected: all scanner tests pass with zero failures.

- [ ] **Step 5: Run the scanner against the repository**

Run:

```bash
node scripts/check-postgres-boundary.mjs
```

Expected: exit code `0` and no output.

- [ ] **Step 6: Run formatting and commit the task**

Run:

```bash
npx prettier --check scripts/check-postgres-boundary.mjs tests/unit/postgres-boundary.test.ts
git diff --check
git add scripts/check-postgres-boundary.mjs tests/unit/postgres-boundary.test.ts
git commit -m "test: guard Postgres Drizzle boundary"
```

Expected: Prettier and `git diff --check` pass, and the commit contains only the scanner and its tests.

## Task 2: Document the active data boundary

**Files:**

- Create: `docs/postgresql-drizzle-boundary.md`

**Interfaces:**

- Consumes: current `api/infrastructure/db` structure and the allowlist from Task 1.
- Produces: active documentation for developers and coding agents.
- Later tasks consume: none at runtime; reviewers use the document to validate the package and CI wiring.

- [ ] **Step 1: Create the document with the approved boundary**

Create `docs/postgresql-drizzle-boundary.md` with this content:

````markdown
# Boundary PostgreSQL + Drizzle

## Regra principal

PostgreSQL é a fonte de verdade do Aspen Dashboard.

Drizzle é a camada de acesso usada pelo backend.

O fluxo oficial é:

```text
handler
  -> module ou service
  -> repository
  -> api/infrastructure/db
  -> Drizzle
  -> PostgreSQL
```

Módulos novos devem consumir repositories e seus tipos públicos.

Módulos novos não devem importar diretamente `drizzle-orm`, `postgres`, o schema ou o client de `api/infrastructure/db`.

## Ownership

`api/infrastructure/db/schema.ts` define o schema Drizzle e os nomes persistidos.

`api/infrastructure/db/client.ts` cria e reutiliza conexões de runtime e mantém o client dedicado ao fluxo de migration.

`api/infrastructure/db/repositories/` concentra consultas e mutações por contrato de domínio.

`api/infrastructure/db/quotation-write-lock.ts` e `api/infrastructure/db/quotation-revision-invariants.ts` conhecem Drizzle para proteger invariants transacionais.

`drizzle.config.ts`, a pasta `drizzle/` e `npm run db:migrate` pertencem ao fluxo controlado de migration.

Migrations não executam no startup, no build ou no CI padrão.

## Exceções atuais

Estas exceções são aceitas somente enquanto não houver repository equivalente revisado:

| Arquivo | Acesso aceito | Motivo |
| --- | --- | --- |
| `api/modules/operational-status.ts` | `getDatabase`, `appSettings`, `sql` | Readiness do banco e configurações obrigatórias. |
| `api/modules/quotation-preview.ts` | `getDatabase` | Resolução da versão de template no preview. |
| `api/modules/whatsapp-crm-match.ts` | Bindings Drizzle, client e tabelas listados no check | Consulta composta de correlação CRM. |

A allowlist ativa e executável está em `scripts/check-postgres-boundary.mjs`.

Um novo binding direto em uma exceção existente também deve falhar.

## Check obrigatório

Execute antes de enviar uma mudança:

```bash
npm run check:db-boundary
```

O check procura imports diretos de Drizzle, `postgres`, schema e client sob `api/modules/`.

Imports de repositories continuam permitidos.

A saída contém somente caminho, linha e motivo.

O check não lê ambiente, abre banco, executa migration ou faz chamadas externas.

## Evolução

Extraia uma exceção para um repository quando uma mudança de domínio tocar aquele fluxo.

A extração deve preservar o comportamento, adicionar testes de comportamento e remover a entrada correspondente da allowlist na mesma mudança.

A política operacional de migrations HIGH está documentada separadamente na Fase 16.

Não altere migrations históricas para resolver uma violação de boundary.
````

Keep each full sentence on its own Markdown line.

- [ ] **Step 2: Validate the document and its safety wording**

Run:

```bash
npx prettier --check docs/postgresql-drizzle-boundary.md
grep -nE 'PostgreSQL|Drizzle|api/infrastructure/db|db:migrate|startup|CI padrão|check:db-boundary|migration' docs/postgresql-drizzle-boundary.md
```

Expected: Prettier passes and the output contains the boundary, ownership, migration separation, exceptions and check command.

- [ ] **Step 3: Check the document diff and commit the task**

Run:

```bash
git diff --check
git add docs/postgresql-drizzle-boundary.md
git commit -m "docs: define Postgres Drizzle boundary"
```

Expected: only the new boundary document is in the commit.

## Task 3: Wire the check into npm and GitHub Actions

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `node scripts/check-postgres-boundary.mjs` and its zero exit status from Task 1.
- Produces: npm script `check:db-boundary`, `verify:fast` coverage, CI job `boundary`, and a build dependency on that job.
- Later tasks consume: no later implementation task; final verification consumes all four CI checks.

- [ ] **Step 1: Confirm the current script and workflow anchors**

Run:

```bash
node -e "const p=require('./package.json'); if (p.scripts['check:db-boundary']) throw new Error('script already exists'); if (p.scripts['verify:fast'] !== 'npm run lint && npm run typecheck && npm run test:unit') throw new Error('unexpected verify:fast');"
rg -n '^  (unit|build):|needs: \[lint, types, unit\]|npm run test:unit' .github/workflows/ci.yml
```

Expected: no existing `check:db-boundary` script, the original `verify:fast` value, and the current `unit` and `build` anchors are printed.

- [ ] **Step 2: Add the npm script and preserve existing checks**

Update `package.json` so the scripts contain:

```json
"check:db-boundary": "node scripts/check-postgres-boundary.mjs",
"verify:fast": "npm run lint && npm run typecheck && npm run check:db-boundary && npm run test:unit",
```

Keep every other script unchanged.

- [ ] **Step 3: Add the parallel boundary job with the existing CI security settings**

Add this job under `jobs` in `.github/workflows/ci.yml`:

```yaml
  boundary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check:db-boundary
```

Change only the build dependency from:

```yaml
    needs: [lint, types, unit]
```

to:

```yaml
    needs: [lint, types, unit, boundary]
```

Do not add secrets, environments, staging variables, migrations, E2E commands, deploy commands or provider calls.

- [ ] **Step 4: Verify the npm check and composed fast verification**

Run:

```bash
npm run check:db-boundary
npm run verify:fast
```

Expected: the scanner exits `0`; `verify:fast` runs lint, typecheck, the scanner and unit tests in that order and exits `0`.

- [ ] **Step 5: Validate workflow structure and forbidden operations**

Run:

```bash
npx prettier --check .github/workflows/ci.yml
grep -nE '^  boundary:|needs: \[lint, types, unit, boundary\]|npm run check:db-boundary|persist-credentials: false|node-version: 22' .github/workflows/ci.yml
if grep -nE 'STAGING|DEPLOY|vercel|db:migrate|playwright|secrets\.' .github/workflows/ci.yml; then exit 1; fi
```

Expected: Prettier passes, the boundary job and build dependency are present, the existing checkout hardening remains present, and the forbidden-operation command prints nothing.

- [ ] **Step 6: Commit the wiring task**

Run:

```bash
git diff --check
git add package.json .github/workflows/ci.yml
git commit -m "ci: enforce Postgres Drizzle boundary"
```

Expected: only `package.json` and `.github/workflows/ci.yml` are in the commit.

## Final verification

After all task reviews pass, run:

```bash
npm run check:db-boundary
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm test
node scripts/check-no-legacy-provider.mjs
npx prettier --check docs/postgresql-drizzle-boundary.md scripts/check-postgres-boundary.mjs tests/unit/postgres-boundary.test.ts .github/workflows/ci.yml
node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.js(?:\.map)?$/.test(entry.name)) fs.rmSync(full);
  }
}
walk('api');
NODE
git diff --check
git status --short --branch
```

Expected: all commands exit `0`, API-generated `.js` and `.js.map` files are absent after cleanup, and only the task commits are present in Git history.

Do not run `npm run db:migrate`, `npm run test:e2e:staging`, `node scripts/cutover-env-status.mjs`, or any deployment command for this phase.
