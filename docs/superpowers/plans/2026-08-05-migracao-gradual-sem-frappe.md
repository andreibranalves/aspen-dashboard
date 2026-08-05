# Migração gradual sem Frappe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preparar fundação segura para migrar o domínio de orçamentos de Frappe/ERPNext para PostgreSQL sem perda de dados, fallback silencioso ou rollback inseguro.

**Architecture:** PostgreSQL será fonte futura do domínio de orçamentos. A migração será executada por snapshot e lotes idempotentes, com lineage e reconciliação. O rollout usará `CRM_CORE_QUOTES_ENABLED` isoladamente; integrações externas permanecerão atrás de adaptadores até substituição testada.

**Tech Stack:** Node.js ESM, TypeScript, PostgreSQL, Drizzle ORM, Vercel serverless, React/Vite, Node test runner, Playwright.

## Global Constraints

- Não adicionar dependências.
- Não remover Frappe de nenhum fluxo sem substituto funcional e teste.
- Não usar `CRM_OPERATIONAL_MODE` para rollout isolado de orçamentos.
- Não fazer fallback silencioso de PostgreSQL para Frappe após erro.
- Não imprimir tokens, credenciais ou payloads com PII em logs.
- Manter mapas de rotas sincronizados em `api/[...path].ts`, `scripts/app-server.mjs` e `scripts/dev-api-server.mjs`.
- Rodar `npm run build:api`, `npm run test:unit` e checks afetados após cada tarefa.

---

### Task 1: Make the test baseline reproducible

**Files:**
- Modify: `package.json` test scripts only if required to build API output before tests.
- Modify: `scripts/` only if test setup requires one existing setup entrypoint.
- Test: `tests/unit/*.test.{js,ts}` existing suite.

**Interfaces:**
- Consumes: source TypeScript under `api/`.
- Produces: a clean-checkout test command that generates or loads required API output deterministically.

- [ ] **Step 1: Reproduce the clean-checkout failure**

From a fresh worktree with no generated API JavaScript, run:

```bash
npm run test:unit
```

Expected current failure: imports such as `api/_functions/pricing.js` are missing.

- [ ] **Step 2: Choose the smallest reproducible fix**

Prefer changing `test:unit` to run `npm run build:api && TZ=UTC node --test tests/unit/*.test.{js,ts}` if generated JavaScript is required by repository tests. Do not commit generated output merely to mask the missing setup step.

- [ ] **Step 3: Add a regression check**

Run the test command from a clean worktree copy and assert it performs the API build before Node starts tests.

- [ ] **Step 4: Verify**

```bash
npm run test:unit
```

Expected: 0 failed tests. PostgreSQL tests may be skipped only when `TEST_DATABASE_URL` is absent.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts tests
 git commit -m "test: make unit baseline reproducible"
```

---

### Task 2: Inventory quotation routes and dependencies

**Files:**
- Create: `docs/superpowers/plans/2026-08-05-quotation-route-inventory.md`
- Create: `tests/unit/route-map.test.ts`
- Modify: `api/[...path].ts`, `scripts/app-server.mjs`, `scripts/dev-api-server.mjs` only if parity fails.

**Interfaces:**
- Consumes: all three route maps and handlers under `api/_functions/`.
- Produces: one route-name parity test and one inventory table mapping route, methods, auth, source, Frappe calls, PostgreSQL tables, side effects, flag and status.

- [ ] **Step 1: Add the parity test**

Expose or parse each existing route map without changing handler behavior. Assert equal route-name sets, not object insertion order. Include at least:

```text
quotations
quotation-preview
quotation-templates
orcamento
view
pdf
send-whatsapp
sales-order-from-quotation
sales-orders
sales-dashboard
```

- [ ] **Step 2: Run the test**

```bash
npm run build:api
node --test tests/unit/route-map.test.ts
```

Expected: PASS if the current 40 route names match; failure must identify the differing set.

- [ ] **Step 3: Write the inventory**

Record for every quotation-related route:

```text
route | methods | auth | source of truth | Frappe calls | PostgreSQL tables | external side effects | flag | migration status
```

Mark `view`, `pdf`, WhatsApp and Sales Order routes as legacy until their replacement tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/route-map.test.ts docs/superpowers/plans/2026-08-05-quotation-route-inventory.md api/[...path].ts scripts/app-server.mjs scripts/dev-api-server.mjs
git commit -m "docs: inventory quotation migration routes"
```

