# Finalização PostgreSQL-Only Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalizar a entrega PostgreSQL-only já integrada ao `master`, validar staging e Production sem dependência Frappe/ERPNext, registrar evidências e encerrar com segurança a branch histórica `postgres-only-removal`.

**Architecture:** O trabalho continua em uma branch nova criada de `origin/master`, sem mergear novamente os 59 commits da branch histórica.
Os testes locais, o staging VPS com egress default-deny e um canário Production somente leitura formam gates sequenciais.
Cada gate falha fechado, preserva o deployment anterior e impede remoção de credenciais ou limpeza Git antes da validação seguinte.

**Tech Stack:** Git worktrees, Node.js 22 ESM, React 19, Vite 6, Playwright, PostgreSQL/Drizzle, Vercel CLI e staging Hostinger VPS com nftables.

**Spec:** `docs/superpowers/specs/2026-08-10-remocao-definitiva-frappe-design.md`

## Global Constraints

- Não mergear `postgres-only-removal` em `master` novamente.
- O commit `de0d4f6fb3aeb1cc3096f9bcb7c92550eb915056` deve permanecer ancestral de `origin/master`.
- Não adicionar provider fallback, rollout branch ou dependência nova.
- Não modificar migrations históricas existentes sob `drizzle/`.
- Não inserir seed, backfill ou dados inventados em Production.
- Não chamar endpoints de envio WhatsApp nem de captura Typebot no canário Production.
- Staging deve manter egress default-deny e bloquear Frappe, ERPNext, N8N, Evolution e providers externos.
- Secrets, payloads, cookies, URLs assinadas e valores de variáveis nunca entram em Git, logs compartilhados ou relatórios.
- Evidências operacionais sensíveis ficam fora do checkout, com modo `0700` no diretório e `0600` nos arquivos.
- Migration, promoção Production, remoção de variáveis Vercel, revogação de credenciais e limpeza destrutiva exigem confirmação explícita imediatamente antes da ação.
- Qualquer falha em backup, staging, canário, egress, unit tests, lint ou build interrompe o cutover.
- O deployment Production anterior permanece disponível até o canário final passar após a remoção das variáveis.

---

## File Map

- Create: `docs/superpowers/plans/2026-08-14-finalizacao-postgres-only-removal.md`
- Create: `tests/postgres-only-cutover.spec.js`
- Create: `tests/unit/postgres-only-canary.test.js`
- Create: `scripts/postgres-only-canary.mjs`
- Create: `docs/superpowers/reports/2026-08-14-postgres-only-finalization-acceptance.md`
- Modify: `tests/support/staging-auth.js`
- Modify: `tests/quotation-cutover-staging.spec.js`
- Modify: `docs/operational-cutoff-procedure.md`
- Modify: `.superpowers/sdd/2026-08-10-remocao-definitiva-frappe/progress.md`
- Modify: the 19 files reported by `npm run lint` only where required to remove existing warnings.
- Preserve: `docs/superpowers/plans/2026-08-10-remocao-definitiva-frappe.md` as historical plan evidence.
- Preserve: every existing file under `drizzle/`.

### Task 1: Continue from current `master`, not from the historical branch

**Files:**

- Create in fresh worktree: `docs/superpowers/plans/2026-08-14-finalizacao-postgres-only-removal.md`
- Verify: `scripts/check-no-legacy-provider.mjs`
- Verify: `tests/unit/check-no-legacy-provider.test.js`

**Interfaces:**

- Consumes: local branch `postgres-only-removal`, `origin/master` and squash commit `de0d4f6`.
- Produces: clean worktree `postgres-only-finalization` based exactly on current `origin/master`.

- [ ] **Step 1: Capture the historical branch without changing it**

Run from the current `postgres-only-removal` worktree:

```bash
OLD_WORKTREE=$(git rev-parse --show-toplevel)
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
FINAL_WORKTREE="$MAIN_ROOT/.worktrees/postgres-only-finalization"
PLAN_REL="docs/superpowers/plans/2026-08-14-finalizacao-postgres-only-removal.md"

git status --short --branch
git fetch --prune origin
git merge-base --is-ancestor de0d4f6 origin/master
test -z "$(git ls-remote --heads origin postgres-only-removal)"
test -z "$(git branch --show-current | grep -v '^postgres-only-removal$')"
```

Expected: the worktree contains only the new plan, `de0d4f6` is in `origin/master`, and no remote historical branch exists.

- [ ] **Step 2: Verify that the final guard hardening reached the integrated commit**

Run:

```bash
test "$(git rev-parse 38a9292:scripts/check-no-legacy-provider.mjs)" = \
  "$(git rev-parse de0d4f6:scripts/check-no-legacy-provider.mjs)"
test "$(git rev-parse 38a9292:tests/unit/check-no-legacy-provider.test.js)" = \
  "$(git rev-parse de0d4f6:tests/unit/check-no-legacy-provider.test.js)"
```

