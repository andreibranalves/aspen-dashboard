# Vercel Single-Function Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurar o deploy Hobby da Vercel expondo somente `api/[...path].ts` como Vercel Function, sem alterar contratos HTTP ou comportamento de runtime.

**Architecture:** Mover atomicamente `api/modules/` para `api/_modules/` e `api/infrastructure/` para `api/_infrastructure/`, preservando o monólito modular, `api/_app/routes.ts` e o pipeline compartilhado.
Todos os consumidores serão reescritos pelo `scripts/rewrite-imports.mjs`, com atualização manual dos caminhos que o script não resolve.
Um guard nativo do Node.js examinará arquivos de função rastreados sob `api/` e falhará quando surgir uma Function pública além do catch-all.

**Tech Stack:** Node.js 22 ESM, TypeScript 5.9, Node Test Runner, npm, GitHub Actions, Vercel, Git.

**Spec:** `docs/superpowers/specs/2026-08-18-vercel-single-function-layout-design.md`

## Global Constraints

- A única entrada implantável deve ser `api/[...path].ts`.
- `api/_modules/`, `api/_infrastructure/`, `api/_app/`, `api/_http/` e `api/_shared/` são caminhos privados para a descoberta file-based da Vercel.
- O guard deve cobrir `.js`, `.cjs`, `.mjs`, `.ts`, `.cts` e `.mts`.
- Arquivos `.d.ts`, arquivos cujo nome começa com `_` e arquivos dentro de diretórios cujo nome começa com `_` não são Functions.
- `api/[...path].ts` continua sendo o único adapter Vercel e `api/_app/routes.ts` continua sendo o único mapa de endpoints.
- Nenhuma rota, método, query string, payload, mensagem HTTP, autenticação, cookie, rate limiting ou adapter muda.
- Imports ESM locais do backend continuam usando a extensão `.js`.
- A estrutura flat de `_modules/` e a estrutura de `_infrastructure/db/repositories/` e `_infrastructure/integrations/` permanecem iguais.
- Não alterar clientes Evolution, Meta CAPI, OpenRouter, Blob ou KV, regras de bloqueio de escritas externas em preview/staging ou alias `@/` do frontend.
- Outputs `.js` e `.js.map` sob `api/` devem ser removidos antes de movimentos e verificações relevantes.
- Não criar re-exports, symlinks ou arquivos de compatibilidade nos caminhos antigos.
- Não alterar migrations históricas, executar migrations, criar variáveis de ambiente ou adicionar dependências.
- Não usar `vercel.json#builds`, `.vercelignore` como seam, plano Pro ou fallback de provedor.
- O check PostgreSQL/Drizzle deve manter as mesmas regras e a mesma allowlist, alterando somente os caminhos físicos.
- `verify:fast` deve executar o guard Vercel sem remover nenhum check existente.
- O job `boundary` existente do CI deve executar o guard sem criar outro job.
- O Preview deve ser validado sem realizar escritas externas.
- Specs e planos históricos em `docs/superpowers/` permanecem intactos, exceto se uma referência for necessária para um guard automatizado.
- Logs e mensagens novos devem listar somente caminhos e estados seguros, nunca segredos, payloads, SQL ou dados pessoais.

## File Map

- Move: `api/modules/**/*.ts` para `api/_modules/**/*.ts`, preservando os 80 nomes flat.
- Move: `api/infrastructure/**/*.ts` para `api/_infrastructure/**/*.ts`, preservando os 24 arquivos e subdiretórios.
- Auto-rewrite: imports, exports, imports dinâmicos e strings de caminhos em `api/`, `tests/`, `scripts/` e `src/` usando `scripts/rewrite-imports.mjs`.
- Modify: `api/_app/routes.ts` somente nos prefixos dos imports dos módulos.
- Modify: `drizzle.config.ts` para apontar para `_infrastructure/db/schema.ts`.
- Modify: `scripts/check-postgres-boundary.mjs` e `tests/unit/postgres-boundary.test.ts` somente nos caminhos de módulos e infraestrutura.
- Create: `scripts/check-vercel-function-layout.mjs`.
- Create: `tests/unit/check-vercel-function-layout.test.ts`.
- Modify: `package.json` e `.github/workflows/ci.yml` para integrar `check:vercel-functions`.
- Modify: `AGENTS.md` e `docs/postgresql-drizzle-boundary.md` como documentação ativa.
- Modify: comentários ativos em `api/_http/types.ts`, `scripts/app-server.mjs` e `scripts/rewrite-imports.mjs`.
- Preserve: `vercel.json`, `.vercelignore`, `api/[...path].ts`, migrations, specs e planos históricos.

