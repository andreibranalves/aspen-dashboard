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

### Task 1: Fix baseline generation and branch hygiene

**Files:**
- Modify: `package.json` only if test/build workflow requires a minimal generated-output correction.
- Test: `tests/unit/*.test.ts` existing suite.

**Interfaces:**
- Consumes: source TypeScript under `api/`.
- Produces: generated JavaScript required by current unit test imports and documented baseline status.

- [ ] **Step 1: Reproduce baseline failure in the new worktree**

Run:

```bash
npm run test:unit
```

Expected baseline failure: tests importing `api/**/*.js` fail when generated JavaScript is absent.

- [ ] **Step 2: Generate API output**

Run:

```bash
npm run build:api
```

Expected: TypeScript emits JavaScript into the API tree.

- [ ] **Step 3: Verify generated baseline**

Run:

```bash
npm run test:unit
```

Expected: no failed tests; PostgreSQL-dependent tests may remain skipped when `TEST_DATABASE_URL` is absent.

- [ ] **Step 4: Commit only if workflow changes were needed**

```bash
git status --short
git diff -- package.json
```

Do not commit generated build output if repository policy excludes it. Commit only source changes required to make the workflow reproducible.

---

### Task 2: Create route and dependency inventory

**Files:**
- Create: `docs/superpowers/plans/2026-08-05-quotation-route-inventory.md`
- Test: `tests/unit/route-map.test.ts` or existing route-map test location.
- Modify: `api/[...path].ts`, `scripts/app-server.mjs`, `scripts/dev-api-server.mjs` only if the inventory finds drift.

**Interfaces:**
- Consumes: all three route maps and handlers under `api/_functions/`.
- Produces: one table mapping each quotation route to source, auth, storage, Frappe calls, and feature flag.

- [ ] **Step 1: Add failing route-map parity test**

The test must import or parse the three route maps and assert identical route-name sets. Include `quotations`, `quotation-preview`, `quotation-templates`, `orcamento`, `view`, `pdf`, `send-whatsapp`, `sales-order-from-quotation`, `sales-orders`, and `sales-dashboard`.

- [ ] **Step 2: Run the parity test**

```bash
node --test tests/unit/route-map.test.ts
```

Expected: FAIL if maps differ or test cannot observe the maps.

- [ ] **Step 3: Implement the smallest shared/testable route-map seam**

Do not create a framework. Export route-name sets from existing maps or extract one plain object only if that removes duplication. Preserve handler signatures and local server behavior.

- [ ] **Step 4: Write inventory document**

For every route, record:

```text
route | methods | auth | source of truth | Frappe calls | PostgreSQL tables | external side effects | flag | migration status
```

Mark incomplete PDF/document routes explicitly.

- [ ] **Step 5: Verify**

```bash
npm run build:api
node --test tests/unit/route-map.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add api/[...path].ts scripts/app-server.mjs scripts/dev-api-server.mjs tests/unit/route-map.test.ts docs/superpowers/plans/2026-08-05-quotation-route-inventory.md
git commit -m "docs: inventory quotation migration routes"
```

---

### Task 3: Isolate quotation rollout flag and rollback contract

**Files:**
- Modify: `api/_functions/operational-mode.ts`
- Modify: `api/_functions/orcamento-core.ts`
- Modify: `api/_functions/quotations-core.ts`
- Modify: `api/_functions/quotation-preview.ts`
- Modify: `api/_functions/quotation-templates.ts`
- Test: `tests/unit/operational-mode.test.ts` and affected quotation handler tests.

**Interfaces:**
- Consumes: `CRM_CORE_QUOTES_ENABLED`, existing core handlers and repositories.
- Produces: one function `isCoreQuotesEnabled()` that controls only quotation routes and never activates unrelated domains.

- [ ] **Step 1: Write failing flag tests**

Cover:

```text
CRM_CORE_QUOTES_ENABLED=true -> quotation core enabled
CRM_CORE_QUOTES_ENABLED=false/unset -> quotation core disabled
CRM_CORE_QUOTES_ENABLED=invalid -> quotation core disabled
CRM_OPERATIONAL_MODE=true alone -> quotation flag behavior unchanged
```

Also assert a core handler does not call legacy fallback after repository failure.

- [ ] **Step 2: Run tests**

```bash
node --test tests/unit/operational-mode.test.ts tests/unit/*quotation*.test.ts
```

Expected: FAIL for any current global-mode coupling or missing invalid-value behavior.

- [ ] **Step 3: Implement isolated flag**

