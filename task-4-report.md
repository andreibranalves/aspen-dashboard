# Task 4 - Frappe Migration Runs, Batches and Lineage

## Fix Round 1

### Files modified

| File | Changes |
| ------ | --------- |
| `api/_db/schema.ts` | Added `CHECK (checkpoint >= 0)` and `CHECK (attempt_count >= 0)` to `frappe_migration_batches` |
| `api/_db/frappe-migration-repository.ts` | Removed `legacyPayload` from `ExistingLineage`; added `readRawPayload()` to interface and both implementations; stripped `legacyPayload` from `loadState()` and `snapshot()` lineage; stored raw payloads in authorized-only `rawPayloads` Map |
| `api/_functions/lib/frappe-migration-core.ts` | Removed `legacyPayload` from `ExistingLineage` interface; added `sanitizeReportMessage()` for centralized PII masking |
| `api/_functions/frappe-migration.ts` | Injected `activeRunId` into all lineage entries (products, clients, quotations); applied `sanitizeReportMessage` in `add()`; split apply loop to track products/faixas, clients, and documents batches independently; added `faixas` batch creation; added clientes/documentos batch status tracking; used `activeRunId` in manifest instead of generated `runId`; fixed manifest status to compute from entity reports; fixed error handling to mark run failed on `createBatch` failure |
| `tests/unit/frappe-migration.test.ts` | Updated PII test to use `readRawPayload` instead of `legacyPayload` access; removed `legacyPayload` from all `ExistingLineage` test fixtures; added assertion that `loadState` lineage does not expose `legacyPayload` |
| `tests/unit/frappe-migration-repository.test.ts` | New test file: 9 tests covering MemoryFrappeMigrationRepository raw payload boundary, migrationRunId propagation, batch entity coverage, checkpoint non-negative, manifest activeRunId, PII sanitization, and createBatch error handling |
| `drizzle/0013_frappe_migration_batches_non_negative.sql` | New migration: CHECK constraints for `checkpoint >= 0` and `attempt_count >= 0` |

### Decisions

1. **legacy_payload boundary**: Removed from `ExistingLineage` interface and all read-side paths (`loadState`, `snapshot`). Raw payloads only accessible via `readRawPayload()` method. Memory repo uses a separate `rawPayloads` Map indexed by `sourceDoctype:sourceId` to decouple authorized reads from lineage state.

2. **Batch granularity**: Faixas are sub-entities of products (same product unit). Created a separate `faixas` batch that tracks the same checkpoint/attempt as products, satisfying the brief's requirement that all processed entity types have explicit batch status without introducing a misleading separate processing loop.

3. **Manifest status**: Computed from entity reports (divergentes + erros > 0) instead of `report.total` which is only populated after `finalizeReport`. This ensures manifests correctly reflect blocking errors.

4. **PII sanitization**: Centralized `sanitizeReportMessage()` applies CPF/CNPJ formatting mask (`XXX.XXX.XXX-XX` -> `XXX.XXX.XXX-**`), CNPJ mask (`XX.XXX.XXX/XXXX-XX` -> `XX.XXX.XXX/XXX*-**`), and email mask (`user@domain.tld` -> `u***@domain.tld`) in `add()` before messages enter the report. Conservative: only masks formatted patterns to avoid false positives with SKUs.

5. **Error handling on run creation**: When `createBatch` fails after `createRun` succeeds, the run is now marked as `failed` instead of being left in `running` state. The CLI exits non-zero via manifest status.

### Commands and output

```bash
npm run build:api
# tsc -p api/tsconfig.api.json - clean

npm run test:unit
# 541 tests, 529 pass, 0 fail, 12 skipped
```

### Concerns

- The `FrappeLineageEntry` objects stored internally in `MemoryFrappeMigrationRepository` still carry `legacyPayload` at runtime (from `apply*` methods). Both `loadState()` and `snapshot()` now explicitly strip it via field-mapping. This is correct but depends on the stripping happening at every read boundary.
- The `faixas` batch tracks the same checkpoint count as `produtos` since faixas are sub-entities. A future improvement could track individual faixa writes if granular resume is needed.

## Fix Round 2

### Context

The previous fix round 2 attempt timed out after recording 66/66 focused tests.
The suite and build status were not reliably captured before the timeout.
Existing worktree changes were preserved and audited without reset or checkout.

### Corrections

- Added real `provider`, `local_id`, `source_hash`, `migration_run_id`, `source_updated_at`, `imported_at`, and `business_number` propagation for product, faixa, client, and quotation lineage.
- `source_hash` now fingerprints the source document independently from the normalized `canonical_hash`.
- Added source timestamp parsing and assertions for provider, run ID, local identity, hashes, timestamps, and quotation business number.
- Faixas now use their own source checkpoint, divergences fail batches, resume creates missing batch rows, and terminal verification rejects pending or running batches.
- Tracking failures from run, batch, state, sequence, and completion persistence are reported and make the manifest failed.
- Run IDs use UUID execution identities to avoid same-millisecond collisions; failed runs still resume using their persisted ID.
- Added adapter-level PostgreSQL lineage mapping coverage and repository-level raw payload boundary checks.
- Registered migration 0013 in the Drizzle journal and added `drizzle/meta/0013_snapshot.json`.
- Report detail and migration log paths sanitize PII; raw payloads are omitted from state, snapshots, reports, and CLI output.

### Commands and results

