# Fase 18 — Redução de Feature Flags e Variáveis de Ambiente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover `STAGING_E2E` e `STAGING_EXTERNAL_PROVIDERS_DISABLED` da configuração ativa, usando `APP_ENV=preview` e `EXTERNAL_WRITES_ENABLED=0` sem enfraquecer os guardrails independentes de egress e fixtures.

**Architecture:** O helper staging continuará sendo a fronteira fail-closed das precondições E2E, mas passará a consumir o contrato canônico de ambiente e writes externos. O Playwright derivará o modo remoto de `APP_ENV=preview`; o manifesto operacional e a documentação removerão somente as duas flags redundantes. `STAGING_EGRESS_BLOCKED` e `STAGING_FIXTURE_RESET` permanecem obrigatórias e documentadas porque representam controles distintos.

**Tech Stack:** Node.js 22 ESM, npm, JavaScript, Node Test Runner, Playwright, Markdown, Git.

**Spec:** `docs/superpowers/specs/2026-08-18-feature-flags-env-design.md`

## Global Constraints

- `APP_ENV=preview` deve ser a única seleção de modo staging no Playwright.
- `EXTERNAL_WRITES_ENABLED=0` deve ser obrigatório para a suíte staging.
- Remover `STAGING_E2E` e `STAGING_EXTERNAL_PROVIDERS_DISABLED` sem aliases, fallback ou período de compatibilidade.
- Preservar `STAGING_EGRESS_BLOCKED=1` como atestação independente do bloqueio de egress.
- Preservar `STAGING_FIXTURE_RESET=1` como autorização independente para limpar fixtures descartáveis.
- Preservar `STAGING_BASE_URL`, `STAGING_DATABASE_URL`, `STAGING_PG_SERVICE`, `STAGING_E2E_USERNAME`, credenciais E2E e IDs de fixtures.
- Valores ausentes ou diferentes dos literais esperados devem bloquear a suíte staging antes de requests.
- Não imprimir tokens, credenciais, URLs completas, payloads ou dados pessoais em erros, testes, documentos ou logs.
- Não criar dependência, registry genérico, schema de configuração ou flag substituta.
- Não alterar o guard de writes externos em `api/_shared/external-writes.ts`.
- Não executar deploy, push, migration, staging remoto, mudança de secrets, Vercel ou infraestrutura de rede.
- Não editar migrations históricas sob `drizzle/` nem arquivos gerados pelo Vite em `public/`.
- Mensagens HTTP destinadas ao usuário permanecem em português brasileiro; mensagens internas dos testes podem manter o idioma atual.

---

## File Map

- `tests/unit/staging-auth.test.js`: nova matriz unitária do contrato staging e da restrição de origem.
- `tests/support/staging-auth.js`: troca as duas flags aposentadas pelo contrato `APP_ENV`/`EXTERNAL_WRITES_ENABLED`.
- `tests/unit/playwright-config.test.js`: nova prova comportamental da seleção local versus Preview.
- `playwright.config.js`: deriva modo staging de `APP_ENV=preview`.
- `package.json`: injeta o contrato seguro no comando `test:e2e:staging`.
- `tests/unit/cutover-env-status.test.js`: fixa o manifesto canônico e a ausência das flags aposentadas.
- `scripts/cutover-env-status.mjs`: remove flags aposentadas e inclui os nomes canônicos no preflight redigido.
- `.env.example`: remove somente as duas declarações aposentadas; mantém defaults seguros canônicos.
- `docs/operational-cutoff-procedure.md`: atualiza checklist/comando e registra lifecycle das flags restantes.
- `docs/baseline-refatoracao.md`: atualiza o inventário declarativo de ambiente sem reescrever histórico fora da tabela vigente.

---

## Task 1: Migrar a fronteira de precondições staging com TDD

**Files:**

- Create: `tests/unit/staging-auth.test.js`
- Modify: `tests/support/staging-auth.js`

**Interfaces:**

