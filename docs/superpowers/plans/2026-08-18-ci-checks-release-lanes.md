# CI, checks e release lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar as Fases 11-14 com CI de PR, comandos de verificação compostos, tags Playwright por domínio e lanes de release proporcionais ao risco.

**Architecture:** Manter os scripts existentes como interfaces compatíveis e adicionar aliases e comandos compostos pequenos.
Separar a compilação da API da geração web permite que `verify:full` use o build da API já feito por `test:unit` sem duplicá-lo.
Usar apenas recursos nativos do npm, GitHub Actions, Playwright e documentação Markdown ativa.

**Tech Stack:** Node.js 22, npm, TypeScript, Node Test Runner, Vite 6, Playwright 1.59, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-18-ci-checks-release-lanes-design.md`

## Global Constraints

- Usar Node.js 22 e `npm ci` a partir do `package-lock.json`.
- Não adicionar dependências npm.
- Preservar `type-check`, `test:unit`, `test:e2e`, `build:api` e `build` funcionando.
- Não alterar fixtures, rotas, assertions, ordem ou comportamento dos testes Playwright.
- As tags válidas são `@smoke`, `@quotations`, `@crm`, `@products`, `@whatsapp`, `@database`, `@external` e `@critical`.
- O CI padrão executa lint, tipos, unitários e build, sem E2E de staging, deploy ou escrita externa.
- Migrations continuam sendo executadas somente por `npm run db:migrate` em etapa controlada.
- Não alterar `public/`, `drizzle/` ou migrations históricas.
- Remover `api/**/*.js` e `api/**/*.js.map` emitidos por builds antes da conclusão.
- Preservar mensagens, defaults, credenciais e dados operacionais existentes.

---

## File Map

- `package.json`: aliases, composição de build, smoke E2E e comandos `verify:fast`/`verify:full`.
- `.github/workflows/ci.yml`: workflow de PR com jobs paralelos e build dependente.
- `tests/*.spec.js`: tags Playwright nos grupos ou títulos existentes.
- `docs/release-lanes.md`: processo operacional ativo para LOW, MEDIUM e HIGH.

## Task 1: Compor scripts de verificação e build

**Files:**

- Modify: `package.json`

**Interfaces:**

- Consumes: scripts existentes `type-check`, `build:api`, `test:unit`, `test:e2e` e o cleanup atual do frontend.
- Produces: `typecheck`, `clean:web`, `build:web`, `test:unit:run`, `test:e2e:smoke`, `verify:fast` e `verify:full`.
- Later tasks consume: CI chama `typecheck`, `test:unit` e `build`; Playwright usa `test:e2e:smoke` depois que Task 3 adiciona `@smoke`.

- [ ] **Step 1: Confirmar o estado vermelho dos novos comandos**

Run:

```bash
npm run typecheck
npm run build:web
npm run verify:fast
npm run verify:full
```

Expected: cada comando termina com erro de script inexistente, sem alterar arquivos rastreados.

Este é um caso de configuração de package scripts.
A aprovação da spec autoriza a verificação red/green por comandos, sem criar um teste artificial para strings do `package.json`.

- [ ] **Step 2: Atualizar o bloco de scripts com a composição mínima**

Remover o lifecycle `prebuild` e substituir os scripts relacionados por este conteúdo exato:

```json
"build:api": "tsc -p api/tsconfig.api.json",
"clean:web": "rm -f public/assets/index-*.js public/assets/index-*.css public/assets/index-*.js.map public/assets/index-*.css.map",
"build:web": "npm run clean:web && vite build",
"build": "npm run build:api && npm run build:web",
```

Manter `type-check` e adicionar o alias:

```json
"type-check": "tsc -p api/tsconfig.api.json --noEmit",
"typecheck": "npm run type-check",
```

Separar a execução unitária da compilação:

```json
"test:unit:run": "TZ=UTC node --test tests/unit/*.test.{js,ts}",
"test:unit": "npm run build:api && npm run test:unit:run",
```

Adicionar os comandos compostos:

```json
"test:e2e:smoke": "npx playwright test --grep \"@smoke\"",
"verify:fast": "npm run lint && npm run typecheck && npm run test:unit",
"verify:full": "npm run verify:fast && npm run build:web && npm run test:e2e",
```

Preservar os demais scripts sem mudanças.

- [ ] **Step 3: Verificar os comandos pequenos em verde**

Run:

```bash
npm run type-check
npm run typecheck
npm run build:api
npm run build:web
```

Expected: todos passam.

- [ ] **Step 4: Verificar `verify:fast` sem recompilação duplicada**

Run:

```bash
npm run verify:fast
```

Expected: lint, typecheck e unitários passam.

Expected: a saída contém uma compilação da API feita pelo `test:unit` e não executa `vite build`.

- [ ] **Step 5: Verificar `verify:full` e o build completo**

Run:

```bash
npm run verify:full
npm run build
```

Expected: `verify:full` passa com lint, typecheck, unitários, build web e Playwright.

Expected: `build` passa com compilação da API e Vite.

- [ ] **Step 6: Limpar outputs emitidos e confirmar compatibilidade**

Run:

```bash
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
npm run check
git diff --check
git status --short
```

Expected: `check` passa, `git diff --check` não imprime problemas e somente `package.json` aparece como alteração rastreada.

- [ ] **Step 7: Commitar a tarefa**

```bash
git add package.json
git commit -m "build: add fast and full checks"
```

## Task 2: Criar GitHub Actions CI de pull request

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `npm run lint`, `npm run typecheck`, `npm run test:unit` e `npm run build` produzidos pelo `package.json`.
- Produces: workflow `CI` com jobs `lint`, `types`, `unit` e `build`.
- Later tasks consume: nenhum runtime; branch protection pode consumir o status `build` quando configurada externamente.

- [ ] **Step 1: Confirmar que o workflow ainda não existe**

Run:

```bash
test ! -e .github/workflows/ci.yml
```

Expected: exit code `0`.

- [ ] **Step 2: Criar o workflow mínimo e paralelo**

Criar `.github/workflows/ci.yml` com este conteúdo:

```yaml
name: CI

on:
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint

  types:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck

  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run test:unit

  build:
    needs: [lint, types, unit]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
```

- [ ] **Step 3: Validar sintaxe e contratos do workflow localmente**

Run:

```bash
npx prettier --check .github/workflows/ci.yml
node - <<'NODE'
const fs = require('node:fs');
const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
for (const value of ['name: CI', 'pull_request:', 'jobs:', 'lint:', 'types:', 'unit:', 'build:', 'needs: [lint, types, unit]', 'npm ci', 'npm run lint', 'npm run typecheck', 'npm run test:unit', 'npm run build']) {
  if (!workflow.includes(value)) throw new Error(`missing workflow contract: ${value}`);
}
NODE
git diff --check
```

Expected: Prettier passa e o script não lança erro.

- [ ] **Step 4: Confirmar que o CI não introduz operações externas**

Run:

```bash
grep -nE 'STAGING|DEPLOY|vercel|db:migrate|whatsapp|secrets\.' .github/workflows/ci.yml || true
```

Expected: nenhuma linha é impressa.

- [ ] **Step 5: Commitar a tarefa**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add pull request checks"
```

## Task 3: Classificar Playwright por domínio

**Files:**

- Modify: `tests/client-core.spec.js`
- Modify: `tests/crm-prune.spec.js`
- Modify: `tests/dashboard.spec.js`
- Modify: `tests/orcamento-core.spec.js`
- Modify: `tests/orcamento.spec.js`
- Modify: `tests/postgres-only-cutover.spec.js`
- Modify: `tests/products-core.spec.js`
- Modify: `tests/quotation-cutover-staging.spec.js`
- Modify: `tests/quotation-cutover.spec.js`
- Modify: `tests/quotation-issue.spec.js`
- Modify: `tests/quotation-lifecycle.spec.js`
- Modify: `tests/quotation-templates-core.spec.js`
- Modify: `tests/quotations-core.spec.js`
- Modify: `tests/settings.spec.js`
- Modify: `tests/task-8-fix-r1.spec.js`
- Modify: `tests/task-8-fix-r3.spec.js`
- Modify: `tests/task-8-fix-r4.spec.js`
- Modify: `tests/whatsapp-inbox.spec.js`

**Interfaces:**

- Consumes: Playwright title matching and `test:e2e:smoke` from Task 1.
- Produces: at least one selected test for every valid tag and stable domain grep commands.
- Later tasks consume: release lane documentation references the tags without depending on test internals.

- [ ] **Step 1: Confirmar que não há testes smoke selecionáveis antes das tags**

Run:

```bash
npx playwright test --grep "@smoke" --list
```

Expected: nenhum teste é listado because the current specs have no `@smoke` title tag.

- [ ] **Step 2: Adicionar tags sem envolver ou reordenar testes**

Aplicar somente as substituições de título abaixo.

Não alterar o corpo das funções, fixtures, rotas, assertions ou ordem dos testes.

```text
tests/client-core.spec.js
  Clientes locais -> Clientes locais @crm @smoke

tests/crm-prune.spec.js
  reviews and marks stale Kanban deals as Perdido -> reviews and marks stale Kanban deals as Perdido @crm

tests/dashboard.spec.js
  Cada título existente -> mesmo título + " @smoke"

tests/orcamento-core.spec.js
  Orçamento manual — rascunho core -> Orçamento manual — rascunho core @quotations @smoke

tests/orcamento.spec.js
  Auto Quote — Fluxo Principal -> Auto Quote — Fluxo Principal @quotations @smoke
  Leads — Página single e visualização rápida -> Leads — Página single e visualização rápida @crm
  Orçamento manual — clientes unificados -> Orçamento manual — clientes unificados @quotations

tests/postgres-only-cutover.spec.js
  PostgreSQL-only cutover staging smoke -> PostgreSQL-only cutover staging smoke @database @critical

tests/products-core.spec.js
  Produtos — catálogo principal -> Produtos — catálogo principal @products @smoke

tests/quotation-cutover-staging.spec.js
  quotation cutover staging -> quotation cutover staging @quotations @database @critical

tests/quotation-cutover.spec.js
  cotação PostgreSQL mantém revisão, PDF, link público e erro sanitizado -> mesmo título + " @quotations @database @critical"

tests/quotation-issue.spec.js
  Cada título existente -> mesmo título + " @quotations @critical"

tests/quotation-lifecycle.spec.js
  Cada título de teste existente -> mesmo título + " @quotations @critical"

tests/quotation-templates-core.spec.js
  Cada título de teste existente -> mesmo título + " @quotations"

tests/quotations-core.spec.js
  Cada título de teste existente -> mesmo título + " @quotations @smoke"

tests/settings.spec.js
  Configurações de orçamento -> Configurações de orçamento @quotations

tests/task-8-fix-r1.spec.js
  Cada título de teste existente -> mesmo título + " @quotations @critical"

tests/task-8-fix-r3.spec.js
  Cada título de teste existente -> mesmo título + " @smoke"

tests/task-8-fix-r4.spec.js
  Cada título de teste existente -> mesmo título + " @quotations @critical"

tests/whatsapp-inbox.spec.js
  WhatsApp Inbox Page -> WhatsApp Inbox Page @whatsapp @external @critical
```

Nos arquivos sem `test.describe`, adicionar a tag ao literal de cada chamada `test(...)` existente.

Nos arquivos com `test.describe`, adicionar a tag no título do grupo existente.

- [ ] **Step 3: Verificar seleção de cada domínio sem executar navegadores**

Run:

```bash
npx playwright test --grep "@smoke" --list
npx playwright test --grep "@quotations|@smoke" --list
npx playwright test --grep "@products|@smoke" --list
npx playwright test --grep "@crm" --list
npx playwright test --grep "@whatsapp" --list
npx playwright test --grep "@database" --list
npx playwright test --grep "@external" --list
npx playwright test --grep "@critical" --list
```

Expected: cada comando lista pelo menos um teste.

- [ ] **Step 4: Verificar a execução smoke**

Run:

```bash
npm run test:e2e:smoke
```

Expected: somente testes com `@smoke` executam e passam.

- [ ] **Step 5: Verificar que os testes de staging continuam fora do padrão local**

Run:

```bash
npx playwright test --list
```

Expected: `postgres-only-cutover.spec.js` e `quotation-cutover-staging.spec.js` não aparecem na lista local padrão, preservando `testIgnore` da configuração.

- [ ] **Step 6: Commitar a tarefa**

```bash
git add tests/*.spec.js
git commit -m "test: tag Playwright suites by domain"
```

## Task 4: Documentar release lanes LOW, MEDIUM e HIGH

**Files:**

- Create: `docs/release-lanes.md`

**Interfaces:**

- Consumes: comandos `verify:fast`, `verify:full`, `test:e2e:smoke`, `test:e2e`, `test:e2e:staging` e `db:migrate`.
- Produces: regras operacionais ativas para escolher uma lane antes do merge.
- Later tasks consume: developers and coding agents use the document to choose required checks; no automation reads the document.

- [ ] **Step 1: Confirmar que a documentação ativa ainda não existe**

Run:

```bash
test ! -e docs/release-lanes.md
```

Expected: exit code `0`.

- [ ] **Step 2: Criar a documentação com os três fluxos**

Criar `docs/release-lanes.md` com este conteúdo:

````markdown
# Release lanes

Escolha a lane pelo maior risco presente na mudança.

Quando houver dúvida entre duas lanes, use a mais alta.

## LOW

Use para CSS, copy, ícones, formatação e componentes puramente visuais.

```text
CI
-> Preview
-> merge
-> Production
```

Checks locais recomendados:

```bash
npm run verify:fast
npm run test:e2e:smoke
```

LOW não pode alterar banco, autenticação, permissões, integrações externas ou envio WhatsApp.

## MEDIUM

Use para novos endpoints, regras de negócio, filtros, CRM e alterações comuns em orçamentos.

```text
CI
-> unit
-> E2E do domínio
-> Preview
-> Production
```

Checks mínimos:

```bash
npm run verify:fast
npx playwright test --grep "@crm|@quotations|@products|@smoke"
```

Escolha a tag do domínio afetado.

Não use esta lane quando houver escrita externa, migration, autenticação, permissão ou mudança destrutiva.

## HIGH

Use para migrations, autenticação, envio WhatsApp, integrações externas, permissões e mudanças destrutivas.

```text
CI
-> todos unit
-> build
-> staging DB
-> full E2E
-> backup
-> Preview
-> aprovação explícita
-> Production
-> read-only canary
```

Checks locais e controlados:

```bash
npm run verify:full
npm run test:e2e:staging
npm run db:migrate
```

`test:e2e:staging` e `db:migrate` são opt-in.

Execute-os somente com o ambiente operacional aprovado e sem imprimir credenciais, dados de produção ou PII.

Migrations não executam no startup, no CI padrão ou implicitamente durante o build.

Mudanças destrutivas seguem expand, deploy compatível, migração de dados e contract.

## Regras comuns

- CI padrão executa lint, tipos, unitários e build.
- E2E de staging não executa no CI padrão.
- Writes externos, WhatsApp, auth, migrations e mudanças destrutivas nunca são LOW.
- Preview não substitui aprovação da lane HIGH.
- O documento orienta o processo, mas não automatiza deploy, backup, aprovação, migration ou canary.

````

- [ ] **Step 3: Validar Markdown e comandos documentados**

Run:

```bash
npx prettier --check docs/release-lanes.md
npm run verify:fast
npm run test:e2e:smoke -- --list
```

Expected: Prettier passa, verify fast passa e a listagem smoke contém testes.

- [ ] **Step 4: Confirmar limites de segurança no documento**

Run:

```bash
grep -nE 'npm run db:migrate|test:e2e:staging|não executam no startup|não automatiza deploy|credenciais|PII' docs/release-lanes.md
```

Expected: as regras HIGH e de operação controlada aparecem.

- [ ] **Step 5: Commitar a tarefa**

```bash
git add docs/release-lanes.md
git commit -m "docs: define release risk lanes"
```

## Final verification

After all tasks and task reviews pass, run this branch-level sequence:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm test
node scripts/check-no-legacy-provider.mjs
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

Expected: all commands pass, generated API outputs are absent, and the only remaining changes are the four task commits already recorded in git.