## Task 1: Reproduzir o estado quebrado e registrar a baseline

**Files:**

- No repository files changed.
- Temporary output: `/tmp/aspen-route-keys-before.json`.

**Interfaces:**

- Consumes: commit `530664d`, Draft PR `#20` e o estado atual do checkout.
- Produces: contagens baseline, lista de rotas antes da migração e confirmação do erro de limite de Functions.
- Later tasks consume: a contagem de 80 módulos, 24 arquivos de infraestrutura e o snapshot de nomes de rotas.

- [ ] **Step 1: Confirmar checkout limpo e o commit da spec**

Run:

```bash
git status --short --branch
git show --stat --summary 530664d
```

Expected: branch `refactor/architecture-integration`, working tree limpo e `530664d` contendo somente a spec de layout Vercel.

- [ ] **Step 2: Reproduzir ou confirmar a falha do Preview do PR**

Run:

```bash
gh pr view 20 --json number,title,state,isDraft,baseRefName,headRefName,url
gh pr checks 20
```

Expected: PR aberto como draft ou em estado equivalente e o Preview registra `exceeded_serverless_functions_per_deployment` com o limite de 12 Functions do plano Hobby.

Se o check histórico não estiver mais disponível, usar a mensagem registrada na seção 2 da spec como a baseline documentada e não alterar a causa ou o escopo.

- [ ] **Step 3: Confirmar a contagem atual e salvar os nomes de rotas**

Run:

```bash
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', 'api/modules', 'api/infrastructure'], {
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean);
const modules = files.filter((file) => file.startsWith('api/modules/'));
const infrastructure = files.filter((file) => file.startsWith('api/infrastructure/'));
if (modules.length !== 80) throw new Error(`modules baseline: ${modules.length}`);
if (infrastructure.length !== 24) throw new Error(`infrastructure baseline: ${infrastructure.length}`);
if (files.some((file) => !file.endsWith('.ts'))) throw new Error('baseline contains a non-TypeScript API source');

function routeKeys(source) {
  const body = source.match(/export const routes:[\s\S]*?=\s*\{([\s\S]*?)\n\};/)?.[1];
  if (!body) throw new Error('route map not found');
  return body.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(?:'([^']+)'|([a-z][a-z0-9-]*))(?:\s*:\s*[^,]+)?\s*,$/);
    return match ? [match[1] ?? match[2]] : [];
  }).sort();
}

const routeSource = execFileSync('git', ['show', 'HEAD:api/_app/routes.ts'], { encoding: 'utf8' });
writeFileSync('/tmp/aspen-route-keys-before.json', `${JSON.stringify(routeKeys(routeSource), null, 2)}\n`);
console.log(JSON.stringify({ modules: modules.length, infrastructure: infrastructure.length, routes: routeKeys(routeSource).length }));
NODE
```

Expected: `{"modules":80,"infrastructure":24,"routes":44` and `/tmp/aspen-route-keys-before.json` contains the 44 sorted route names.

- [ ] **Step 4: Establish the local functional baseline**

Run:

```bash
find api -type f \( -name '*.js' -o -name '*.js.map' \) -delete
npm run verify:fast
npm run build
find api -type f \( -name '*.js' -o -name '*.js.map' \) -delete
```

Expected: existing fast verification and build pass before the layout change.
The conditional PostgreSQL skips remain allowed when `TEST_DATABASE_URL` is absent.

No commit is created for this task.

## Task 2: Mover atomicamente modules e infrastructure e reancorar consumidores

**Files:**

- Move: every tracked `api/modules/*.ts` file to `api/_modules/*.ts`.
- Move: every tracked `api/infrastructure/**/*.ts` file to the equivalent `api/_infrastructure/**/*.ts` path.
- Modify: `api/_app/routes.ts`, all affected TypeScript, JavaScript and MJS consumers, and `src/lib/api/quotationIssueApi.ts` through the rewrite script.
- Modify: `drizzle.config.ts`.
- Modify: `scripts/check-postgres-boundary.mjs`.
- Modify: `tests/unit/postgres-boundary.test.ts`.
- Modify: active comments in `api/_http/types.ts`, `scripts/app-server.mjs` and `scripts/rewrite-imports.mjs`.