Expected: both comparisons exit zero.

- [ ] **Step 3: Create a fresh finalization worktree**

Run:

```bash
test ! -e "$FINAL_WORKTREE"
git -C "$MAIN_ROOT" worktree add "$FINAL_WORKTREE" -b postgres-only-finalization origin/master
mkdir -p "$FINAL_WORKTREE/$(dirname "$PLAN_REL")"
cp "$OLD_WORKTREE/$PLAN_REL" "$FINAL_WORKTREE/$PLAN_REL"
cd "$FINAL_WORKTREE"
git status --short --branch
```

Expected: branch `postgres-only-finalization` points at `origin/master`, and only the plan is untracked.

- [ ] **Step 4: Commit the execution plan on the fresh branch**

```bash
git add docs/superpowers/plans/2026-08-14-finalizacao-postgres-only-removal.md
git commit -m "docs: plan PostgreSQL-only finalization"
```

### Task 2: Remove the current lint warning baseline

**Files:**

- Modify: `api/_db/quotation-issue-repository.ts`
- Modify: `api/_db/quote-repository.ts`
- Modify: `api/_functions/communication-flow-preview.ts`
- Modify: `api/_functions/communication-flows.ts`
- Modify: `api/_functions/communication-media-upload.ts`
- Modify: `api/_functions/communication-media.ts`
- Modify: `api/_functions/communication-send-events.ts`
- Modify: `api/_functions/edit-draft.ts`
- Modify: `api/_functions/lib/postgres-media.ts`
- Modify: `api/_functions/lib/whatsapp-identity-audit.ts`
- Modify: `api/_functions/pdf.ts`
- Modify: `api/_functions/product-pricing.ts`
- Modify: `api/_functions/quote-leads.ts`
- Modify: `api/_functions/send-whatsapp-flow.ts`
- Modify: `api/_functions/typebot-lead-capture.ts`
- Modify: `api/_functions/view.ts`
- Modify: `api/_functions/whatsapp-flows.ts`
- Modify: `api/_functions/whatsapp-leads.ts`
- Modify: `tests/unit/check-no-legacy-provider.test.js`
- Test: affected existing unit tests beside each handler or repository.

**Interfaces:**

- Consumes: existing `FunctionEvent`, repository row types, handler payload types and local narrowing functions.
- Produces: unchanged runtime behavior with `npm run lint -- --max-warnings=0` passing.

- [ ] **Step 1: Record the exact warning baseline on fresh `master`**

Run:

```bash
npm run lint 2>&1 | tee /tmp/postgres-only-finalization-eslint.log
grep -E 'problems \([0-9]+ errors, [0-9]+ warnings\)' /tmp/postgres-only-finalization-eslint.log
```

Expected before cleanup: zero errors and the current warning count from `origin/master`.

- [ ] **Step 2: Remove unused bindings instead of suppressing them**

Delete the unused `observations`, `line`, and any other binding reported by `@typescript-eslint/no-unused-vars` or `no-unused-vars` only after confirming the initializer has no side effect.

Do not prefix dead variables with `_`, and do not add eslint disable comments.

Run focused checks after each file:

```bash
npx eslint api/_db/quotation-issue-repository.ts api/_db/quote-repository.ts tests/unit/check-no-legacy-provider.test.js --max-warnings=0
npm run build:api
```

Expected: zero warnings in these files and API compilation success.

- [ ] **Step 3: Replace explicit `any` with existing boundary types or `unknown` plus narrowing**

Use these forms in preference order:

```ts
function handler(event: FunctionEvent): Promise<FunctionResult> {
  // Existing handler contract.
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const payload = isRecord(value) ? value : {};
```

Reuse an existing imported type when one already describes the value.
Use `unknown` only at untrusted JSON, database-driver and external transport boundaries.
Do not add a shared abstraction solely for this cleanup.

Run eslint in domain-sized groups:

```bash
npx eslint \
  api/_functions/communication-flow-preview.ts \
  api/_functions/communication-flows.ts \
  api/_functions/communication-media-upload.ts \
  api/_functions/communication-media.ts \
  api/_functions/communication-send-events.ts \
  api/_functions/lib/postgres-media.ts \
  --max-warnings=0

npx eslint \
  api/_functions/send-whatsapp-flow.ts \
  api/_functions/whatsapp-flows.ts \
  api/_functions/whatsapp-leads.ts \
  api/_functions/lib/whatsapp-identity-audit.ts \
  --max-warnings=0

npx eslint \
  api/_functions/edit-draft.ts \
  api/_functions/pdf.ts \
  api/_functions/product-pricing.ts \
  api/_functions/quote-leads.ts \
  api/_functions/typebot-lead-capture.ts \
  api/_functions/view.ts \
  --max-warnings=0
```

Expected: each command exits zero without warning suppressions.

- [ ] **Step 4: Verify behavior after type narrowing**

Run:

```bash
npm run build:api
TZ=UTC node --test tests/unit/*.test.{js,ts}
npm run lint -- --max-warnings=0
```