---

### Task 3: Isolate quotation flag and define rollout states

**Files:**
- Modify: `api/_functions/orcamento-mode.ts`
- Modify: `api/_functions/operational-mode.ts` only where the shared guard incorrectly couples quotes.
- Modify: `api/_functions/orcamento-core.ts`, `api/_functions/quotations-core.ts`, `api/_functions/quotation-preview.ts`, `api/_functions/quotation-templates.ts`.
- Test: `tests/unit/operational-mode.test.ts` and affected quotation tests.

**Interfaces:**
- Produces: `isCoreQuotesEnabled()` controlled only by `CRM_CORE_QUOTES_ENABLED`, plus explicit rollout-state handling for `legacy`, `postgres-write`, `postgres-read-only` and `rollback-compatible`.

- [ ] **Step 1: Write failing flag tests**

Cover:

```text
CRM_CORE_QUOTES_ENABLED=true -> postgres-write selection
CRM_CORE_QUOTES_ENABLED=false/unset -> legacy selection
CRM_CORE_QUOTES_ENABLED=invalid -> legacy selection
CRM_OPERATIONAL_MODE=true alone -> no quotation override
```

Assert a repository failure never silently invokes Frappe fallback.

- [ ] **Step 2: Run focused tests**

```bash
npm run build:api
node --test tests/unit/operational-mode.test.ts tests/unit/*quotation*.test.ts
```

Expected: FAIL while the current `CRM_OPERATIONAL_MODE` override remains.

- [ ] **Step 3: Implement the isolated flag**

Remove only quote coupling from `CRM_OPERATIONAL_MODE`. Preserve operational guards for still-legacy domains. Use explicit response/error behavior for `postgres-read-only` and `rollback-compatible`, rather than pretending PostgreSQL records do not exist in Frappe.

- [ ] **Step 4: Add the rollback contract test**

Using a repository seam or PostgreSQL test database, create a PostgreSQL quotation, switch to rollback-compatible state, and verify its detail remains readable. Verify legacy records retain their documented path.

- [ ] **Step 5: Verify and commit**

```bash
npm run build:api
node --test tests/unit/operational-mode.test.ts tests/unit/*quotation*.test.ts
git add api/_functions tests/unit
git commit -m "fix: isolate quotation rollout flag"
```

---

### Task 4: Add persisted migration runs, batches and complete lineage

**Files:**
- Modify: `api/_db/schema.ts`
- Modify: `api/_db/frappe-migration-repository.ts`
- Modify: `api/_functions/lib/frappe-migration-core.ts`
- Modify: `api/_functions/frappe-migration.ts`
- Modify: `scripts/migrate-frappe-crm.mjs`
- Create: `drizzle/<timestamp>_frappe_migration_runs.sql` via project migration workflow.
- Test: `tests/unit/frappe-migration.test.ts`, `tests/unit/frappe-migration-repository.test.ts`.

**Interfaces:**
- Produces: persisted `migration_runs`, batch checkpoints and lineage fields `provider`, `entity_type`, `source_id`, `local_id`, `business_number`, `migration_run_id`, `source_updated_at`, `imported_at`, `source_hash`.

- [ ] **Step 1: Write failing manifest tests**

Assert dry-run returns a manifest with run ID, source snapshot timestamp, entity counts, canonical hashes and approved/blocking divergence counts without writing destination rows.

- [ ] **Step 2: Add the schema migration**

Create a migration-run table with:

```text
id UUID primary key
provider text not null
mode text not null
source_snapshot_at timestamptz not null
manifest_hash text not null
status text not null
started_at timestamptz not null
completed_at timestamptz nullable
```

Add batch state sufficient for `pending`, `running`, `completed`, `failed`, checkpoint and attempt count. Add lineage references to the run and preserve existing uniqueness constraints.

- [ ] **Step 3: Define PII policy in code and docs**

Restrict raw `legacy_payload` to authorized operational reads, exclude it from logs/reports, and record retention policy before production apply. Tests must assert migration output does not serialize raw payloads in summary responses.

- [ ] **Step 4: Implement dry-run, apply and resume**

Create a run before apply, persist batch outcomes, use deterministic IDs/hashes, and make retries no-op for unchanged source records. Return non-zero from `scripts/migrate-frappe-crm.mjs` on blocking errors, failed batches or unmet prerequisites.

- [ ] **Step 5: Verify idempotence**

