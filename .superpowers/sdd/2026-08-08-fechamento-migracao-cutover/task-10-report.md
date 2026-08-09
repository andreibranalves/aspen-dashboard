# Task 10 implementation report
Status: DONE_WITH_CONCERNS.
## Changes
- Canonicalized persisted PostgreSQL pricing decimals before product idempotency comparison.
- PostgreSQL numeric values such as `30.000` now compare equal to normalized source values such as `30`.
- Exported the existing decimal canonicalizer instead of adding a second numeric parser.
- Updated PostgreSQL migration coverage for the current on-demand PDF policy with no historical-document row.
- Updated lifecycle coverage so new drafts remain `rascunho`, then seeds the issued boundary before testing approved transition and immutable revision copying.
- Refreshed quotation-management concurrency tokens after successful updates while retaining an explicit stale-token assertion.
- Serialized the documented PostgreSQL integration command with `--test-concurrency=1`.
## Validation
- `npm run build:api` passed.
- `npm run type-check` passed.
- `npm run build` passed.
- `node --test --import tsx tests/unit/frappe-migration.test.ts tests/unit/frappe-migration-repository.test.ts`: 89 passed.
- Explicit staging command `env -u TEST_DATABASE_URL TEST_DATABASE_URL="$STAGING_DATABASE_URL" DATABASE_URL="$STAGING_DATABASE_URL" node --test --test-concurrency=1 --import tsx tests/unit/frappe-migration-postgres.test.ts tests/unit/quotations-postgres.test.ts tests/unit/quotation-lifecycle-postgres.test.ts`: 7 passed.
- `node --test --import tsx tests/unit/backup-crm.test.ts tests/unit/backup.test.ts tests/unit/cutover-checklist.test.ts`: 21 passed, 3 expected integration skips.
- `npm run test:unit`: 646 passed, 13 skipped.
- `npm run lint`: 0 errors, 199 pre-existing warnings.
- `git diff --check` passed.
## Scope and risks
- No backup script change was required after existing command and identity tests passed.
- No real Frappe source read, migration CLI apply, deployment, canary, or rollback was executed.
- Backup integration tests remain skipped when database environment variables are absent from the unit-test process.
- Real staging Playwright, firewall evidence, and operational migration apply remain separate gated steps.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The smallest verified changes fix PostgreSQL numeric-scale idempotency, align stale tests with the current no-historical-PDF and draft lifecycle contracts, refresh only stale test tokens, and serialize shared staging integration execution."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Fresh unit, explicit staging PostgreSQL, backup, type-check, build, lint, full-unit, and diff checks are recorded above with pass/skip counts."
    }
  ],
  "changedFiles": [
    "api/_functions/frappe-migration.ts",
    "api/_functions/lib/frappe-migration-core.ts",
    "docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md",
    "tests/unit/frappe-migration-postgres.test.ts",
    "tests/unit/quotation-lifecycle-postgres.test.ts",
    "tests/unit/quotations-postgres.test.ts"
  ],
  "testsAddedOrUpdated": [
    "tests/unit/frappe-migration-postgres.test.ts",
    "tests/unit/quotation-lifecycle-postgres.test.ts",
    "tests/unit/quotations-postgres.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npm run build:api",
      "result": "passed",
      "summary": "API TypeScript build passed."
    },
    {
      "command": "node --test --import tsx tests/unit/frappe-migration.test.ts tests/unit/frappe-migration-repository.test.ts",
      "result": "passed",
      "summary": "89 passed."
    },
    {
      "command": "env -u TEST_DATABASE_URL TEST_DATABASE_URL=STAGING_DATABASE_URL DATABASE_URL=STAGING_DATABASE_URL node --test --test-concurrency=1 --import tsx tests/unit/frappe-migration-postgres.test.ts tests/unit/quotations-postgres.test.ts tests/unit/quotation-lifecycle-postgres.test.ts",
      "result": "passed",
      "summary": "7 staging PostgreSQL integration tests passed serially."
    },
    {
      "command": "node --test --import tsx tests/unit/backup-crm.test.ts tests/unit/backup.test.ts tests/unit/cutover-checklist.test.ts",
      "result": "passed",
      "summary": "21 passed and 3 expected database integration tests skipped without injected database variables."
    },
    {
      "command": "npm run type-check && npm run build && npm run lint && npm run test:unit && git diff --check",
      "result": "passed",
      "summary": "Type-check, production build, lint, 646 full unit tests, and whitespace check passed; lint reported 199 existing warnings and full unit suite skipped 13 database tests without injected variables."
    }
  ],
  "validationOutput": [
    "The staging rerun now reports the product and pricing tier as ignored despite PostgreSQL numeric scale formatting.",
    "The lifecycle test validates draft, issued boundary, approved transition, and revision snapshot copy.",
    "The documented staging command prevents shared PostgreSQL fixture races through serial test concurrency."
  ],
  "residualRisks": [
    "Real Frappe apply remains intentionally gated and unexecuted.",
    "Database-dependent backup unit cases remain skipped unless their explicit database variables are injected."
  ],
  "noStagedFiles": true,
  "diffSummary": "Canonical PostgreSQL pricing comparison and deterministic staging integration tests with current document, lifecycle, and concurrency assertions.",
  "reviewFindings": [],
  "manualNotes": "No secrets, raw Frappe payloads, PII, dependencies, deployment, canary, rollback, or real Frappe reads were used."
}
```
## Fix Round 1 report
Status: DONE_WITH_CONCERNS.
### Findings addressed
- Added protected external `CUTOVER_BACKUP_DIR`/`BACKUP_DIR` support while preserving the ignored checkout-local default for local use.
- Backup and preflight now enforce directory mode `0700` and dump mode `0600`.
- Updated the runbook with fail-closed `pg_dump`, `psql`, and `jq` version gates, explicit staging preflight, external backup destination, path checks, and mode checks.
- Added `scripts/reconcile-migration.mjs` as an executable persisted reconciliation artifact.
- Reconciliation compares dry-run/apply/persisted manifest hashes, source-read/imported counts, target aggregate counts, status totals, canonical lineage/revision hashes, lineage validity, blocking count, and approved divergence keys.
- Reconciliation writes only sanitized counts, statuses, hashes, and opaque approval references outside the checkout, then fails closed on mismatch.
- Strengthened the PostgreSQL no-PDF test with failing fetch/render hooks, call counters, zero blob writes, and conditional `issued_documents` row absence using `to_regclass` without assuming the table exists.
- Scoped retained historical PDF tests as Memory-only legacy pipeline coverage.
- Added canonical decimal edge coverage and pure reconciliation pass/fail coverage.
### Fresh validation
- `node --test --import tsx tests/unit/backup-crm.test.ts tests/unit/reconcile-migration.test.ts tests/unit/cutover-checklist.test.ts`: 15 passed.
- Explicit staging command `env -u TEST_DATABASE_URL TEST_DATABASE_URL="$STAGING_DATABASE_URL" DATABASE_URL="$STAGING_DATABASE_URL" node --test --test-concurrency=1 --import tsx tests/unit/frappe-migration-postgres.test.ts tests/unit/quotations-postgres.test.ts tests/unit/quotation-lifecycle-postgres.test.ts`: 7 passed.
- Explicit staging backup suite `env -u DATABASE_URL TEST_DATABASE_URL="$STAGING_DATABASE_URL" node --test --import tsx tests/unit/backup-crm.test.ts tests/unit/backup.test.ts tests/unit/cutover-checklist.test.ts`: 25 passed, including dump, preflight, and restore guard integration checks.
- `node scripts/backup-crm.mjs --preflight` against staging: capacity passed with database 8.96 MB, 12 active connections, 7459.88 MB destination space, and one retained backup.
- External staging backup passed with dump mode `0600`, destination mode `0700`, and 190957 bytes.
- External `RESTORE_DATABASE_URL` validation passed with products 5, clients 24, quotations 4, revisions 7, revision items 7, and lineage 33.
- Synthetic isolated restore probe passed with count 1 in a temporary transaction table.
- `npm run type-check && npm run build:api && npm run build && npm run lint && npm run test:unit && git diff --check`: passed; full unit suite 650 passed and 13 skipped, lint 0 errors with 199 existing warnings.
### Residual risks
- Reconciliation itself was not run against a real apply report because real Frappe source reads and CLI apply remain explicitly prohibited.
- Production migration, deployment, canary, rollback, and external provider delivery remain gated.
- The restored database was an isolated target and was not used for production traffic.
```acceptance-report
{
  "criteriaSatisfied": [
    {"id":"criterion-1","status":"satisfied","evidence":"All blocker, high, and concrete medium findings were addressed with protected backup gates, executable reconciliation, stronger PDF checks, and focused decimal coverage."},
    {"id":"criterion-2","status":"satisfied","evidence":"Fresh staging integration, backup/restore, unit, build, type, lint, and diff commands passed with exact counts recorded above."}
  ],
  "changedFiles": [
    "docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md",
    "scripts/backup-crm.mjs",
    "scripts/reconcile-migration.mjs",
    "tests/unit/backup-crm.test.ts",
    "tests/unit/reconcile-migration.test.ts",
    "tests/unit/frappe-migration.test.ts",
    "tests/unit/frappe-migration-postgres.test.ts"
  ],
  "testsAddedOrUpdated": [
    "tests/unit/backup-crm.test.ts",
    "tests/unit/reconcile-migration.test.ts",
    "tests/unit/frappe-migration.test.ts",
    "tests/unit/frappe-migration-postgres.test.ts"
  ],
  "commandsRun": [
    {"command":"explicit staging backup/restore suite","result":"passed","summary":"25 passed"},
    {"command":"explicit staging PostgreSQL integration suite","result":"passed","summary":"7 passed serially"},
    {"command":"npm run type-check && npm run build:api && npm run build && npm run lint && npm run test:unit && git diff --check","result":"passed","summary":"650 passed, 13 skipped; 0 lint errors; 199 existing warnings"}
  ],
  "validationOutput":["External dump mode 0600, destination mode 0700, restore counts verified, synthetic restore probe count 1."],
  "residualRisks":["Reconciliation awaits an approved real apply report; production apply/deploy/canary/rollback remain gated."],
  "noStagedFiles":true,
  "diffSummary":"Fail-closed backup/preflight controls and persisted sanitized migration reconciliation with strengthened PostgreSQL PDF and decimal coverage.",
  "reviewFindings":[],
  "manualNotes":"No real Frappe source read or CLI apply executed."
}
```

## Focused completion lane report

Status: IMPLEMENTED.

- Reconciliation expectations now persist only opaque source-derived row identities and hashes.
- Product, client, quotation, revision, item, template-version, sections-snapshot, pricing, lineage and status projections compare target values without serializing PII.
- Revision template joins compare exact template key, source hash, version and sections snapshot hash.
- Actual target statuses are compared against per-source allowed statuses, including the explicit safe draft append outcome.
- Approved divergence candidates remain in source expectations; only their explicitly approved opaque keys are excluded from target projection comparison when required.
- Direct backup and preflight execution now require the named staging service, protected service files and expected database identity.
- Closure-plan migration, dry-run, PostgreSQL test and restore commands keep target variables in the same process scope and assert the named service before work.

Validation for this lane:

- `npm run type-check`: passed.
- `npm run build:api`: passed.
- `node --test --import tsx tests/unit/frappe-migration.test.ts tests/unit/reconcile-migration.test.ts tests/unit/backup-crm.test.ts`: passed, 80 tests.
- `node --test --import tsx tests/unit/reconcile-migration.test.ts tests/unit/backup-crm.test.ts tests/unit/migrate-frappe-cli.test.ts tests/unit/cutover-checklist.test.ts`: passed, 34 tests.
- `npm run test:unit`: passed, 657 tests and 13 expected skips.
- `node --check scripts/reconcile-migration.mjs && node --check scripts/backup-crm.mjs`: passed.
- `git diff --check`: passed.
- Temporary PostgreSQL client tools were unavailable after the workstation crash, so staging PostgreSQL tests and live reconciliation were not rerun in this lane.

## Fix Round 2 report

Status: DONE_WITH_CONCERNS.

### Findings addressed

- Pinned every documented Task 10 migration, dry-run, delta, apply, backup, preflight and reconciliation command to `STAGING_DATABASE_URL` with inherited `DATABASE_URL` and `TEST_DATABASE_URL` removed.
- Added `CUTOVER_EXPECTED_DATABASE=aspen_test` checks to the named service contract and reconciliation CLI.
- Added focused service-contract coverage for an unexpected database identity.
- Required `RESTORE_PG_SERVICE` and `RESTORE_EXPECTED_DATABASE=aspen_restore` in the documented restore flow.
- Made backup restore validation compare the URL target with the named service target and verify `current_database` through the named service.
- Sanitized child-process errors in `backup-crm.mjs` and cleared inherited libpq target variables before PostgreSQL subprocesses.
- Hardened backup and reconciliation artifact directories against symlinks resolving into the checkout.
- Added source-derived `MigrationManifest.reconciliation` expectations for importable products, pricing documents, normalized pricing tiers, clients, quotations, revisions, items, templates and template versions.
- Added deterministic canonical hashes and status distributions to the manifest.
- Reconciliation now compares exact run-scoped lineage, pricing, revision, item, template and status expectations rather than whole-database lower bounds.
- Reconciliation proves imported product, client and quotation identities, pricing attachment, template-version and sections-snapshot presence, and rejects invalid or extra run lineage rows.
- Approved divergence keys may be empty in dry-run and non-empty in apply when every key has an approved apply detail.
- Added report checksum verification before reconciliation.
- Repeated no-PDF row, fetch, render and blob assertions on rerun.
- Updated the cutover checklist and closure plan for the explicit staging and restore contracts.

### Validation

- `npm run build:api`: passed.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npx drizzle-kit check`: passed.
- Focused migration, reconciliation, backup, CLI and checklist tests: 95 passed.
- `node --test --import tsx tests/unit/backup-crm.test.ts tests/unit/backup.test.ts tests/unit/cutover-checklist.test.ts` without database variables: 23 passed, 3 expected database-tool skips.
- Explicit serial staging PostgreSQL command: 7 passed.
- `npm run test:unit`: 653 passed, 13 skipped.
- `npm run lint`: 0 errors, 199 pre-existing warnings.
- `git diff --check`: passed.