Expected: API build passes, all configured unit tests pass, and lint reports zero warnings.

- [ ] **Step 5: Commit lint cleanup separately from cutover behavior**

```bash
git add api tests/unit/check-no-legacy-provider.test.js
git commit -m "refactor: remove lint warnings"
```

### Task 3: Prove local test stability before adding operational assets

**Files:**

- Create: `docs/superpowers/reports/2026-08-14-postgres-only-finalization-acceptance.md`
- Test: `tests/unit/check-no-legacy-provider.test.js`
- Test: all `tests/unit/*.test.{js,ts}`.

**Interfaces:**

- Consumes: warning-free source tree and existing no-legacy guard.
- Produces: three consecutive green unit runs and a report containing only command names, counts, commit IDs and pass/fail status.

- [ ] **Step 1: Reproduce the formerly observed guard assertion repeatedly**

Run:

```bash
for run in $(seq 1 20); do
  TZ=UTC node --test \
    --test-name-pattern='reports deterministic labels without matched content or PII' \
    tests/unit/check-no-legacy-provider.test.js \
    >"/tmp/provider-guard-focused-$run.log" 2>&1 || exit 1
done
```

Expected: 20 of 20 runs pass with one diagnostic line and no leaked fixture content.

If any run fails, stop this plan and use `superpowers:systematic-debugging` against the preserved failing log before changing code.

- [ ] **Step 2: Require three consecutive full unit runs**

Run:

```bash
for run in 1 2 3; do
  TZ=UTC node --test tests/unit/*.test.{js,ts} \
    >"/tmp/postgres-only-unit-$run.log" 2>&1 || exit 1
  grep -E '^# (tests|pass|fail|cancelled|skipped|todo) ' \
    "/tmp/postgres-only-unit-$run.log"
done
```

Expected on the current suite: each run reports 582 tests, 559 passed, 0 failed and 23 skipped when optional database fixtures are unavailable.
Counts may increase when Task 4 adds tests, but failure count must remain zero.

- [ ] **Step 3: Create the acceptance report with non-sensitive evidence**

Create `docs/superpowers/reports/2026-08-14-postgres-only-finalization-acceptance.md` with these sections:

```markdown
# PostgreSQL-Only Finalization Acceptance

## Git integration

## Local verification

## Staging deployment

## Staging egress

## Production backup and deployment

## Production canary

## Vercel environment cleanup

## Credential revocation

## Residual risks
```

Record commit hashes, test counts, command exit status and protected evidence file paths.
Do not copy request bodies, database rows, cookies, secret values or signed URLs.

- [ ] **Step 4: Commit local stability evidence**

```bash
git add docs/superpowers/reports/2026-08-14-postgres-only-finalization-acceptance.md
git commit -m "docs: record PostgreSQL-only local verification"
```

### Task 4: Add reusable staging egress checks and a read-only Production canary

**Files:**

- Create: `tests/postgres-only-cutover.spec.js`
- Create: `tests/unit/postgres-only-canary.test.js`
- Create: `scripts/postgres-only-canary.mjs`
- Modify: `tests/support/staging-auth.js`
- Modify: `tests/quotation-cutover-staging.spec.js`
- Modify: `docs/operational-cutoff-procedure.md`
- Test: `tests/unit/postgres-only-canary.test.js`
- Test: `tests/postgres-only-cutover.spec.js`
- Test: `tests/quotation-cutover-staging.spec.js`

**Interfaces:**

- Consumes: `loginToStaging(page)`, `apiRequest(page, method, path, options)` and authenticated `/api/login` session cookies.
- Produces: `assertNoForbiddenEgress(requests: string[]): void` from `tests/support/staging-auth.js`.
- Produces: `readCanaryConfig(env): CanaryConfig` from `scripts/postgres-only-canary.mjs`.
- Produces: `runCanary({ env, fetchImpl }): Promise<CanaryResult>` from `scripts/postgres-only-canary.mjs`.
- Produces: a CLI that exits zero only when every read-only Production check passes.

- [ ] **Step 1: Write failing unit tests for canary safety and response validation**

Create `tests/unit/postgres-only-canary.test.js` with tests that assert:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readCanaryConfig, runCanary } from '../../scripts/postgres-only-canary.mjs';

test('requires a same-origin read-only Production canary configuration', () => {
  assert.throws(() => readCanaryConfig({}), /CANARY_BASE_URL/);
  assert.throws(
    () => readCanaryConfig({
      CANARY_BASE_URL: 'https://user:secret@example.com',
      CANARY_PASSWORD: 'secret',
      CANARY_QUOTATION_ID: 'ORC-1',
      CANARY_PUBLIC_QUOTATION_URL: 'https://example.com/api/public-quotation?token=x',
    }),
    /without credentials/,
  );
});