**Interfaces:**

- Consumes: the current 80-module and 24-infrastructure layout plus `scripts/rewrite-imports.mjs`.
- Produces: `api/_modules/` with 80 TypeScript files, `api/_infrastructure/` with 24 TypeScript files, and no old directories.
- Later tasks consume: the final private layout and the unchanged PostgreSQL boundary behavior.

- [ ] **Step 1: Remove emitted API outputs before the rename**

Run:

```bash
find api -type f \( -name '*.js' -o -name '*.js.map' \) -delete
```

Expected: no generated JavaScript remains under `api/` before any path resolution occurs.

- [ ] **Step 2: Generate an explicit 104-entry movement map**

Run:

```bash
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', 'api/modules', 'api/infrastructure'], {
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean);
const modules = files.filter((file) => file.startsWith('api/modules/'));
const infrastructure = files.filter((file) => file.startsWith('api/infrastructure/'));
if (modules.length !== 80) throw new Error(`modules to move: ${modules.length}`);
if (infrastructure.length !== 24) throw new Error(`infrastructure to move: ${infrastructure.length}`);
if (files.some((file) => !file.endsWith('.ts'))) throw new Error('movement map contains a non-TypeScript file');

function destination(file) {
  if (file.startsWith('api/modules/')) return file.replace('api/modules/', 'api/_modules/');
  return file.replace('api/infrastructure/', 'api/_infrastructure/');
}

const mapping = Object.fromEntries(files.map((file) => [file, destination(file)]));
writeFileSync('/tmp/aspen-vercel-layout-map.json', `${JSON.stringify(mapping, null, 2)}\n`);
console.log(`movement map: ${Object.keys(mapping).length} files`);
NODE
node scripts/rewrite-imports.mjs /tmp/aspen-vercel-layout-map.json
```

Expected: `movement map: 104 files`, `renames: 104` and a positive rewrite count.
The existing script must preserve `.js` suffixes, dynamic import query strings and relative paths from moved importers.

- [ ] **Step 3: Remove the empty public directories**

Run:

```bash
rmdir api/modules api/infrastructure
if test -e api/modules || test -e api/infrastructure; then exit 1; fi
```

Expected: only `api/_modules/` and `api/_infrastructure/` remain as implementation roots.

- [ ] **Step 4: Update the Drizzle schema path**

Change `drizzle.config.ts` from:

```ts
schema: './api/infrastructure/db/schema.ts',
```

to:

```ts
schema: './api/_infrastructure/db/schema.ts',
```

Keep the dialect, output directory, credentials behavior, `verbose` and `strict` settings unchanged.

- [ ] **Step 5: Update the PostgreSQL boundary scanner and fixtures for the new roots**

Run:

```bash
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const replacements = [
  ['scripts/check-postgres-boundary.mjs', [
    ['api/modules', 'api/_modules'],
    ['api/infrastructure', 'api/_infrastructure'],
  ]],
  ['tests/unit/postgres-boundary.test.ts', [
    ['api/modules', 'api/_modules'],
    ['api/infrastructure', 'api/_infrastructure'],
    ['../infrastructure', '../_infrastructure'],
  ]],
];

for (const [file, pairs] of replacements) {
  let source = readFileSync(file, 'utf8');
  for (const [from, to] of pairs) source = source.replaceAll(from, to);
  writeFileSync(file, source);
}
NODE
```

Preserve every allowlisted module, binding set, parser rule, violation shape and diagnostic format in `scripts/check-postgres-boundary.mjs`.
Only `MODULE_ROOT`, allowlist paths and canonical database paths change.

- [ ] **Step 6: Update active code comments that describe the moved layout**

Apply these exact replacements:

```text
api/_http/types.ts: api/modules -> api/_modules
scripts/app-server.mjs: api/modules/ -> api/_modules/
scripts/rewrite-imports.mjs: replace the example mapping with { "api/old-dir/x.ts": "api/_new-dir/x.ts", ... }
```

Do not change runtime logic in those files.