### Operational evidence and residual gates

- The previous round's protected staging backup, isolated restore and synthetic restore evidence remains recorded above.
- The temporary PostgreSQL client directory was unavailable after the workstation crash, so database-dependent backup tests were not rerun in this round.
- The reconciliation CLI was not run against a real apply report because real Frappe reads and CLI apply remain explicitly prohibited.
- No real Frappe source read, production apply, deployment, canary, rollback or provider delivery was executed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Task 10 staging and restore targets are explicit and fail closed; reconciliation expectations are source-derived and compared against this apply run; approval, path, checksum, PDF and subprocess hardening gaps are covered."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Focused tests, serial staging PostgreSQL tests, full unit tests, build, type-check, schema check, lint and diff checks passed; real Frappe apply and live reconciliation remain honestly gated."
    }
  ],
  "changedFiles": [
    "api/_functions/frappe-migration.ts",
    "api/_functions/lib/frappe-migration-core.ts",
    "docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md",
    "docs/superpowers/plans/2026-08-08-fechamento-migracao-cutover.md",
    "scripts/backup-crm.mjs",
    "scripts/migrate-frappe-crm.mjs",
    "scripts/reconcile-migration.mjs",
    "tests/unit/backup-crm.test.ts",
    "tests/unit/cutover-checklist.test.ts",
    "tests/unit/frappe-migration-postgres.test.ts",
    "tests/unit/frappe-migration.test.ts",
    "tests/unit/migrate-frappe-cli.test.ts",
    "tests/unit/reconcile-migration.test.ts"
  ],
  "testsAddedOrUpdated": [
    "tests/unit/backup-crm.test.ts",
    "tests/unit/cutover-checklist.test.ts",
    "tests/unit/frappe-migration-postgres.test.ts",
    "tests/unit/frappe-migration.test.ts",
    "tests/unit/migrate-frappe-cli.test.ts",
    "tests/unit/reconcile-migration.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npm run build:api && npm run type-check && npm run build",
      "result": "passed",
      "summary": "API build, type-check and production build passed."
    },
    {
      "command": "npx drizzle-kit check",
      "result": "passed",
      "summary": "Drizzle schema check passed."
    },
    {
      "command": "node --test --import tsx tests/unit/frappe-migration.test.ts tests/unit/reconcile-migration.test.ts tests/unit/backup-crm.test.ts tests/unit/cutover-checklist.test.ts tests/unit/migrate-frappe-cli.test.ts",
      "result": "passed",
      "summary": "95 focused tests passed."
    },
    {
      "command": "env -u DATABASE_URL -u TEST_DATABASE_URL TEST_DATABASE_URL=STAGING_DATABASE_URL DATABASE_URL=STAGING_DATABASE_URL node --test --test-concurrency=1 --import tsx tests/unit/frappe-migration-postgres.test.ts tests/unit/quotations-postgres.test.ts tests/unit/quotation-lifecycle-postgres.test.ts",
      "result": "passed",
      "summary": "7 explicit staging PostgreSQL tests passed serially."
    },
    {
      "command": "npm run test:unit",
      "result": "passed",
      "summary": "653 passed and 13 expected database-dependent skips."
    },
    {
      "command": "npm run lint && git diff --check",
      "result": "passed",
      "summary": "0 lint errors, 199 existing warnings and no whitespace errors."
    },
    {
      "command": "env -u DATABASE_URL -u TEST_DATABASE_URL node --test --import tsx tests/unit/backup-crm.test.ts tests/unit/backup.test.ts tests/unit/cutover-checklist.test.ts",
      "result": "passed",
      "summary": "23 passed and 3 database-tool tests skipped because temporary pg clients were unavailable after crash."
    }
  ],
  "validationOutput": [
    "Source and apply manifests now carry identical deterministic reconciliation expectations.",
    "Pure reconciliation tests cover empty dry-run approvals followed by explicit apply approvals and reject unapproved divergences.",
    "Runbook commands remove inherited database targets and assert aspen_test or aspen_restore identities.",
    "Reconciliation artifacts remain sanitized and require 0600 files in a 0700 directory outside the checkout."
  ],
  "residualRisks": [
    "Live reconciliation against a real apply report remains gated because no real Frappe read or CLI apply was authorized.",
    "Database-dependent backup dump, preflight and restore tests require the temporary PostgreSQL client tools to be provisioned again.",
    "Staging Playwright, egress evidence, canary and rollback remain unexecuted operational gates."
  ],
  "noStagedFiles": true,
  "diffSummary": "Fix Round 2 pins staging and restore identities, adds source-derived exact reconciliation counts/hashes, and closes approval, symlink, checksum, no-PDF and subprocess-safety gaps.",
  "reviewFindings": [
    "review gate pending independent inspection of the source-derived reconciliation SQL and live staging artifact"
  ],
  "manualNotes": "No real Frappe source read or CLI apply was executed. Commit f85c3a9 is ready for independent review."
}
```

## Fix Round 3

Status: DONE_WITH_CONCERNS.

### Findings addressed

- Removed `TEST_DATABASE_URL` from CLI, migration, backup, preflight and reconciliation command blocks that use `DATABASE_URL`.
- Kept `TEST_DATABASE_URL` only for PostgreSQL test commands, avoiding the equal-target guard failure.
- Enforced named staging service mapping and live database identity in backup/preflight when `CUTOVER_PG_SERVICE` is configured.
- Required named restore service, expected `aspen_restore`, mapped URL identity, `current_database()`, and optional active production identity rejection.
- Added exclusive no-follow backup writes and reconciliation artifact temporary paths.
- Reconciliation now selects final rows by sanitized source lineage keys and source hashes instead of only current migration run ID.
- Reconciliation compares actual product, pricing, client, quotation, latest revision, item and template projections with source-derived hashes.
- Reconciliation models only writable expectations and accepts apply-only approved divergence keys when details are explicitly approved.
- Added exact status rows, template-version and sections-snapshot checks, immutable revision status normalization for append runs, and checksum verification before restore.
- Updated closure plan and runbook target examples.

### Validation

- `npm run build:api`: passed.
- `npm run type-check`: passed.
- `npx drizzle-kit check`: passed.
- Focused migration, CLI, backup, reconciliation and checklist tests: 122 passed.
- `npm run test:unit`: 655 passed, 13 expected database-dependent skips.
- `npm run build`: passed.
- `npm run lint`: 0 errors, 199 pre-existing warnings.
- `git diff --check`: passed.
- Temporary PostgreSQL clients were unavailable after workstation crash; explicit staging PostgreSQL, backup integration and live reconciliation were not rerun in this round.

### Residual gates

- No real Frappe source read or CLI apply was executed.
- Live reconciliation requires an approved apply report and provisioned PostgreSQL clients.
- Staging Playwright, egress evidence, canary and rollback remain gated.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Round 3 removes the contradictory database environment, hardens named staging/restore identity checks, and reconciles final source-keyed projections with exact hashes while excluding blocked rows."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "122 focused tests, 655 full unit tests, API build, type-check, schema check, production build, lint and diff checks passed; gated database evidence is explicitly reported as not rerun."
    }
  ],
  "changedFiles": [
    "api/_functions/frappe-migration.ts",
    "api/_functions/lib/frappe-migration-core.ts",
    "docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md",
    "docs/superpowers/plans/2026-08-08-fechamento-migracao-cutover.md",
    "scripts/backup-crm.mjs",
    "scripts/reconcile-migration.mjs",
    "tests/unit/backup-crm.test.ts",
    "tests/unit/cutover-checklist.test.ts"
  ],
  "testsAddedOrUpdated": [
    "tests/unit/backup-crm.test.ts",
    "tests/unit/cutover-checklist.test.ts",
    "tests/unit/reconcile-migration.test.ts"
  ],
  "commandsRun": [
    {
      "command": "npm run build:api && npm run type-check",
      "result": "passed",
      "summary": "API build and TypeScript checks passed."
    },
    {
      "command": "npx drizzle-kit check",
      "result": "passed",
      "summary": "Schema check passed."
    },
    {
      "command": "node --test --import tsx tests/unit/frappe-migration.test.ts tests/unit/frappe-migration-repository.test.ts tests/unit/migrate-frappe-cli.test.ts tests/unit/backup-crm.test.ts tests/unit/reconcile-migration.test.ts tests/unit/cutover-checklist.test.ts",
      "result": "passed",
      "summary": "122 focused tests passed."
    },
    {
      "command": "npm run test:unit",
      "result": "passed",
      "summary": "655 passed and 13 database-dependent tests skipped."
    },
    {
      "command": "npm run build && npm run lint && git diff --check",
      "result": "passed",
      "summary": "Production build passed; lint has 0 errors and 199 pre-existing warnings; diff is clean."
    },
    {
      "command": "env -u DATABASE_URL -u TEST_DATABASE_URL TEST_DATABASE_URL=STAGING_DATABASE_URL node --test --test-concurrency=1 --import tsx tests/unit/frappe-migration-postgres.test.ts tests/unit/quotations-postgres.test.ts tests/unit/quotation-lifecycle-postgres.test.ts",
      "result": "not-run",
      "summary": "Temporary PostgreSQL clients and explicit staging URL were unavailable after workstation crash."
    }
  ],
  "validationOutput": [
    "Manifest keys for Customer and Lead are one-way tokens and focused CLI tests confirm no CPF/CNPJ/email leakage.",
    "Pure reconciliation coverage accepts dry-run empty approvals followed by explicitly approved apply keys and rejects unapproved divergence.",
    "Named backup/restore mismatch and active-production target guards are covered without invoking a real database."
  ],
  "residualRisks": [
    "Live target projection reconciliation remains unexecuted until PostgreSQL clients and an approved apply report are available.",
    "Staging Playwright, firewall/egress evidence, canary and rollback remain operational gates."
  ],
  "noStagedFiles": true,
  "diffSummary": "Round 3 closes environment/restore identity, source-keyed final reconciliation, blocked-row, symlink and backup checksum gaps without real apply.",
  "reviewFindings": [
    "independent re-review required before acceptance"
  ],
  "manualNotes": "No real Frappe source read, apply, production, deployment, canary or rollback was executed."
}
```