- Consumes: `NodeJS.ProcessEnv`-like object com strings de configuração.
- Produces: `getStagingConfig(env)` e `assertStagingConfig(env)` aceitam somente Preview com writes externos desativados e guardrails staging válidos.
- Preserves: retorno `{ baseUrl, username, password, postgresQuotationId, scratchQuotationId }`, `assertSafeApiPath`, `apiRequest`, `assertNoForbiddenEgress` e `loginToStaging`.

- [ ] **Step 1: Criar a matriz unitária vermelha**

Criar `tests/unit/staging-auth.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeApiPath, getStagingConfig } from '../support/staging-auth.js';

function validEnv(overrides = {}) {
  return {
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    STAGING_BASE_URL: 'https://preview.example.test',
    BASE_URL: 'https://preview.example.test',
    E2E_USERNAME: 'preview-operator',
    E2E_PASSWORD: 'test-password',
    STAGING_E2E_USERNAME: 'preview-operator',
    KNOWN_POSTGRES_QUOTATION_ID: 'ORC-20260001',
    KNOWN_POSTGRES_SCRATCH_QUOTATION_ID: 'ORC-20269999',
    STAGING_EGRESS_BLOCKED: '1',
    STAGING_FIXTURE_RESET: '1',
    ...overrides,
  };
}

function without(env, key) {
  const copy = { ...env };
  delete copy[key];
  return copy;
}

test('aceita Preview com writes desativados e guardrails staging', () => {
  assert.deepEqual(getStagingConfig(validEnv()), {
    baseUrl: 'https://preview.example.test',
    username: 'preview-operator',
    password: 'test-password',
    postgresQuotationId: 'ORC-20260001',
    scratchQuotationId: 'ORC-20269999',
  });
});

test('rejeita ambiente diferente de Preview', () => {
  for (const env of [
    without(validEnv(), 'APP_ENV'),
    validEnv({ APP_ENV: 'development' }),
    validEnv({ APP_ENV: 'production' }),
  ]) {
    assert.throws(() => getStagingConfig(env), /APP_ENV=preview is required/);
  }
});

test('rejeita writes externos ausentes ou habilitados', () => {
  for (const env of [
    without(validEnv(), 'EXTERNAL_WRITES_ENABLED'),
    validEnv({ EXTERNAL_WRITES_ENABLED: '1' }),
  ]) {
    assert.throws(() => getStagingConfig(env), /EXTERNAL_WRITES_ENABLED=0 is required/);
  }
});

test('mantém egress e reset como atestações independentes', () => {
  assert.throws(
    () => getStagingConfig(without(validEnv(), 'STAGING_EGRESS_BLOCKED')),
    /STAGING_EGRESS_BLOCKED=1 is required/
  );
  assert.throws(
    () => getStagingConfig(validEnv({ STAGING_FIXTURE_RESET: '0' })),
    /STAGING_FIXTURE_RESET=1 is required for disposable fixture cleanup/
  );
});

test('restringe requests à origem Preview', () => {
  const previous = {
    APP_ENV: process.env.APP_ENV,
    STAGING_BASE_URL: process.env.STAGING_BASE_URL,
    BASE_URL: process.env.BASE_URL,
  };
  Object.assign(process.env, {
    APP_ENV: 'preview',
    STAGING_BASE_URL: 'https://preview.example.test',
    BASE_URL: 'https://preview.example.test',
  });
  try {
    assert.equal(assertSafeApiPath('/api/products'), 'https://preview.example.test/api/products');
    assert.throws(
      () => assertSafeApiPath('https://outside.example.test/api/products'),
      /outside the staging origin/
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
```

A quebra protegida por estes testes é: voltar a aceitar execução staging por uma flag aposentada, habilitar writes externos em Preview ou inferir egress/reset sem atestação.

- [ ] **Step 2: Executar a matriz e confirmar RED**

Run:

```bash
node --test tests/unit/staging-auth.test.js
```

Expected: os testes do novo contrato falham porque `getStagingConfig` ainda exige `STAGING_E2E`/`STAGING_EXTERNAL_PROVIDERS_DISABLED`, e a restrição de origem ainda usa `STAGING_E2E`.

- [ ] **Step 3: Implementar a troca mínima no helper**

Em `tests/support/staging-auth.js`:

1. Remover `STAGING_EXTERNAL_PROVIDERS_DISABLED` de `REQUIRED_STAGING_VARS`.
2. Não adicionar `APP_ENV` ou `EXTERNAL_WRITES_ENABLED` à lista genérica; validar os literais com mensagens específicas.
3. Substituir o início de `getStagingConfig` por:

```js
export function getStagingConfig(env = process.env) {
  const missing = REQUIRED_STAGING_VARS.filter((name) => !String(env[name] || '').trim());
  if (missing.length) {
    throw new Error(`Staging E2E precondition missing: ${missing.join(', ')}`);
  }
  if (String(env.APP_ENV || '').trim().toLowerCase() !== 'preview') {
    throw new Error('APP_ENV=preview is required');
  }
  if (String(env.EXTERNAL_WRITES_ENABLED || '').trim() !== '0') {
    throw new Error('EXTERNAL_WRITES_ENABLED=0 is required');
  }
```

4. Preservar validação de `STAGING_E2E_USERNAME`, `STAGING_EGRESS_BLOCKED` e `STAGING_FIXTURE_RESET`.
5. Remover o branch de `STAGING_EXTERNAL_PROVIDERS_DISABLED`.
6. Substituir o início de `effectiveStagingOrigin` por:

```js
function effectiveStagingOrigin(env = process.env) {
  if (String(env.APP_ENV || '').trim().toLowerCase() !== 'preview') return null;
```

Não alterar demais helpers.

- [ ] **Step 4: Executar a matriz e confirmar GREEN**

Run:

```bash
node --test tests/unit/staging-auth.test.js
```

Expected: 5 testes passam, 0 falhas.

- [ ] **Step 5: Executar specs staging em modo de listagem segura**

Run:

```bash
APP_ENV=preview \
EXTERNAL_WRITES_ENABLED=0 \
STAGING_BASE_URL=https://preview.example.test \
BASE_URL=https://preview.example.test \
E2E_USERNAME=preview-operator \
E2E_PASSWORD=test-password \
STAGING_E2E_USERNAME=preview-operator \
KNOWN_POSTGRES_QUOTATION_ID=ORC-20260001 \
KNOWN_POSTGRES_SCRATCH_QUOTATION_ID=ORC-20269999 \
STAGING_EGRESS_BLOCKED=1 \
STAGING_FIXTURE_RESET=1 \
npx playwright test tests/postgres-only-cutover.spec.js tests/quotation-cutover-staging.spec.js --list
```

Expected: Playwright lista somente os dois specs staging sem iniciar servidor, acessar rede ou executar testes.

- [ ] **Step 6: Commitar a fronteira staging**

```bash
git add tests/unit/staging-auth.test.js tests/support/staging-auth.js
git commit -m "refactor(test): use canonical preview guards"
```

---

## Task 2: Migrar a seleção Playwright e o comando npm com TDD

**Files:**

- Create: `tests/unit/playwright-config.test.js`
- Modify: `playwright.config.js`
- Modify: `package.json`

**Interfaces:**

- Consumes: `APP_ENV`, `EXTERNAL_WRITES_ENABLED`, `STAGING_BASE_URL` e `BASE_URL`.
- Produces: configuração Playwright local com Vite e specs staging ignorados; configuração Preview remota com um worker, sem `webServer` e sem ignore dos specs staging.
- Preserves: validação de origem, projeto Chromium, retries CI, reporter e timeouts.

- [ ] **Step 1: Criar teste comportamental vermelho da configuração**

Criar `tests/unit/playwright-config.test.js`:

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const configUrl = new URL('../../playwright.config.js', import.meta.url);
const configPath = fileURLToPath(configUrl);
const missingEnvPath = fileURLToPath(new URL('./missing-playwright.env', import.meta.url));
const probe = `
  const { default: config } = await import(${JSON.stringify(configUrl.href)});
  process.stdout.write(JSON.stringify({
    workers: config.workers,
    webServer: Boolean(config.webServer),
    testIgnore: config.testIgnore || null,
    baseURL: config.use.baseURL,
  }));
`;