Keep the existing public flag name if already used. Remove only the coupling that makes `CRM_OPERATIONAL_MODE` an implicit quotation rollout switch. Preserve explicit operational guards for domains that still need them.

- [ ] **Step 4: Add rollback contract test**

Create a PostgreSQL-backed or repository-seam test that writes a quotation while the core flag is enabled, disables the flag, and verifies the application returns a controlled `core data unavailable` state rather than pretending the quotation is absent in Frappe.

- [ ] **Step 5: Verify**

```bash
npm run build:api
node --test tests/unit/operational-mode.test.ts tests/unit/*quotation*.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add api/_functions/operational-mode.ts api/_functions/orcamento-core.ts api/_functions/quotations-core.ts api/_functions/quotation-preview.ts api/_functions/quotation-templates.ts tests/unit
git commit -m "fix: isolate quotation rollout flag"
```

---

### Task 4: Add migration-run manifest and external lineage fields

**Files:**
- Modify: `api/_db/schema.ts`
- Modify: `api/_db/frappe-migration-repository.ts`
- Modify: `api/_functions/lib/frappe-migration-core.ts`
- Modify: `api/_functions/frappe-migration.ts`
- Modify: `scripts/migrate-frappe-crm.mjs`
- Create: `drizzle/<timestamp>_frappe_migration_runs.sql` via project migration workflow.
- Test: `tests/unit/frappe-migration.test.ts`, `tests/unit/frappe-migration-repository.test.ts`.

**Interfaces:**
- Produces: `migration_runs` metadata and lineage fields `migration_run_id`, `source_updated_at`, `imported_at`, `source_hash`, plus deterministic batch status.

- [ ] **Step 1: Write failing manifest tests**

Assert dry-run returns a manifest containing run ID, source timestamp, entity counts, canonical hashes and divergence count without writing destination rows.

- [ ] **Step 2: Run focused tests**

```bash
npm run build:api
node --test tests/unit/frappe-migration*.test.ts
```

Expected: FAIL for missing manifest/run metadata.

- [ ] **Step 3: Add schema migration**

Add a migration-run table with:

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

Add lineage references and timestamps without changing existing public response contracts.

- [ ] **Step 4: Implement dry-run and resumable apply**

Create a run before apply, persist batch outcomes, use existing deterministic IDs and hashes, and make retries no-op for unchanged source records. Never log raw payloads.

- [ ] **Step 5: Verify idempotence**

Run migration fixture twice and assert equal row counts, IDs, hashes and lineage references.

- [ ] **Step 6: Commit**

```bash
git add api/_db api/_functions/frappe-migration.ts scripts/migrate-frappe-crm.mjs tests/unit drizzle
git commit -m "feat: track migration runs and lineage"
```

---

### Task 5: Make prerequisite data migration explicit

**Files:**
- Modify: `api/_functions/frappe-migration.ts`
- Modify: `api/_db/frappe-migration-repository.ts`
- Modify: `api/_db/schema.ts`
- Modify: `scripts/migrate-frappe-crm.mjs`
- Test: `tests/unit/frappe-migration*.test.ts`, `tests/unit/pricing-rollout.test.ts`, `tests/unit/products-quote-mode.test.ts`.

**Interfaces:**
- Consumes: deterministic migration infrastructure from Task 4.
- Produces: validated import order `templates -> products -> prices -> clients/leads -> quotations` and explicit orphan/conflict reports.

- [ ] **Step 1: Add failing dependency-order test**

Assert quotation import refuses to apply when referenced product, client or template is absent unless the record is classified in an approved divergence report.

- [ ] **Step 2: Run focused test**

```bash
node --test tests/unit/frappe-migration*.test.ts tests/unit/pricing-rollout.test.ts tests/unit/products-quote-mode.test.ts
```

- [ ] **Step 3: Implement prerequisite gates**

Use existing repository operations. Do not add a generic migration framework. Make each entity phase report counts, orphans and conflicts. Keep historical original status alongside canonical status.

- [ ] **Step 4: Add status policy tests**

Cover cancelled, lost, ordered, completed and closed source states. Assert canonical mapping and preservation of original status.

- [ ] **Step 5: Verify**

```bash
npm run build:api
node --test tests/unit/frappe-migration*.test.ts tests/unit/pricing-rollout.test.ts tests/unit/products-quote-mode.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add api/_db api/_functions/frappe-migration.ts scripts/migrate-frappe-crm.mjs tests/unit
git commit -m "feat: gate quotation migration on prerequisites"
```

---

### Task 6: Define document and public-link boundary