## Fix Round 5 report

Status: DONE_WITH_CONCERNS.

### Changes

- Lineage aggregate hashes now exclude target-assigned client local keys while preserving source identity, canonical hash, source hash, and local-row existence checks.
- Revision expectations include an explicit append-effective identity hash with `orderLinkage=null` and `orderPending=false`.
- Reconciliation accepts `rascunho` only when the persisted latest revision has `version > 1` and the source status is non-draft.
- Revision hash comparison switches to the append-effective projection only for that proven immutable append; version 1 remains exact.
- Approved divergence filtering now removes only the exact missing approved source key.
- Written approved rows remain in target projections and are compared normally.
- Missing approved keys are persisted in the reconciliation artifact.
- Unapproved missing identities still fail reconciliation.
- Migration apply now requires `CUTOVER_EXPECTED_DATABASE` whenever a named service is used.
- Backup, preflight, and restore commands require named services and expected database identities.
- Restore validation now requires `PRODUCTION_DATABASE_URL` and rejects restore targets matching it.
- Closure-plan staging/test blocks clear inherited `RESTORE_DATABASE_URL` and assert the named staging database before tests.

### Validation

- `node --test --import tsx tests/unit/migrate-frappe-cli.test.ts tests/unit/backup-crm.test.ts tests/unit/reconcile-migration.test.ts tests/unit/frappe-migration.test.ts`: 94 passed.
- `npm run test:unit`: 659 passed, 13 expected database-dependent skips.
- `npm run build:api`: passed.
- `npm run type-check`: passed.
- `npx drizzle-kit check`: passed.
- `npm run lint`: 0 errors, 199 pre-existing warnings.
- `npm run build`: passed.
- `git diff --check`: passed.
- Staging PostgreSQL tests were not rerun because temporary PostgreSQL clients were unavailable after the workstation crash.
- No real Frappe source read, CLI apply, production, canary, rollback, or live reconciliation was executed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Round 5 closes the seven reviewed blockers with source-safe lineage hashes, append-aware exact projections, narrow approved-key handling, mandatory target guards, and explicit closure-plan environments."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Focused tests, full unit tests, API build, type-check, Drizzle check, production build, lint, and diff checks passed; staging/live gates remain honestly unexecuted."
    }
  ],
  "changedFiles": [
    "api/_functions/frappe-migration.ts",
    "docs/superpowers/plans/2026-08-08-fechamento-migracao-cutover.md",
    "scripts/backup-crm.mjs",
    "scripts/migrate-frappe-crm.mjs",
    "scripts/reconcile-migration.mjs",
    "tests/unit/backup-crm.test.ts",
    "tests/unit/migrate-frappe-cli.test.ts",
    "tests/unit/reconcile-migration.test.ts"
  ],
  "testsAddedOrUpdated": [
    "tests/unit/backup-crm.test.ts",
    "tests/unit/migrate-frappe-cli.test.ts",
    "tests/unit/reconcile-migration.test.ts"
  ],
  "commandsRun": [
    {
      "command": "node --test --import tsx tests/unit/migrate-frappe-cli.test.ts tests/unit/backup-crm.test.ts tests/unit/reconcile-migration.test.ts tests/unit/frappe-migration.test.ts",
      "result": "passed",
      "summary": "94 passed."
    },
    {
      "command": "npm run test:unit",
      "result": "passed",
      "summary": "659 passed and 13 skipped."
    },
    {
      "command": "npm run build:api && npm run type-check && npx drizzle-kit check && npm run lint && npm run build && git diff --check",
      "result": "passed",
      "summary": "Builds, type-check, schema check, lint, production build, and whitespace check passed."
    },
    {
      "command": "env -u DATABASE_URL -u TEST_DATABASE_URL TEST_DATABASE_URL=STAGING_DATABASE_URL node --test --test-concurrency=1 --import tsx tests/unit/frappe-migration-postgres.test.ts tests/unit/quotations-postgres.test.ts tests/unit/quotation-lifecycle-postgres.test.ts",
      "result": "not-run",
      "summary": "Temporary PostgreSQL clients were unavailable after workstation crash."
    }
  ],
  "validationOutput": [
    "Client lineage hashes no longer depend on target-assigned UUIDs.",
    "Append-aware tests reject version-1 drafts and accept only proven version-greater-than-one draft appends.",
    "Approved missing keys are explicit artifact data, while written approved rows remain comparable.",
    "Named staging and restore guards are mandatory in executable scripts and closure commands."
  ],
  "residualRisks": [
    "Live staging PostgreSQL reconciliation remains unexecuted until temporary clients and an approved apply report are available.",
    "Staging Playwright, firewall/egress evidence, canary, and rollback remain operational gates."
  ],
  "noStagedFiles": true,
  "diffSummary": "Round 5 closes client lineage, immutable append, approved divergence, target identity, restore, and closure environment blockers.",
  "reviewFindings": [],
  "manualNotes": "No sensitive values were emitted. No real Frappe source read or apply was executed."
}
```

## Fix Round 6 / Operational Verification

Status: VERIFIED_WITH_GATES.

- PostgreSQL clients provisioned locally under `/tmp/aspen-pg-client` only: `pg_dump`/`psql` 18.4 and `jq` 1.8.1.
- Named staging service verified `current_database=aspen_test`; migrations applied with `npm run db:migrate`.
- Explicit serial staging PostgreSQL command passed: 7 passed, 0 skipped.
- Explicit staging backup/preflight suite passed: 30 passed, 0 skipped.
- Preflight reported no critical metrics: database 9.02 MB and 14 active connections.
- External backup directory is outside checkout with mode `0700`; exact dump has mode `0600` and 233167 bytes.
- Exact checksum file `backup-r5.sha256` passed `sha256sum --check`.
- Explicit `RESTORE_DATABASE_URL` mapped to named `aspen_restore` with source and production identity guards.
- Restore validation passed: products 5, clients 30, quotations 4, revisions 7, revision items 7, lineage 39.
- Synthetic temporary-table restore probe returned count 1.
- Sanitized restore identity artifact and checksum persisted outside the repository.
- Synthetic direct dataset apply, not a Frappe read or CLI fixture apply, plus dry-run/apply report reconciliation against `aspen_test` passed source-keyed product, pricing document/tier, client identity hash, and lineage hash checks.
- Synthetic reconciliation artifact and reports use mode `0600` in a mode `0700` directory outside the repository; cleanup completed.
- Reconciliation was not run against a real Frappe apply report.
- No production or real Frappe data was used, and no secrets were logged.
- Production, canary, rollback, deployment, and egress blocking remain gated.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Appended only the requested sanitized Fix Round 6 operational verification section."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Records exact tool, staging, backup, restore, synthetic reconciliation, cleanup, and gated-scope evidence without secrets, URLs, PII, or raw payloads."
    }
  ],
  "changedFiles": [
    ".superpowers/sdd/2026-08-08-fechamento-migracao-cutover/task-10-report.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "npm run db:migrate",
      "result": "passed",
      "summary": "Migrations applied to the named aspen_test staging target."
    },
    {
      "command": "serial staging PostgreSQL integration command",
      "result": "passed",
      "summary": "7 passed, 0 skipped."
    },
    {
      "command": "explicit staging backup/preflight suite",
      "result": "passed",
      "summary": "30 passed, 0 skipped."
    },
    {
      "command": "sha256sum --check backup-r5.sha256",
      "result": "passed",
      "summary": "Exact external dump checksum verified."
    },
    {
      "command": "backup-crm.mjs --validate --file exact-backup",
      "result": "passed",
      "summary": "Restore validation passed against named aspen_restore with expected table counts."
    },
    {
      "command": "synthetic direct apply plus dry-run/apply reconciliation",
      "result": "passed",
      "summary": "Source-keyed projections, hashes, artifact permissions, and cleanup verified on aspen_test."
    }
  ],
  "validationOutput": [
    "No critical preflight metrics were reported.",
    "Restore synthetic probe returned count 1.",
    "Reconciliation artifact and reports were persisted outside the repository with restrictive permissions."
  ],
  "residualRisks": [
    "Real Frappe apply report reconciliation remains gated.",
    "Production, canary, rollback, deployment, and egress blocking remain unexecuted pending explicit approval."
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds only sanitized Fix Round 6 operational evidence to the Task 10 report.",
  "reviewFindings": [
    "none"
  ],
  "manualNotes": "No production or real Frappe data was used. No secrets were logged."
}
```