```text
npm run build:api
# passed: tsc -p api/tsconfig.api.json

TZ=UTC node --test tests/unit/frappe-migration.test.ts tests/unit/frappe-migration-repository.test.ts tests/unit/frappe-migration-postgres.test.ts
# 69 tests, 66 passed, 0 failed, 3 skipped

npm run test:unit
# 546 tests, 534 passed, 0 failed, 12 skipped

npm run build
# passed: API TypeScript compilation and Vite production build

npx drizzle-kit check
# Everything's fine

npm run lint
# 0 errors; 196 non-blocking warnings

node scripts/migrate-frappe-crm.mjs --dry-run --fixture <blocking fixture>
# exit 1; report contained divergences
```

### Concerns

- PostgreSQL integration tests remain skipped without `TEST_DATABASE_URL`; adapter mapping is covered with a fake database only.
- Migration 0013 backfills `source_hash` from `canonical_hash` for rows already stored before the new source fingerprint was available.
- Raw payload access is capability-gated in the repository; deployment-level authorization and retention purge remain operational responsibilities.

## Fix Round 3

### Corrections

- `processProductUnit`, `processClientUnit` and `processQuotationUnit` now require verified lineage plus matching hashes of the complete source payload and `source_updated_at` before reporting a no-op.
- Source-only metadata changes now persist lineage updates even when normalized local fields are unchanged.
- Quotation units now carry the complete source-payload hash instead of the normalized canonical hash in `sourceHash`.
- Resume preserves persisted batch cursors and skips confirmed source units instead of resetting checkpoints to zero.
- Cursors advance after each successful or no-op unit; a failed write remains the next cursor and is retried.
- Historical lineage is explicit: `source_hash` is nullable, `lineage_status` distinguishes `verified` from `legacy-unverified`, migration 0014 clears the old canonical-hash backfill, and re-import reconciles legacy rows before completion.
- `RAW_PAYLOAD_ACCESS` is module-private; unauthorised repository calls return null and the export boundary is tested.

### Tests added or updated

- Source-only payload and modified-timestamp tests cover products, clients and quotations, including identical-source no-op reruns.
- Synthetic resume test verifies a failure after one product preserves checkpoint 1 and the retry performs only the remaining write.
- Synthetic legacy-unverified reconciliation test verifies canonical hashes are not accepted as source hashes.
- Focused migration, repository and adapter tests pass: 73 tests, 70 passed, 3 skipped without `TEST_DATABASE_URL`.
- Full unit suite passes: 550 tests, 538 passed, 12 skipped.
- `npm run build` passes.
- `npx drizzle-kit check` passes.
- `npm run lint` reports 0 errors and 196 warnings.

### Concerns

- PostgreSQL integration tests remain skipped without `TEST_DATABASE_URL`.
- Historical rows require the 0014 migration before production reconciliation; no production database was available in this run.
- PDF archival checkpointing remains coarse because the existing archival seam exposes placeholders as a whole-list operation.

## Fix Round 4

### Corrections

- Added a per-manifest PostgreSQL session advisory lease with an owner token and safe owner-checked release.
- Added the equivalent in-memory lease used by unit tests.
- Lease acquisition happens before run lookup, so a second apply cannot reuse a running run or dispute its batches and cursors.
- Tracking failures now abort before the next client, quotation, or document phase.
- Run and batch failures mark the run/batches failed when persistence remains available and return a blocking manifest.
- `normalizeLineage()` now accepts `verified` only when `lineageStatus === 'verified'`; a pre-0014 row with a non-null hash remains `legacy-unverified` until re-imported.
- Migration 0014 explicitly resets pre-existing rows to `source_hash = NULL` and `lineage_status = 'legacy-unverified'`.
- Public lineage builders no longer include `legacyPayload`; raw payload attachment occurs only at the repository write boundary and read access remains capability-gated.

### Tests and checks

```text
TZ=UTC node --test tests/unit/frappe-migration.test.ts tests/unit/frappe-migration-repository.test.ts tests/unit/frappe-migration-postgres.test.ts
# 77 tests, 74 passed, 0 failed, 3 skipped without TEST_DATABASE_URL

npm run test:unit
# 554 tests, 542 passed, 0 failed, 12 skipped

npm run build
# passed: API TypeScript compilation and Vite production build

npx drizzle-kit check
# Everything's fine

npm run lint
# 0 errors; 196 non-blocking warnings
```

### Concerns

- PostgreSQL integration tests remain skipped because `TEST_DATABASE_URL` is not set.
- The PostgreSQL lease uses session advisory locks and relies on the existing `postgres.js` `max: 1` pool configuration so acquire and release stay on one session.
- No PostgreSQL concurrency evidence was produced in this run.
- No global migration lock is used; leases are keyed by manifest, so unrelated manifests can proceed independently.

## Fix Round 5

### Corrections

- Reconciliation now rejects any non-zero exclusion count when the manifest lacks a discard-plan projection.
- All-zero exclusion counts remain valid for ordinary manifests without a discard plan.
- Apply manifests now include the same redacted discard-plan projection as dry-run manifests.
- The projection contains closure-bound keys, entities, reasons, and dependencies only, without source payload fields.

### Tests and checks

```text
TZ=UTC node --test --import tsx tests/unit/reconcile-migration.test.ts tests/unit/frappe-migration.test.ts tests/unit/migration-discard.test.ts
# 94 tests, 94 passed, 0 failed, 0 skipped

npm run build:api
# passed: tsc -p api/tsconfig.api.json

npm run type-check
# passed: tsc -p api/tsconfig.api.json --noEmit

npm run lint
# 0 errors; 199 non-blocking warnings

git diff --check
# passed
```

No source-system, database, staging, or production writes were performed.