function loadConfig(env) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: missingEnvPath,
      ...env,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('APP_ENV=development mantém servidor local e ignora specs staging', () => {
  const config = loadConfig({ APP_ENV: 'development', BASE_URL: 'http://127.0.0.1:5173' });
  assert.equal(config.workers, 2);
  assert.equal(config.webServer, true);
  assert.deepEqual(config.testIgnore, [
    '**/postgres-only-cutover.spec.js',
    '**/quotation-cutover-staging.spec.js',
  ]);
  assert.equal(config.baseURL, 'http://127.0.0.1:5173');
});

test('APP_ENV=preview usa origem remota, um worker e nenhum servidor local', () => {
  const config = loadConfig({
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    STAGING_BASE_URL: 'https://preview.example.test',
    BASE_URL: 'https://preview.example.test',
  });
  assert.equal(config.workers, 1);
  assert.equal(config.webServer, false);
  assert.equal(config.testIgnore, null);
  assert.equal(config.baseURL, 'https://preview.example.test');
});

test('Preview rejeita BASE_URL fora da origem staging', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: missingEnvPath,
      APP_ENV: 'preview',
      EXTERNAL_WRITES_ENABLED: '0',
      STAGING_BASE_URL: 'https://preview.example.test',
      BASE_URL: 'https://outside.example.test',
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BASE_URL must match STAGING_BASE_URL during staging E2E/);
});
```

A quebra protegida é: reintroduzir seleção por flags antigas, iniciar Vite contra Preview ou permitir origem divergente.

- [ ] **Step 2: Executar o teste e confirmar RED**

Run:

```bash
node --test tests/unit/playwright-config.test.js
```

Expected: o caso Preview falha porque `playwright.config.js` ainda deriva staging de `STAGING_E2E`.

- [ ] **Step 3: Migrar a seleção no Playwright**

Em `playwright.config.js`, substituir:

```js
const IS_STAGING = process.env.STAGING_E2E === '1';
```

por:

```js
const IS_STAGING =
  String(process.env.APP_ENV || '')
    .trim()
    .toLowerCase() === 'preview';