- [ ] **Step 7: Prove that active code has no old import or path references**

Run:

```bash
rg -n --hidden \
  --glob '!node_modules/**' \
  --glob '!coverage/**' \
  --glob '!dist/**' \
  'api/(modules|infrastructure)|\.\./infrastructure' \
  api src tests scripts drizzle.config.ts .github package.json
```

Expected: no output.
Do not include `docs/superpowers/**` or `aspen-dashboard-plano-refatoracao.md` in this check because they are historical planning material.

- [ ] **Step 8: Compile and exercise the moved backend**

Run:

```bash
npm run build:api
npm run typecheck
npm run check:db-boundary
TZ=UTC node --test tests/unit/routes.test.ts tests/unit/postgres-boundary.test.ts
npm run test:unit
```

Expected: type checks, boundary scan, route assertions and the complete unit suite pass.
The route test still reports 44 unique handlers.

- [ ] **Step 9: Compare the route names with the baseline and clean outputs**

Run:

```bash
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

function routeKeys(source) {
  const body = source.match(/export const routes:[\s\S]*?=\s*\{([\s\S]*?)\n\};/)?.[1];
  if (!body) throw new Error('route map not found');
  return body.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(?:'([^']+)'|([a-z][a-z0-9-]*))(?:\s*:\s*[^,]+)?\s*,$/);
    return match ? [match[1] ?? match[2]] : [];
  }).sort();
}

const before = JSON.parse(readFileSync('/tmp/aspen-route-keys-before.json', 'utf8'));
const after = routeKeys(readFileSync('api/_app/routes.ts', 'utf8'));
writeFileSync('/tmp/aspen-route-keys-after.json', `${JSON.stringify(after, null, 2)}\n`);
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('route names changed');
console.log(`route names unchanged: ${after.length}`);
NODE
find api -type f \( -name '*.js' -o -name '*.js.map' \) -delete
test "$(find api/_modules -type f -name '*.ts' | wc -l | tr -d ' ')" = 80
test "$(find api/_infrastructure -type f -name '*.ts' | wc -l | tr -d ' ')" = 24
git diff --check
```

Expected: route names unchanged, counts 80 and 24, no generated API output and no whitespace errors.

- [ ] **Step 10: Commit the atomic path migration**

Run:

```bash
git add -A api src tests scripts drizzle.config.ts
git commit -m "refactor(api): hide backend from Vercel function discovery"
```

Expected: Git detects the 104 source moves and path-only consumer rewrites without domain refactors.

## Task 3: Add the Vercel Function layout guard with focused tests

**Files:**

- Create: `scripts/check-vercel-function-layout.mjs`.
- Create: `tests/unit/check-vercel-function-layout.test.ts`.

**Interfaces:**

- Consumes: repository-relative paths from `git ls-files -- api`.
- Produces: `findVercelFunctionViolations(paths)` returning sorted invalid path strings and a CLI with exit code `1` when the list is non-empty.
- Later tasks consume: `npm run check:vercel-functions` and the deterministic path-only diagnostics.

- [ ] **Step 1: Write the focused red tests**

Create `tests/unit/check-vercel-function-layout.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { findVercelFunctionViolations } from '../../scripts/check-vercel-function-layout.mjs';

test('accepts the catch-all and every private API directory', () => {
  assert.deepEqual(
    findVercelFunctionViolations([
      'api/[...path].ts',
      'api/_modules/products.ts',
      'api/_infrastructure/db/schema.ts',
      'api/_infrastructure/db/repositories/products-repository.mts',
      'api/_app/routes.ts',
      'api/_http/types.cts',
      'api/_shared/auth.mjs',
      'api/_private.ts',
      'api/types.d.ts',
      'api/README.md',
    ]),
    [],
  );
});

test('rejects public function files and lists only invalid paths', () => {
  const violations = findVercelFunctionViolations([
    'api/modules/example.ts',
    'api/health.ts',
    'api/infrastructure/db/client.mts',
    'api/legacy.cjs',
    'api/types.d.ts',
    'api/_modules/products.ts',
  ]);

  assert.deepEqual(violations, [
    'api/health.ts',
    'api/infrastructure/db/client.mts',
    'api/legacy.cjs',
    'api/modules/example.ts',
  ]);
  assert.equal(violations.join('\n'), [
    'api/health.ts',
    'api/infrastructure/db/client.mts',
    'api/legacy.cjs',
    'api/modules/example.ts',
  ].join('\n'));
});
```