Run the same fixture twice and assert equal row counts, IDs, hashes, lineage references and completed batch states.

- [ ] **Step 6: Commit**

```bash
git add api/_db api/_functions/frappe-migration.ts scripts/migrate-frappe-crm.mjs tests/unit drizzle
git commit -m "feat: track migration runs and lineage"
```

---

### Task 5: Seed templates and gate prerequisite data migration

**Files:**
- Modify: `api/_db/schema.ts`
- Modify: `api/_db/frappe-migration-repository.ts`
- Modify: `api/_functions/frappe-migration.ts`
- Modify: `api/_functions/lib/frappe-migration-core.ts`
- Modify: `scripts/migrate-frappe-crm.mjs`
- Test: `tests/unit/frappe-migration*.test.ts`, `tests/unit/quotation-template*.test.*`, `tests/unit/pricing-rollout.test.ts`, `tests/unit/products-quote-mode.test.ts`.

**Interfaces:**
- Consumes: Task 4 run/lineage infrastructure.
- Produces: validated order `templates -> products -> prices -> clients/leads -> quotations` and explicit orphan/conflict reports.

- [ ] **Step 1: Add template integrity test**

Assert every expected built-in template and current version exists before an imported quotation can be applied. Assert missing template version blocks apply.

- [ ] **Step 2: Add dependency-order tests**

Assert quotation apply refuses missing product, client or template references unless the record is classified in an approved divergence report.

- [ ] **Step 3: Define status policy test**

Cover `draft`, `open`, `sent`, `lost`, `cancelled`, `ordered`, `completed` and `closed`. Assert canonical status, original status and order linkage/pending marker.

- [ ] **Step 4: Implement gates**

Seed built-in PostgreSQL templates using the existing template library/repository. Do not add templates to the Frappe dataset unless the source system actually owns them. Make each entity phase report counts, approved divergences and blocking divergences.

- [ ] **Step 5: Block invalid apply**

Before writes, reject any blocking divergence, missing prerequisite or unsupported status mapping. Continue only with explicitly approved divergence records.

- [ ] **Step 6: Verify and commit**

```bash
npm run build:api
node --test tests/unit/frappe-migration*.test.ts tests/unit/quotation-template*.test.* tests/unit/pricing-rollout.test.ts tests/unit/products-quote-mode.test.ts
git add api/_db api/_functions/frappe-migration.ts api/_functions/lib/frappe-migration-core.ts scripts/migrate-frappe-crm.mjs tests/unit
git commit -m "feat: gate quotation migration on prerequisites"
```

---

### Task 6: Define PostgreSQL document and public-link boundary

**Files:**
- Create: `api/_functions/public-quotation.ts` or equivalent narrow handler.
- Modify: `api/[...path].ts`, `scripts/app-server.mjs`, `scripts/dev-api-server.mjs` to register the new route identically.
- Modify: `api/_functions/quotation-preview.ts`
- Modify: `api/_functions/lib/quotation-pdf.ts`
- Modify: `api/_functions/lib/quotation-html.ts` only if shared renderer can accept canonical PostgreSQL snapshots without legacy fetch.
- Modify: `api/_lib/auth.ts` only to keep admin `view` protected and allow the narrow public route.
- Test: new `tests/unit/public-quotation.test.ts`, affected `tests/unit/quotation-html.test.js` and preview tests.

**Interfaces:**
- Produces: authenticated admin document path and a public token path limited to issued revisions, with expiration, revocation, rate limit and deterministic document metadata.

- [ ] **Step 1: Write failing tests**

Cover valid unauthenticated token, invalid token, expired token, revoked token, draft revision rejection, PDF signature, checksum/metadata and rejection when the renderer tries to call Frappe.

- [ ] **Step 2: Implement token storage and route boundary**

Store only a hash or signed material sufficient for validation, bind token to revision, store expiration/revocation, and return only allowed public fields. Do not make generic `/api/view` public.

- [ ] **Step 3: Implement PostgreSQL renderer path**

Render from immutable revision snapshot and versioned template. Persist or return document metadata according to the existing storage contract. Choose and document policy for historical PDFs before cutover.

- [ ] **Step 4: Verify route parity and no Frappe access**

```bash
npm run build:api
node --test tests/unit/public-quotation.test.ts tests/unit/route-map.test.ts tests/unit/quotation-html.test.js
```

Use an injected fetcher that throws on Frappe URLs.