```

Não alterar `resolveBaseUrl`, workers, `testIgnore`, `webServer` ou outras opções.

- [ ] **Step 4: Migrar o comando staging**

Em `package.json`, substituir o valor de `test:e2e:staging` por:

```json
"DOTENV_CONFIG_PATH=$HOME/.config/aspen-dashboard/.env.local APP_ENV=preview EXTERNAL_WRITES_ENABLED=0 npx playwright test tests/postgres-only-cutover.spec.js tests/quotation-cutover-staging.spec.js"
```

Não criar novo script ou alias.

- [ ] **Step 5: Executar os testes e confirmar GREEN**

Run:

```bash
node --test tests/unit/playwright-config.test.js tests/unit/staging-auth.test.js
```

Expected: 8 testes passam, 0 falhas.

- [ ] **Step 6: Confirmar que o script npm contém somente o contrato novo**

Run:

```bash
node --input-type=module -e "import pkg from './package.json' with { type: 'json' }; const command = pkg.scripts['test:e2e:staging']; if (!command.includes('APP_ENV=preview') || !command.includes('EXTERNAL_WRITES_ENABLED=0') || /STAGING_E2E=|STAGING_EXTERNAL_PROVIDERS_DISABLED/.test(command)) process.exit(1)"
```

Expected: código zero, sem saída.

- [ ] **Step 7: Commitar a seleção canônica**

```bash
git add tests/unit/playwright-config.test.js playwright.config.js package.json
git commit -m "refactor(test): select staging by app environment"
```

---

## Task 3: Atualizar o manifesto operacional com TDD

**Files:**

- Modify: `tests/unit/cutover-env-status.test.js`
- Modify: `scripts/cutover-env-status.mjs`
- Modify: `.env.example`

**Interfaces:**

- Consumes: arquivo externo names-only resolvido por `resolveCutoverEnvFiles`.
- Produces: `requiredCutoverKeys` contém `APP_ENV` e `EXTERNAL_WRITES_ENABLED`, mas não contém as duas flags aposentadas.
- Preserves: saída limitada a nomes e estados `present`/`missing`, seleção de `.env.local`/`.env` e código não zero quando chaves exigidas faltam.

- [ ] **Step 1: Adicionar regressão vermelha ao manifesto**

Adicionar ao fim de `tests/unit/cutover-env-status.test.js`:

```js
test('manifesto usa somente o contrato operacional canônico', () => {
  assert.deepEqual(requiredCutoverKeys, [
    'APP_ENV',
    'EXTERNAL_WRITES_ENABLED',
    'STAGING_BASE_URL',
    'STAGING_DATABASE_URL',
    'STAGING_PG_SERVICE',
    'E2E_USERNAME',
    'E2E_PASSWORD',
    'STAGING_E2E_USERNAME',
    'KNOWN_POSTGRES_QUOTATION_ID',
    'KNOWN_POSTGRES_SCRATCH_QUOTATION_ID',
    'STAGING_EGRESS_BLOCKED',
    'STAGING_FIXTURE_RESET',
    'CANARY_BASE_URL',
    'CANARY_PASSWORD',
    'CANARY_QUOTATION_ID',
    'CANARY_PUBLIC_QUOTATION_URL',
    'PRODUCTION_DATABASE_URL',
    'PRODUCTION_PG_SERVICE',
    'PRODUCTION_CANARY_PASSWORD',
    'KNOWN_PRODUCTION_POSTGRES_QUOTATION_ID',
    'KNOWN_PRODUCTION_PUBLIC_QUOTATION_URL',
    'PREVIEW_DEPLOYMENT_URL',
    'PREVIOUS_PRODUCTION_DEPLOYMENT_URL',
    'POST_CLEANUP_PREVIEW_URL',
  ]);
});
```

A quebra protegida é: preflight continuar exigindo flags aposentadas ou deixar de listar o contrato canônico.

- [ ] **Step 2: Executar o teste e confirmar RED**

Run:

```bash
node --test tests/unit/cutover-env-status.test.js
```

Expected: o novo teste falha nas inclusões canônicas e exclusões das flags antigas.

- [ ] **Step 3: Alterar somente as chaves do manifesto**

Em `scripts/cutover-env-status.mjs`, no início de `requiredCutoverKeys`:

1. Adicionar:

```js
  'APP_ENV',
  'EXTERNAL_WRITES_ENABLED',
```

2. Remover:

```js
  'STAGING_E2E',
  'STAGING_EXTERNAL_PROVIDERS_DISABLED',
```

Preservar ordem dos demais nomes e toda lógica de redaction.

- [ ] **Step 4: Limpar as declarações aposentadas do exemplo**

Em `.env.example`, remover somente:

```text
STAGING_E2E=
STAGING_EXTERNAL_PROVIDERS_DISABLED=
```

Preservar no topo:

```text
APP_ENV=development
EXTERNAL_WRITES_ENABLED=0
```

Preservar `STAGING_EGRESS_BLOCKED=`, `STAGING_FIXTURE_RESET=` e todos os valores operacionais restantes.

- [ ] **Step 5: Executar testes e confirmar GREEN**

Run:

```bash
node --test tests/unit/cutover-env-status.test.js tests/unit/staging-auth.test.js
```

Expected: 15 testes passam, 0 falhas.

- [ ] **Step 6: Verificar redaction via CLI temporária**

Run:

```bash
node --test tests/unit/cutover-env-status.test.js
```

Expected: testes de CLI continuam provando código zero para manifesto completo, código 1 para chave ausente e ausência do sentinel secreto na saída.

- [ ] **Step 7: Commitar o manifesto canônico**

```bash
git add tests/unit/cutover-env-status.test.js scripts/cutover-env-status.mjs .env.example
git commit -m "refactor(config): retire redundant staging flags"
```

---

## Task 4: Atualizar documentação operacional e lifecycle das flags

**Files:**

- Modify: `docs/operational-cutoff-procedure.md`
- Modify: `docs/baseline-refatoracao.md`

**Interfaces:**

- Consumes: contrato implementado nas Tasks 1–3.
- Produces: runbook executável com o mesmo comando seguro e inventário declarativo coerente.
- Preserves: procedimentos PostgreSQL, canário Production, transição VPS e documentos históricos sob `docs/superpowers/`.

- [ ] **Step 1: Atualizar o checklist Preview**

Em `docs/operational-cutoff-procedure.md`, remover o item:

```md
- `STAGING_EXTERNAL_PROVIDERS_DISABLED=1` configurado no executor staging.
```

Preservar os itens de `APP_ENV=preview`, `EXTERNAL_WRITES_ENABLED=0`, `STAGING_EGRESS_BLOCKED=1` e `STAGING_FIXTURE_RESET=1`.

- [ ] **Step 2: Registrar owner, propósito e condição de remoção**

Após o checklist Preview, adicionar:

```md
### Lifecycle das flags staging restantes