The tests must not read environment variables, create a database connection, call Vercel or add a dependency.

- [ ] **Step 2: Run the focused test and verify the expected red state**

Run:

```bash
node --test tests/unit/check-vercel-function-layout.test.ts
```

Expected: failure because `scripts/check-vercel-function-layout.mjs` is not implemented yet.

- [ ] **Step 3: Implement the native Node.js guard**

Create `scripts/check-vercel-function-layout.mjs` with this implementation shape:

```js
import { execFileSync } from 'node:child_process';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const FUNCTION_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts']);

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isPrivateApiPath(path) {
  return path.split('/').slice(1).some((segment) => segment.startsWith('_'));
}

export function findVercelFunctionViolations(paths) {
  return [...new Set(paths.map(normalizePath))]
    .filter((path) => path.startsWith('api/'))
    .filter((path) => !path.endsWith('.d.ts'))
    .filter((path) => FUNCTION_EXTENSIONS.has(extname(path)))
    .filter((path) => path !== 'api/[...path].ts')
    .filter((path) => !isPrivateApiPath(path))
    .sort();
}

function runCli() {
  const trackedPaths = execFileSync('git', ['ls-files', '--', 'api'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  }).split(/\r?\n/).filter(Boolean);
  const violations = findVercelFunctionViolations(trackedPaths);
  if (violations.length > 0) process.stderr.write(`${violations.join('\n')}\n`);
  process.exitCode = violations.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
```

The guard must ignore non-function files, `.d.ts` files and every path containing a private segment.
It must accept only the exact TypeScript catch-all path outside the private segments.
Its CLI output must contain only invalid repository-relative paths, one per line.

- [ ] **Step 4: Run the focused test and the real repository guard**

Run:

```bash
node --test tests/unit/check-vercel-function-layout.test.ts
node scripts/check-vercel-function-layout.mjs
```

Expected: the focused tests pass and the real repository guard exits `0` without output.

- [ ] **Step 5: Format, inspect and commit the guard**

Run:

```bash
npx prettier --check scripts/check-vercel-function-layout.mjs tests/unit/check-vercel-function-layout.test.ts
git diff --check
git add scripts/check-vercel-function-layout.mjs tests/unit/check-vercel-function-layout.test.ts
git commit -m "test(vercel): guard single function layout"
```

Expected: only the new guard and focused tests are in this commit.

## Task 4: Integrate the guard into npm verification and the existing CI boundary job

**Files:**

- Modify: `package.json`.
- Modify: `.github/workflows/ci.yml`.

**Interfaces:**

- Consumes: `node scripts/check-vercel-function-layout.mjs` from Task 3.
- Produces: `check:vercel-functions`, fast verification coverage and a second command in the existing `boundary` job.
- Later tasks consume: local and CI enforcement before the build job.

- [ ] **Step 1: Confirm the current anchors before editing**

Run:

```bash
node -e "const p=require('./package.json'); if (p.scripts['check:vercel-functions']) throw new Error('script already exists'); if (!p.scripts['verify:fast'].includes('npm run check:db-boundary')) throw new Error('unexpected verify:fast');"
rg -n '^  boundary:|npm run check:db-boundary|needs: \[lint, types, unit, boundary, migrations\]' .github/workflows/ci.yml
```

Expected: no existing Vercel script, the current database boundary check is in `verify:fast`, and the existing `boundary` job is already a build dependency.

- [ ] **Step 2: Add the npm command without removing existing checks**

Update `package.json` to contain:

```json
"check:vercel-functions": "node scripts/check-vercel-function-layout.mjs",
"verify:fast": "npm run lint && npm run typecheck && npm run check:db-boundary && npm run check:db-migrations && npm run check:vercel-functions && npm run test:unit",
```

Keep every other script and dependency unchanged.

- [ ] **Step 3: Add the guard to the existing boundary job**

In `.github/workflows/ci.yml`, keep the existing `boundary` job and add this step immediately after the database boundary step:

```yaml
      - run: npm run check:db-boundary
      - run: npm run check:vercel-functions
```