- [ ] **Step 5: Commit**

```bash
git add api/_functions api/_lib/auth.ts api/[...path].ts scripts/app-server.mjs scripts/dev-api-server.mjs tests/unit
git commit -m "feat: define PostgreSQL quotation documents"
```

---

### Task 7: Add transactional outbox producer and worker contract

**Files:**
- Modify: `api/_db/schema.ts`
- Create: `api/_db/quotation-outbox-repository.ts`
- Create: `api/_functions/quotation-outbox-worker.ts` or a CLI worker entrypoint suitable for deployment.
- Modify: `api/_functions/orcamento-core.ts`
- Modify: `api/_functions/send-whatsapp.ts` only after PostgreSQL document path exists.
- Test: `tests/unit/quotation-outbox.test.ts`, affected quotation and WhatsApp tests.

**Interfaces:**
- Produces: transactional `quotation.created`, `quotation.updated`, `quotation.issued`, and `quotation.sent` events with idempotency keys, lease, retry/backoff and dead-letter state.

- [ ] **Step 1: Write failing producer/worker tests**

Assert quotation persistence and outbox insertion share one transaction; duplicate event key is ignored; lease prevents concurrent processing; failed delivery increments attempts and schedules backoff; exhausted delivery becomes dead-letter; external failure never deletes saved quotation.

- [ ] **Step 2: Add outbox schema and repository**

Store event type, aggregate ID, canonical payload reference, idempotency key, status, attempts, lease owner/expiry, next retry time, last error class and provider message ID. Avoid raw PII in event payloads.

- [ ] **Step 3: Implement worker contract**

Claim due events with lease, invoke one provider adapter, persist success or retry state, and release/expire lease safely. Define provider adapter boundaries for N8N, Evolution and CRM.

- [ ] **Step 4: Integrate quotation persistence**

Insert `quotation.created`/`quotation.updated` in the same transaction as the aggregate. Emit `quotation.issued` only after document emission succeeds. Emit `quotation.sent` only after provider accepts the send request.

- [ ] **Step 5: Verify and commit**

```bash
npm run build:api
node --test tests/unit/quotation-outbox.test.ts tests/unit/quotations-core.test.ts
git add api/_db api/_functions tests/unit
git commit -m "feat: queue quotation external effects"
```

---

### Task 8: Write executable cutover and rollback runbook

**Files:**
- Modify: `docs/operational-cutoff-procedure.md` to remove conflicts with the new state machine.
- Create: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`
- Test: `tests/unit/cutover-checklist.test.ts` only for machine-verifiable invariants.

**Interfaces:**
- Produces: operator procedure for backup, snapshot, dry-run, apply, reconciliation, freeze, delta, canary, abort and rollback.

- [ ] **Step 1: Document exact preconditions**

Include commands for:

```bash
npm run build:api
npm run test:unit
npm run lint
npm run type-check
npm run build
```

Document database backup/restore, staging `TEST_DATABASE_URL`, migration dry-run, manifest verification and Frappe call blocking. Never include secret values.

- [ ] **Step 2: Document abort conditions**

Abort on duplicate business number, unexplained financial divergence, orphan prerequisite, missing PDF integrity, unexpected Frappe call, failed batch, failed external-link security test or failed rollback read.

- [ ] **Step 3: Document state transitions**

Specify operator actions and allowed reads/writes for `legacy`, `postgres-write`, `postgres-read-only` and `rollback-compatible`. Explicitly state that setting a flag false is not sufficient rollback after PostgreSQL writes.

- [ ] **Step 4: Document historical PDF and status policy**

Record the selected historical-PDF policy, status mapping table, order linkage behavior and retention policy for raw lineage payloads before production apply.

- [ ] **Step 5: Verify docs**

Run a marker scan that excludes its own instructions and assert no incomplete marker remains in the prose.

- [ ] **Step 6: Commit**

```bash
git add docs
git commit -m "docs: define quotation cutover runbook"
```

---

## Final verification

Run from the worktree:

```bash
npm run build:api
npm run lint
npm run type-check
npm run check:tailwind
npm run test:unit
npm run build
```

Run PostgreSQL-backed tests with `TEST_DATABASE_URL` configured. Run affected Playwright suites against staging with Frappe calls blocked. Verify all route maps, migration manifests, public-link security, document integrity, outbox retry behavior and rollback reads before declaring the first subphase ready.