| Flag                     | Owner          | Propósito                                                      | Condição de remoção                                                                     |
| ------------------------ | -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `STAGING_EGRESS_BLOCKED` | operação/infra | atestar bloqueio de egress durante E2E mutável                 | substituir por prova automática equivalente no executor                                 |
| `STAGING_FIXTURE_RESET`  | QA/operação    | autorizar limpeza das fixtures staging declaradas descartáveis | suíte deixar de mutar staging ou isolamento automático tornar a atestação desnecessária |

Essas flags não duplicam `APP_ENV` nem `EXTERNAL_WRITES_ENABLED`; elas atestam controles operacionais independentes.
```

- [ ] **Step 3: Atualizar o comando operacional**

No comando staging de `docs/operational-cutoff-procedure.md`:

1. Substituir `STAGING_E2E=1` por:

```bash
APP_ENV=preview \
EXTERNAL_WRITES_ENABLED=0 \
```

2. Remover:

```bash
STAGING_EXTERNAL_PROVIDERS_DISABLED=1 \
```

3. Preservar `BASE_URL`, `STAGING_BASE_URL`, credenciais E2E, IDs, egress, reset e lista de specs.

- [ ] **Step 4: Atualizar o inventário declarativo**

Em `docs/baseline-refatoracao.md`, na linha `Staging`, substituir a lista por:

```md
| Staging | `APP_ENV`, `EXTERNAL_WRITES_ENABLED`, `STAGING_BASE_URL`, `STAGING_DATABASE_URL`, `STAGING_PG_SERVICE`, `STAGING_E2E_USERNAME`, `STAGING_EGRESS_BLOCKED`, `STAGING_FIXTURE_RESET` |
```

Não alterar tabelas históricas não relacionadas.

- [ ] **Step 5: Verificar documentação formatada e referências ativas**

Run:

```bash
npx prettier --check docs/operational-cutoff-procedure.md docs/baseline-refatoracao.md
if rg -n 'STAGING_E2E(?:=|`|\b)|STAGING_EXTERNAL_PROVIDERS_DISABLED' \
  playwright.config.js package.json scripts tests .env.example \
  docs/operational-cutoff-procedure.md docs/baseline-refatoracao.md; then
  echo 'active retired staging flag reference found' >&2
  exit 1
fi
```

Expected: Prettier passa; `rg` não encontra flags aposentadas no escopo ativo. Specs e planos históricos ficam fora da busca.

- [ ] **Step 6: Commitar a documentação operacional**

```bash
git add docs/operational-cutoff-procedure.md docs/baseline-refatoracao.md
git commit -m "docs(config): document staging flag lifecycle"
```

---

## Task 5: Verificação integral e aceite da Fase 18

**Files:**

- Verify only: todos os arquivos alterados nas Tasks 1–4.
- Preserve: `drizzle/`, `public/`, configuração externa e serviços remotos.

**Interfaces:**

- Consumes: implementação completa da Fase 18.
- Produces: evidência local fresca de testes, build, guards estruturais e invariantes do diff.

- [ ] **Step 1: Executar testes focados**

Run:

```bash
node --test \
  tests/unit/staging-auth.test.js \
  tests/unit/playwright-config.test.js \
  tests/unit/cutover-env-status.test.js