Keep the existing `needs: [lint, types, unit, boundary, migrations]` line unchanged.
Do not add a job, secret, environment, deployment, migration, E2E command or external provider call.

- [ ] **Step 4: Verify local wiring and the complete fast lane**

Run:

```bash
npm run check:vercel-functions
npm run verify:fast
```

Expected: the standalone guard and the composed fast lane exit `0`.
The fast lane runs lint, typecheck, both boundary checks, migrations check and unit tests.

- [ ] **Step 5: Validate workflow safety and commit**

Run:

```bash
npx prettier --check package.json .github/workflows/ci.yml
if grep -nE 'STAGING|DEPLOY|db:migrate|playwright|secrets\.|(^|[[:space:]])vercel([[:space:]]|$)' .github/workflows/ci.yml; then exit 1; fi
git diff --check
git add package.json .github/workflows/ci.yml
git commit -m "ci: enforce Vercel function layout"
```

Expected: formatting passes, the forbidden-operation check prints nothing and no new CI job exists.

## Task 5: Align active documentation and perform the residual reference audit

**Files:**

- Modify: `AGENTS.md`.
- Modify: `docs/postgresql-drizzle-boundary.md`.

**Interfaces:**

- Consumes: the private API layout and guard commands from Tasks 2 to 4.
- Produces: active documentation that points agents to `_modules`, `_infrastructure` and the single Function rule.
- Later tasks consume: the documented deployment contract and the residual-reference audit.

- [ ] **Step 1: Update the root agent guidance**

Change the architecture entries in `AGENTS.md` to:

```markdown
- A única Function implantável é `api/[...path].ts`; helpers ficam sob diretórios privados iniciados por `_`.
- Handlers e regras de negócio ficam em `api/_modules/`.
- Repositórios PostgreSQL ficam em `api/_infrastructure/db/repositories/` e controlam estado durável e transações.
- Integrações externas ficam em `api/_infrastructure/integrations/`.
```

Keep every existing security, migration, environment and frontend rule unchanged.

- [ ] **Step 2: Update the active PostgreSQL boundary document**

Replace every active `api/modules` path with `api/_modules` and every active `api/infrastructure` path with `api/_infrastructure` in `docs/postgresql-drizzle-boundary.md`.

The document must retain the same exception files and bindings with their new paths, and its flow must read:

```text
handler
  -> module ou service
  -> repository
  -> api/_infrastructure/db
  -> Drizzle
  -> PostgreSQL
```

Add this section before `## Evolução`:

```markdown
## Layout da Vercel

`api/[...path].ts` é a única entrada de Function implantável.

`api/_modules/`, `api/_infrastructure/`, `api/_app/`, `api/_http/` e `api/_shared/` são diretórios privados para a descoberta file-based da Vercel.

Valide o layout com `npm run check:vercel-functions`.

Não mova helpers para um caminho público sob `api/` e não use `.vercelignore` para remover uma dependência importada pelo catch-all.
```

Extend the mandatory check block to contain:

```bash
npm run check:db-boundary
npm run check:db-migrations
npm run check:vercel-functions
```

- [ ] **Step 3: Audit active references and preserve historical documents**

Run:

```bash
find api -type f \( -name '*.js' -o -name '*.js.map' \) -delete
rg -n --hidden \
  --glob '!node_modules/**' \
  --glob '!coverage/**' \
  --glob '!dist/**' \
  --glob '!tests/unit/check-vercel-function-layout.test.ts' \
  'api/(modules|infrastructure)|\.\./infrastructure' \
  AGENTS.md docs/postgresql-drizzle-boundary.md api src tests scripts drizzle.config.ts .github package.json
```

Expected: no output.
The excluded `tests/unit/check-vercel-function-layout.test.ts` contains intentional negative-fixture literals checked by the focused guard tests.
Do not rewrite `docs/superpowers/specs/**`, `docs/superpowers/plans/**` or `aspen-dashboard-plano-refatoracao.md` as part of this migration.

- [ ] **Step 4: Format, review and commit documentation**

Run:

```bash
npx prettier --check AGENTS.md docs/postgresql-drizzle-boundary.md
git diff --check
git add AGENTS.md docs/postgresql-drizzle-boundary.md
git commit -m "docs: document private Vercel API layout"
```

Expected: active docs contain no old implementation roots and historical planning files remain untouched.