**Files:**
- Modify: `api/_functions/quotation-preview.ts`
- Modify: `api/_functions/view.ts`
- Modify: `api/_functions/pdf.ts`
- Modify: `api/_functions/lib/quotation-pdf.ts`
- Modify: `api/_functions/lib/quotation-html.ts`
- Modify: `api/_lib/auth.ts`
- Test: `tests/unit/quotation-html.test.js`, `tests/unit/quotation-preview.test.ts`, new `tests/unit/public-quotation-link.test.ts`.

**Interfaces:**
- Produces: explicit policy for generated PDFs and public links. Public links accept only a signed/random token for issued revisions and never expose drafts.

- [ ] **Step 1: Add failing tests**

Cover unauthenticated access with valid public token, invalid token, expired token, draft revision, revoked token, PDF signature and deterministic document metadata.

- [ ] **Step 2: Run focused tests**

```bash
npm run build:api
node --test tests/unit/quotation-html.test.js tests/unit/quotation-preview.test.ts tests/unit/public-quotation-link.test.ts
```

- [ ] **Step 3: Implement minimum boundary**

Keep admin APIs authenticated. Add a narrow public route or token branch only for issued revision documents. Do not expose generic `/api/view` by removing authentication.

- [ ] **Step 4: Verify no Frappe call in PostgreSQL document path**

Inject a fetcher that throws if Frappe base URL is requested. Render HTML/PDF from persisted snapshot and assert no throw.

- [ ] **Step 5: Commit**

```bash
git add api/_functions api/_lib/auth.ts tests/unit
git commit -m "feat: define PostgreSQL quotation documents"
```

---

### Task 7: Add integration outbox seam for external effects

**Files:**
- Modify: `api/_db/schema.ts`
- Create: `api/_db/quotation-outbox-repository.ts`
- Modify: `api/_functions/orcamento-core.ts`
- Modify: `api/_functions/send-whatsapp.ts` only after repository seam exists.
- Test: `tests/unit/quotation-outbox.test.ts`, affected quotation tests.

**Interfaces:**
- Produces: transactional `quotation.created`, `quotation.updated`, `quotation.issued`, and `quotation.sent` events with idempotency keys and retry state.

- [ ] **Step 1: Add failing outbox tests**

Assert quotation persistence and outbox insertion share one transaction; duplicate event key is ignored; failed external delivery leaves retryable state; external failure does not delete saved quotation.

- [ ] **Step 2: Run focused tests**

```bash
node --test tests/unit/quotation-outbox.test.ts
```

- [ ] **Step 3: Implement repository seam**

Use Drizzle transaction already used by quotation repositories. Keep event payload canonical and avoid raw PII. Store attempts, next retry time, last error class and provider message ID.

- [ ] **Step 4: Verify**

```bash
npm run build:api
node --test tests/unit/quotation-outbox.test.ts tests/unit/quotations-core.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add api/_db api/_functions/orcamento-core.ts tests/unit
git commit -m "feat: queue quotation external effects"
```

---

### Task 8: Produce cutover runbook and staging checklist

**Files:**
- Create: `docs/operational-cutoff-procedure.md` update only if existing procedure conflicts with this design.
- Create: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`
- Test: `tests/unit/cutover-checklist.test.ts` if checklist has machine-verifiable invariants.

**Interfaces:**
- Produces: operator procedure for backup, snapshot, dry-run, apply, reconciliation, freeze, canary, rollback and abort.

- [ ] **Step 1: Document preconditions**

Include exact commands for `npm run build:api`, migration dry-run, database backup/restore, manifest verification and test suite. Never include secret values.

- [ ] **Step 2: Document abort conditions**

Abort on duplicate business number, unexplained financial divergence, orphan prerequisite, missing PDF integrity, unexpected Frappe call or failed rollback read.

- [ ] **Step 3: Document rollback behavior**

Rollback must preserve PostgreSQL reads for PostgreSQL-created records. It must not merely set the flag false. Include operator decision for keeping the core flag on in read mode or restoring a compatible deployment.

- [ ] **Step 4: Verify docs**

```bash
rg -n "TBD|TODO|placeholder|QUOTATIONS_POSTGRES_ENABLED" docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md docs/superpowers/specs/2026-08-05-migracao-gradual-sem-frappe-design.md
```

Expected: no placeholders and no obsolete flag name.

- [ ] **Step 5: Commit**

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

Run PostgreSQL-backed tests with `TEST_DATABASE_URL` configured. Run the affected Playwright suites against a staging deployment with Frappe calls blocked and verify the full route inventory.