```

Expected: todos os testes passam, 0 falhas.

- [ ] **Step 2: Executar scanner legado**

Run:

```bash
node scripts/check-no-legacy-provider.mjs
```

Expected: código zero sem segredo, payload ou dado pessoal.

- [ ] **Step 3: Executar suíte rápida**

Run:

```bash
npm run verify:fast
```

Expected: lint, typecheck, boundaries, migrations, layout Vercel e testes unitários passam.

Sem `TEST_DATABASE_URL`, skips PostgreSQL previstos não bloqueiam. Não apontar testes para banco real, staging ou Production.

- [ ] **Step 4: Executar suíte completa local**

Run:

```bash
npm run verify:full
```

Expected: `verify:fast`, build web e E2E local passam. Playwright local inicia Vite e ignora os dois specs staging.

- [ ] **Step 5: Executar preflight redigido**

Run:

```bash
node scripts/cutover-env-status.mjs
```

Expected: saída contém somente paths, nomes e estados `present`/`missing`. Código 1 é aceitável se a configuração externa estiver incompleta; nunca copiar valores para relatório ou chat.

- [ ] **Step 6: Confirmar ausência ativa das flags aposentadas**

Run:

```bash
if rg -n 'STAGING_E2E(?:=|`|\b)|STAGING_EXTERNAL_PROVIDERS_DISABLED' \
  playwright.config.js package.json scripts tests .env.example \
  docs/operational-cutoff-procedure.md docs/baseline-refatoracao.md; then
  echo 'active retired staging flag reference found' >&2
  exit 1
fi
```

Expected: nenhum resultado e código zero.

- [ ] **Step 7: Confirmar invariantes do diff**

Run:

```bash
git diff --check
test -z "$(git diff --name-only ab7e42f..HEAD -- drizzle)"
test -z "$(git diff --name-only ab7e42f..HEAD -- public)"
git status --short --branch
```

Expected: sem whitespace inválido, sem alterações em `drizzle/` ou `public/`; status contém somente mudanças intencionais ainda não commitadas, se houver.

- [ ] **Step 8: Executar diagnostics finais**

Run:

```bash
npx eslint \
  tests/unit/staging-auth.test.js \
  tests/unit/playwright-config.test.js \
  tests/unit/cutover-env-status.test.js \
  tests/support/staging-auth.js \
  playwright.config.js \
  scripts/cutover-env-status.mjs
npx prettier --check \
  tests/unit/staging-auth.test.js \
  tests/unit/playwright-config.test.js \
  tests/unit/cutover-env-status.test.js \
  tests/support/staging-auth.js \
  playwright.config.js \
  package.json \
  scripts/cutover-env-status.mjs \
  docs/operational-cutoff-procedure.md \
  docs/baseline-refatoracao.md
```

Expected: zero erros e zero warnings bloqueantes.

- [ ] **Step 9: Confirmar histórico final**

Run:

```bash
test -z "$(git status --porcelain)"
git log -5 --oneline
```

Expected: worktree limpo e commits das Tasks 1–4 visíveis. Não executar staging remoto, deploy, push ou migration.

---

## Self-review Checklist

- [ ] `APP_ENV=preview` é a única seleção do modo staging.
- [ ] `EXTERNAL_WRITES_ENABLED=0` é obrigatório no helper e no comando npm.
- [ ] Flags aposentadas não têm alias nem fallback.
- [ ] Egress e reset continuam obrigatórios e testados separadamente.
- [ ] Execução local mantém Vite, dois workers e ignore dos specs staging.
- [ ] Execução Preview mantém origem restrita, um worker e nenhum servidor local.
- [ ] Manifesto operacional lista os nomes canônicos e preserva redaction.
- [ ] `.env.example` mantém defaults locais seguros.
- [ ] Owner, propósito e condição de remoção estão documentados para as flags restantes.
- [ ] Nenhuma dependência, migration, alteração externa ou arquivo gerado foi adicionado.
- [ ] Testes focados, `verify:fast`, `verify:full`, scanner, Prettier, ESLint e `git diff --check` foram executados antes da conclusão.