## Task 6: Execute full verification and validate the real Vercel Preview

**Files:**

- No new repository files.
- The task validates the commits from Tasks 2 to 5 and the existing Draft PR #20.

**Interfaces:**

- Consumes: all code, tests, package scripts, CI wiring and active documentation from previous tasks.
- Produces: local verification evidence, successful CI jobs, a READY Preview with one Function and a read-only smoke result.
- Completion condition: every acceptance criterion in the spec is checked or explicitly blocked by the real Preview state.

- [ ] **Step 1: Run the required local verification from a clean emitted tree**

Run:

```bash
find api -type f \( -name '*.js' -o -name '*.js.map' \) -delete
npm run check:vercel-functions
npm run verify:full
find api -type f \( -name '*.js' -o -name '*.js.map' \) -delete
npm run build
find api -type f \( -name '*.js' -o -name '*.js.map' \) -delete
```

Expected: every command exits `0`, including lint, typecheck, both boundary checks, migrations check, unit tests, Vite build and existing E2E tests.
The conditional PostgreSQL tests may remain skipped when `TEST_DATABASE_URL` is not configured.

- [ ] **Step 2: Audit final counts, old directories and route identity**

Run:

```bash
test ! -e api/modules
test ! -e api/infrastructure
test "$(find api/_modules -type f -name '*.ts' | wc -l | tr -d ' ')" = 80
test "$(find api/_infrastructure -type f -name '*.ts' | wc -l | tr -d ' ')" = 24
node scripts/check-vercel-function-layout.mjs

diff -u /tmp/aspen-route-keys-before.json /tmp/aspen-route-keys-after.json
git diff --check
git status --short --branch
```

Expected: old directories are absent, counts are 80 and 24, the guard prints nothing, route names are identical, no whitespace errors exist and only intended commits or a clean tree remain.

- [ ] **Step 3: Confirm all required CI jobs on Draft PR #20**

Run:

```bash
gh pr checks 20 --watch
```

Expected: `lint`, `types`, `unit`, `boundary`, `migrations` and `build` all succeed.
The `boundary` job must show both `check:db-boundary` and `check:vercel-functions` passing.

- [ ] **Step 4: Validate the Vercel Preview without external writes**

Use the Preview URL attached to PR #20 and verify in the Vercel deployment details:

1. Deployment state is `READY`.
2. The Functions list contains only the Function generated from `api/[...path].ts`.
3. No Function is generated for `_modules`, `_infrastructure`, `_app`, `_http` or `_shared`.
4. The Preview build does not report `exceeded_serverless_functions_per_deployment`.

Run a read-only smoke request:

```bash
curl -sS -i "$PREVIEW_URL/api/operational-status" | head -40
```

Expected: an HTTP response from the shared catch-all, with either the documented protected response or a successful readiness response, and no mutation or external write.

- [ ] **Step 5: Apply the spec rollback rule if Preview still fails**

If the Preview still exceeds the Function limit, stop implementation and inspect the actual generated Function list.
Do not add `builds`, `.vercelignore`, a paid plan or another transport as an automatic fallback.

If an import or guardrail fails, revert the atomic layout commit while keeping production unchanged.

## Final Acceptance Checklist

- [ ] `api/modules/` does not exist.
- [ ] `api/infrastructure/` does not exist.
- [ ] `api/_modules/` contains the 80 existing modules with unchanged flat names.
- [ ] `api/_infrastructure/` contains the 24 existing infrastructure files with unchanged subdirectories.
- [ ] `api/[...path].ts` is the only Function accepted by `check-vercel-function-layout.mjs`.
- [ ] No active code imports or reads `api/modules/` or `api/infrastructure/`.
- [ ] PostgreSQL boundary rules and allowlisted bindings are unchanged except for physical path prefixes.
- [ ] `drizzle.config.ts` points to `api/_infrastructure/db/schema.ts`.
- [ ] `npm run check:vercel-functions` passes.
- [ ] `npm run verify:full` passes.
- [ ] CI jobs `lint`, `types`, `unit`, `boundary`, `migrations` and `build` pass.
- [ ] Vercel Preview is `READY` with one Function.
- [ ] Preview smoke validation performs no external write.
- [ ] No migration, environment, provider, dependency or historical-spec changes were introduced.