function validCanaryEnv() {
  return {
    CANARY_BASE_URL: 'https://aspen.example',
    CANARY_PASSWORD: 'secret',
    CANARY_QUOTATION_ID: 'ORC-1',
    CANARY_PUBLIC_QUOTATION_URL: 'https://aspen.example/api/public-quotation?token=test',
  };
}

function canaryFetch(overrides = {}) {
  return async (rawUrl, options = {}) => {
    const url = new URL(String(rawUrl));
    const key = `${options.method || 'GET'} ${url.pathname}${url.search}`;
    if (overrides[key]) return overrides[key];
    if (key === 'POST /api/login') {
      return new Response('{"success":true}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'session=test; HttpOnly' },
      });
    }
    if (key === 'GET /api/quotations?id=ORC-1') {
      return Response.json({ id: 'ORC-1', revision_id: 'revision-1' });
    }
    if (key === 'GET /api/quotation-preview?id=ORC-1&format=pdf') {
      return new Response('%PDF-1.4\n%%EOF', {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'x-document-revision': 'revision-1',
        },
      });
    }
    if (url.pathname === '/api/public-quotation') {
      return new Response('<!doctype html><title>ORC-1</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return Response.json({ ok: true });
  };
}

test('uses POST only for login and keeps every business check read-only', async () => {
  const calls = [];
  const fake = canaryFetch();
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    return fake(url, options);
  };
  await runCanary({ env: validCanaryEnv(), fetchImpl });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls.slice(1).every((call) => call.method === 'GET'), true);
  assert.equal(calls.some((call) => /send-whatsapp|typebot-lead-capture/i.test(call.url)), false);
});

test('fails on provider metadata, wrong revision, invalid PDF and non-2xx responses', async () => {
  const cases = [
    [
      { 'GET /api/products?limit=1': Response.json({ provider: 'frappe' }) },
      /forbidden provider metadata/,
    ],
    [
      {
        'GET /api/quotation-preview?id=ORC-1&format=pdf': new Response('%PDF-1.4\n%%EOF', {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'x-document-revision': 'wrong' },
        }),
      },
      /revision/,
    ],
    [
      {
        'GET /api/quotation-preview?id=ORC-1&format=pdf': new Response('not a pdf', {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'x-document-revision': 'revision-1' },
        }),
      },
      /PDF/,
    ],
    [{ 'GET /api/operational-status': Response.json({ error: 'down' }, { status: 503 }) }, /503/],
  ];
  for (const [overrides, pattern] of cases) {
    await assert.rejects(
      runCanary({ env: validCanaryEnv(), fetchImpl: canaryFetch(overrides) }),
      pattern,
    );
  }
});
```

Do not make network calls from unit tests.

- [ ] **Step 2: Run the canary unit test to verify it fails**

Run:

```bash
node --test tests/unit/postgres-only-canary.test.js
```

Expected: FAIL because `scripts/postgres-only-canary.mjs` does not exist.

- [ ] **Step 3: Implement the minimum read-only canary with Node built-ins**

Create `scripts/postgres-only-canary.mjs` without adding dependencies.
Use this configuration:

```js
export function readCanaryConfig(env = process.env) {
  const required = [
    'CANARY_BASE_URL',
    'CANARY_PASSWORD',
    'CANARY_QUOTATION_ID',
    'CANARY_PUBLIC_QUOTATION_URL',
  ];
  const missing = required.filter((name) => !String(env[name] || '').trim());
  if (missing.length) throw new Error(`Missing canary configuration: ${missing.join(', ')}`);

  const baseUrl = safeOrigin(env.CANARY_BASE_URL, 'CANARY_BASE_URL');
  const publicUrl = new URL(String(env.CANARY_PUBLIC_QUOTATION_URL));
  if (publicUrl.origin !== baseUrl || publicUrl.username || publicUrl.password) {
    throw new Error('CANARY_PUBLIC_QUOTATION_URL must use CANARY_BASE_URL without credentials');
  }

  return {
    baseUrl,
    password: String(env.CANARY_PASSWORD),
    quotationId: String(env.CANARY_QUOTATION_ID).trim(),
    publicUrl: publicUrl.href,
  };
}
```

`runCanary` must:

1. POST `{"password":"..."}` to `/api/login`.
2. Extract only the session cookie pair from `Set-Cookie` without logging it.
3. GET `/api/operational-status`.
4. GET `/api/products?limit=1`.
5. GET `/api/leads-clients?limit=1`.
6. GET ``/api/quotations?id=${encodeURIComponent(config.quotationId)}`` and capture `revision_id`.
7. GET ``/api/quotation-preview?id=${encodeURIComponent(config.quotationId)}&format=pdf`` and verify HTTP 200, `%PDF-` magic bytes and matching `x-document-revision`.
8. GET `/api/crm-deals?limit=1`.
9. GET `/api/sales-orders?limit=1`.
10. GET `/api/sales-dashboard`.
11. GET `CANARY_PUBLIC_QUOTATION_URL` without the admin cookie.
12. Reject response text or JSON containing `frappe`, `erpnext`, `CRM_CORE_`, `CRM_OPERATIONAL_MODE` or `CRM_QUOTES_ROLLOUT_STATE`.
13. Return only check names, status codes and elapsed milliseconds.

Every URL must be created with `new URL(path, baseUrl)` and checked for exact same origin before fetch.
The script must never call mutation, messaging or lead-capture endpoints.
The CLI entry point must print no response body and set `process.exitCode = 1` on any failure.

- [ ] **Step 4: Move the existing egress assertion into the staging helper**

Add this exported helper to `tests/support/staging-auth.js`:

```js
export function assertNoForbiddenEgress(requests) {
  const forbidden = requests.filter((rawUrl) => {
    let parsed;
    try {
      parsed = new globalThis.URL(rawUrl);
    } catch {
      return true;
    }
    const target = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    return /frappe|erpnext|n8n|evolution|external-crm|external-erp|\/api\/send-whatsapp/.test(target);
  });
  assert.equal(forbidden.length, 0, 'staging browser made a forbidden external request');
}
```

Import it from `tests/quotation-cutover-staging.spec.js` and delete the local duplicate.

- [ ] **Step 5: Write broad staging smoke coverage without Production side effects**

Create `tests/postgres-only-cutover.spec.js`.
Use `loginToStaging`, record every browser request, and call `assertNoForbiddenEgress` in `afterEach`.
Navigate these routes serially:

```js
const routes = [
  '/#/dashboard',
  '/#/products',
  '/#/leads',
  '/#/quotations',
  '/#/crm',
  '/#/sales-orders',
  '/#/comunicacao',
  '/#/whatsapp-inbox',
];
```

For each route, require a visible `main` element and reject an uncaught page error.
Use `apiRequest` to require 2xx responses from read-only product, client, quotation, CRM, sales and dashboard endpoints.
Keep public-link mutation, revision editing and disposable cleanup only in `tests/quotation-cutover-staging.spec.js`.
Do not send WhatsApp messages or create Typebot leads from this smoke file.

- [ ] **Step 6: Document exact staging and Production commands**

Update `docs/operational-cutoff-procedure.md` with:

```bash
node scripts/check-no-legacy-provider.mjs
npm run build:api
TZ=UTC node --test tests/unit/*.test.{js,ts}
npm run lint -- --max-warnings=0
npm run build

STAGING_E2E=1 \
BASE_URL="$STAGING_BASE_URL" \
STAGING_BASE_URL="$STAGING_BASE_URL" \
E2E_USERNAME="$E2E_USERNAME" \
E2E_PASSWORD="$E2E_PASSWORD" \
STAGING_E2E_USERNAME="$E2E_USERNAME" \
KNOWN_POSTGRES_QUOTATION_ID="$KNOWN_POSTGRES_QUOTATION_ID" \
KNOWN_POSTGRES_SCRATCH_QUOTATION_ID="$KNOWN_POSTGRES_SCRATCH_QUOTATION_ID" \
STAGING_EXTERNAL_PROVIDERS_DISABLED=1 \
STAGING_EGRESS_BLOCKED=1 \
STAGING_FIXTURE_RESET=1 \
npx playwright test tests/postgres-only-cutover.spec.js tests/quotation-cutover-staging.spec.js

CANARY_BASE_URL="$PRODUCTION_BASE_URL" \
CANARY_PASSWORD="$PRODUCTION_CANARY_PASSWORD" \
CANARY_QUOTATION_ID="$KNOWN_PRODUCTION_POSTGRES_QUOTATION_ID" \
CANARY_PUBLIC_QUOTATION_URL="$KNOWN_PRODUCTION_PUBLIC_QUOTATION_URL" \
node scripts/postgres-only-canary.mjs
```

State explicitly that Production canary is read-only and that staging owns mutating flow coverage.

- [ ] **Step 7: Verify and commit cutover assets**

Run:

```bash
node --test tests/unit/postgres-only-canary.test.js
node scripts/check-no-legacy-provider.mjs
npm run build:api
npm run lint -- --max-warnings=0
```

Expected: every command exits zero.

Commit:

```bash
git add \
  scripts/postgres-only-canary.mjs \
  tests/unit/postgres-only-canary.test.js \
  tests/postgres-only-cutover.spec.js \
  tests/support/staging-auth.js \
  tests/quotation-cutover-staging.spec.js \
  docs/operational-cutoff-procedure.md
git commit -m "test: add PostgreSQL-only cutover canaries"
```

### Task 5: Validate the dedicated staging VPS with egress denied

**Files:**

- Modify: `docs/superpowers/reports/2026-08-14-postgres-only-finalization-acceptance.md`
- Execute: `docs/superpowers/plans/2026-08-10-staging-vps-egress.md`
- Verify: `tests/postgres-only-cutover.spec.js`
- Verify: `tests/quotation-cutover-staging.spec.js`

**Interfaces:**

- Consumes: dedicated Hostinger VPS, staging-only PostgreSQL, protected staging credentials and persisted nftables policy.
- Produces: green staging E2E plus protected proof that forbidden DNS/HTTP egress fails.

- [ ] **Step 1: Create protected evidence storage outside the checkout**

Run on the staging operator machine:

```bash
CUTOVER_DIR="$HOME/.local/share/aspen-dashboard/postgres-only-finalization-20260814"
install -d -m 0700 "$CUTOVER_DIR"
```

Expected: directory exists with mode `0700`.

- [ ] **Step 2: Complete the existing VPS egress plan before cutover validation**

Execute Tasks 1 through 5 from `docs/superpowers/plans/2026-08-10-staging-vps-egress.md`.

Required resulting state:

- Evolution is stopped.
- Aspen staging runs behind Traefik on the dedicated hostname.
- Staging uses only staging PostgreSQL and staging-only credentials.
- nftables default-deny applies to host and Docker forwarding paths.
- Frappe, ERPNext, N8N, Evolution and provider hosts are absent from the allowlist.
- The policy survives service restart and VPS reboot verification.
- No Production DNS, deployment, database or environment is changed.

If approved root SSH or VPS console access is unavailable, stop without mutating firewall state.

- [ ] **Step 3: Apply only pending compatible staging migrations**

Run migration status and backup checks before `npm run db:migrate`.
Use the staging named PostgreSQL service and never a Production URL.

```bash
: "${STAGING_DATABASE_URL:?configure staging database}"
: "${STAGING_PG_SERVICE:?configure named staging service}"
DATABASE_URL="$STAGING_DATABASE_URL" npm run db:migrate
```

Expected: migration completes against staging, without seed or backfill.

- [ ] **Step 4: Run focused staging cutover suites**

Run the exact staging command documented in Task 4.

Expected: all tests pass with one worker, disposable quotation cleanup succeeds and no forbidden browser request is observed.

- [ ] **Step 5: Capture egress evidence without recording payloads**

Capture only:

- nftables ruleset checksum and service status;
- failed DNS/HTTPS probes to forbidden hosts;
- successful PostgreSQL connectivity probe;
- staging deploy ID and commit hash;
- Playwright summary counts;
- Evolution stopped state.

Write raw operational evidence under `$CUTOVER_DIR` with mode `0600`.
Write only evidence paths, checksums and pass/fail summaries into the Git report.

- [ ] **Step 6: Commit staging acceptance summary**

```bash
git add docs/superpowers/reports/2026-08-14-postgres-only-finalization-acceptance.md
git commit -m "docs: record PostgreSQL-only staging acceptance"
```

### Task 6: Promote Production, remove legacy configuration and rerun the canary

**Files:**

- Modify: `docs/superpowers/reports/2026-08-14-postgres-only-finalization-acceptance.md`
- Verify: `scripts/postgres-only-canary.mjs`
- Verify: `scripts/backup-crm.mjs`

**Interfaces:**

- Consumes: green staging gate, tested Vercel preview, protected Production backup and explicit user confirmation.
- Produces: Production deployment with no legacy provider variables and a green post-cleanup read-only canary.

- [ ] **Step 1: Create and verify a Production backup before deployment**

Use the named Production PostgreSQL service and protected backup directory.
Do not infer the newest backup file.

```bash
CUTOVER_DIR="$HOME/.local/share/aspen-dashboard/postgres-only-finalization-20260814"
CUTOVER_BACKUP_DIR="$CUTOVER_DIR/backups"
install -d -m 0700 "$CUTOVER_BACKUP_DIR"

: "${PRODUCTION_DATABASE_URL:?configure Production database}"
: "${PRODUCTION_PG_SERVICE:?configure named Production service}"

DATABASE_URL="$PRODUCTION_DATABASE_URL" \
PGSERVICE="$PRODUCTION_PG_SERVICE" \
CUTOVER_BACKUP_DIR="$CUTOVER_BACKUP_DIR" \
node scripts/backup-crm.mjs --preflight

DATABASE_URL="$PRODUCTION_DATABASE_URL" \
PGSERVICE="$PRODUCTION_PG_SERVICE" \
CUTOVER_BACKUP_DIR="$CUTOVER_BACKUP_DIR" \
node scripts/backup-crm.mjs
```

Select the exact generated backup path from the command output, then run:

```bash
BACKUP_FILE="/absolute/protected/path/from-the-backup-command.sql"
sha256sum "$BACKUP_FILE" > "$CUTOVER_DIR/production-backup.sha256"
sha256sum --check "$CUTOVER_DIR/production-backup.sha256"
chmod 0600 "$BACKUP_FILE" "$CUTOVER_DIR/production-backup.sha256"
```

Expected: preflight, backup and checksum all pass.
The literal path is operator-provided from the preceding command and is never committed.

- [ ] **Step 2: Deploy and inspect a preview without touching Production**

Run:

```bash
vercel deploy
vercel list --status READY
vercel inspect "$PREVIEW_DEPLOYMENT_URL"
vercel logs --deployment "$PREVIEW_DEPLOYMENT_URL" --level error --limit 50
```

Expected: preview is READY, uses the finalization commit and has no deployment errors.

- [ ] **Step 3: Stop for explicit Production approval**

Present these items to the user without secret values:

- finalization commit hash;
- staging deploy ID and green test counts;
- staging egress evidence checksum;
- backup checksum and protected path;
- preview deployment URL;
- previous Production deployment ID;
- rollback command `vercel rollback <previous-deployment-url-or-id>`.

Do not continue until the user explicitly approves Production promotion.

- [ ] **Step 4: Promote the tested preview and run the first Production canary**

After approval:

```bash
vercel promote "$PREVIEW_DEPLOYMENT_URL" --yes
vercel promote status
vercel logs --environment production --level error --since 5m
```

Run the exact Production canary command from Task 4.

Expected: promotion succeeds and every read-only canary check passes before environment cleanup.

If the canary fails, stop and run through the interactive CLI:

```bash
vercel rollback "$PREVIOUS_PRODUCTION_DEPLOYMENT_URL"
vercel rollback status
```

- [ ] **Step 5: List legacy variable names without downloading values**

Run:

```bash
FORBIDDEN_ENV_RE='^(ERPNEXT_|FRAPPE_|CRM_CORE_|CRM_OPERATIONAL_MODE$|CRM_QUOTES_ROLLOUT_STATE$)'
for environment in development preview production; do
  vercel env ls "$environment" >"$CUTOVER_DIR/vercel-env-$environment.names.txt"
  chmod 0600 "$CUTOVER_DIR/vercel-env-$environment.names.txt"
  grep -E "$FORBIDDEN_ENV_RE" "$CUTOVER_DIR/vercel-env-$environment.names.txt" || true
done
```

Expected before removal: output contains only names targeted by the approved cleanup.
Do not run `vercel env pull`, because it downloads values.

- [ ] **Step 6: Stop for explicit variable-removal approval**

Show the user only the variable names and environments to remove.
Do not continue until the user explicitly approves removal.

- [ ] **Step 7: Remove legacy variables through an interactive parent session**

For each approved `name` and `environment` pair from Step 5, run this exact command through `interactive_shell`, not background `bash`:

```bash
vercel env rm "$name" "$environment"
```

Answer the Vercel confirmation only after checking the displayed project, variable name and environment.
Never print or paste variable values.

- [ ] **Step 8: Redeploy after removal and rerun the final canary**

Run:

```bash
vercel deploy
vercel inspect "$POST_CLEANUP_PREVIEW_URL"
vercel logs --deployment "$POST_CLEANUP_PREVIEW_URL" --level error --limit 50
vercel promote "$POST_CLEANUP_PREVIEW_URL" --yes
vercel promote status
vercel logs --environment production --level error --since 5m
```

Run the exact Production canary command again.

Expected: the post-cleanup deployment is green and read-only canary results match the pre-cleanup deployment.

If it fails, immediately stop and use `vercel rollback "$PREVIOUS_PRODUCTION_DEPLOYMENT_URL"`, then investigate before any credential revocation.

- [ ] **Step 9: Verify environment cleanup and revoke the old external credential**

Run:

```bash
for environment in development preview production; do
  vercel env ls "$environment" >"$CUTOVER_DIR/vercel-env-$environment.final.names.txt"
  chmod 0600 "$CUTOVER_DIR/vercel-env-$environment.final.names.txt"
  if grep -E "$FORBIDDEN_ENV_RE" "$CUTOVER_DIR/vercel-env-$environment.final.names.txt"; then
    echo "legacy variable remains in $environment" >&2
    exit 1
  fi
done
```

Expected: no forbidden variable name remains.

Request explicit user approval again before revoking the external Frappe/ERPNext credential at its issuer.
Revoke it only after this check and the final Production canary both pass.

- [ ] **Step 10: Commit Production acceptance summary**

Record deployment IDs, command exit states, canary check names, environment names removed, backup checksum, rollback readiness and credential revocation status.
Do not record values or response bodies.

```bash
git add docs/superpowers/reports/2026-08-14-postgres-only-finalization-acceptance.md
git commit -m "docs: record PostgreSQL-only Production cutover"
```

### Task 7: Close the ledger, verify the final tree and retire the historical branch

**Files:**

- Modify: `.superpowers/sdd/2026-08-10-remocao-definitiva-frappe/progress.md`
- Modify: `docs/superpowers/reports/2026-08-14-postgres-only-finalization-acceptance.md`
- Verify: all files changed by `postgres-only-finalization`.

**Interfaces:**

- Consumes: green local, staging and Production gates.
- Produces: accurate ledger, reviewed finalization branch and safe retirement decision for `postgres-only-removal`.

- [ ] **Step 1: Update the stale progress ledger**

In `.superpowers/sdd/2026-08-10-remocao-definitiva-frappe/progress.md`:

- Mark Task 9 complete with branch commits `28876b9..38a9292` and integrated master commit `de0d4f6`.
- Mark Task 10 complete only after every gate in Task 6 passes.
- Add the acceptance report path and final Production deployment ID.
- State that the historical branch was integrated by squash/manual commit, not by ancestry merge.
- Preserve all prior review records and deferred notes.

- [ ] **Step 2: Run complete final verification from a clean tree**

Run:

```bash
node scripts/check-no-legacy-provider.mjs
npm run build:api
TZ=UTC node --test tests/unit/*.test.{js,ts}
npm run lint -- --max-warnings=0
npm run build
STAGING_E2E=1 \
BASE_URL="$STAGING_BASE_URL" \
STAGING_BASE_URL="$STAGING_BASE_URL" \
E2E_USERNAME="$E2E_USERNAME" \
E2E_PASSWORD="$E2E_PASSWORD" \
STAGING_E2E_USERNAME="$E2E_USERNAME" \
KNOWN_POSTGRES_QUOTATION_ID="$KNOWN_POSTGRES_QUOTATION_ID" \
KNOWN_POSTGRES_SCRATCH_QUOTATION_ID="$KNOWN_POSTGRES_SCRATCH_QUOTATION_ID" \
STAGING_EXTERNAL_PROVIDERS_DISABLED=1 \
STAGING_EGRESS_BLOCKED=1 \
STAGING_FIXTURE_RESET=1 \
npx playwright test tests/postgres-only-cutover.spec.js tests/quotation-cutover-staging.spec.js
git status --short
git diff --check
git log --oneline origin/master..HEAD
```

Expected:

- legacy guard exits zero;
- API and frontend builds exit zero;
- unit tests have zero failures;
- lint has zero warnings;
- focused Playwright suites pass in their correct local/staging environments;
- no whitespace errors exist;
- only intended finalization commits are ahead of `origin/master`.

- [ ] **Step 3: Verify no migration or secret was added accidentally**

Run:

```bash
test -z "$(git diff --name-only origin/master...HEAD -- drizzle/)"
test -z "$(git diff --name-only origin/master...HEAD | grep -E '(^|/)\.env($|\.)|credential|secret' || true)"
git diff --name-status origin/master...HEAD
```

Expected: no `drizzle/` change and no environment or credential file in the diff.

- [ ] **Step 4: Commit ledger completion**

```bash
git add \
  .superpowers/sdd/2026-08-10-remocao-definitiva-frappe/progress.md \
  docs/superpowers/reports/2026-08-14-postgres-only-finalization-acceptance.md
git commit -m "docs: close PostgreSQL-only removal"
```

- [ ] **Step 5: Request independent review before integration**

Use `superpowers:requesting-code-review` against `origin/master...HEAD`.
The reviewer must verify spec compliance, security boundaries, canary read-only behavior, no secret exposure and evidence completeness.
Fix only accepted findings, rerun the complete final verification and stop after at most three review/fix rounds.

- [ ] **Step 6: Hand integration choice to the user**

Use `superpowers:finishing-a-development-branch`.
Do not auto-merge, auto-push or auto-delete.
Present the standard merge, PR and keep-as-is options after tests pass.

- [ ] **Step 7: Retire `postgres-only-removal` only after finalization lands**

After the finalization branch is integrated and verified on `master`, show the user:

- branch name `postgres-only-removal`;
- worktree path;
- commit range `12c7e59..38a9292`;
- proof that `de0d4f6` and final guard blobs are present in `master`;
- clean `git status --porcelain -uall` for the historical worktree.

Delete the historical branch and worktree only after explicit user approval.
Never use `git worktree remove --force`.

## Definition of Done

- [ ] `origin/master` contains the PostgreSQL-only removal and finalization commits.
- [ ] The historical branch was not merged a second time.
- [ ] `node scripts/check-no-legacy-provider.mjs` passes.
- [ ] Three consecutive full unit runs pass with zero failures.
- [ ] `npm run lint -- --max-warnings=0` passes.
- [ ] `npm run build` passes.
- [ ] Staging PostgreSQL-only E2E passes with egress default-deny active.
- [ ] Staging firewall and logs show no Frappe/ERPNext DNS or HTTP egress.
- [ ] Production backup and checksum are protected and verified.
- [ ] Production read-only canary passes before and after legacy environment cleanup.
- [ ] Vercel development, preview and production contain no legacy provider credentials or rollout flags.
- [ ] The old external credential is revoked only after the final canary.
- [ ] Existing PostgreSQL quotations, revisions, PDFs and public links remain accessible.
- [ ] Production contains no seed or historical backfill introduced by this cutover.
- [ ] Acceptance report contains no secrets or personal data.
- [ ] Task 9 and Task 10 are accurately closed in the progress ledger.
- [ ] Historical branch/worktree cleanup occurs only after explicit approval.
