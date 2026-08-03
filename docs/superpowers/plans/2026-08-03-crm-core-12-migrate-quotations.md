# CRM Core 12: migrar Orçamentos históricos estruturados

Issue: #14
Parent spec: #2

## Global Constraints

- Preserve existing migration framework patterns: `frappe-migration-core.ts` for normalization, `frappe-migration-repository.ts` for persistence, `frappe-migration.ts` as the handler.
- Use Drizzle ORM, PostgreSQL via `@neondatabase/serverless`.
- Monetary values in `numeric` with explicit scale; application calculates in integer centavos.
- Brazilian Portuguese for all user-facing API errors.
- All tests use `node:test` with `node:assert/strict`.
- Test at the handler boundary with real PostgreSQL test database, not mocks.
- Fixtures must be sanitized (no real customer data).
- Never invent missing data; report gaps as divergences.
- Dry-run must not write to PostgreSQL.
- Re-execution must be idempotent.

## Task 1: Migrate historical Quotations, Revisions, Items, and Documents

Import historical Frappe Quotations as first-party Orçamentos, Revisions, Items, and Issued Documents.

### Requirements

**Normalization layer** (`frappe-migration-core.ts`):

1. Add `NormalizedQuotation` interface capturing: source ID, business number, client lineage reference, status, creation/modification dates, child items list, and any available terms (validity, payment, delivery, freight, notes).
2. Add `normalizeFrappeQuotation(record: SourceRecord, clientLineage: Map<string, string>): NormalizedQuotation` - extracts and validates all available fields from a raw Frappe Quotation record. The client lineage map resolves Frappe customer/lead IDs to local client UUIDs.
3. Add `NormalizedQuotationItem` interface capturing: position, product SKU, quantity, unit, suggested price, applied price, item total, and notes.
4. Normalize items from the `items` child table of each Quotation record, or report gaps when items are missing.
5. Add explicit status mapping: `Draft` → `rascunho`, `Submitted` / `Open` → `enviado`, `Ordered` / `Completed` / `Closed` → `aprovado`, `Lost` / `Cancelled` / `Expired` → `perdido`. Unknown statuses are reported and mapped to `rascunho` with a divergence entry.
6. Build `QuotationUnit` and `QuotationItemUnit` types analogous to existing `ProductUnit`/`ClientUnit` patterns.
7. Add `buildQuotationUnits(normalized: NormalizedQuotation[], knownClients: Map<string, string>): { quotationUnits: QuotationUnit[], itemUnits: QuotationItemUnit[], issues: ImportDetail[] }` - resolves client lineage, assigns stable UUIDs via `stableId(kind, sourceId)`, and produces the units for persistence.

**Persistence layer** (`frappe-migration-repository.ts`):

1. Add `applyQuotationUnit` method to the `FrappeMigrationRepository` interface that accepts a `QuotationUnit` and its items.
2. Implement `applyQuotationUnit` in `createPostgresFrappeMigrationRepository` - inserts into `quotations`, `quote_revisions`, `quote_revision_items`, and `issued_documents` tables within a transaction. Uses the existing lineage table for idempotency.
3. Implement `applyQuotationUnit` in `MemoryFrappeMigrationRepository` for dry-run/testing.
4. For quotations that have an issued PDF in Frappe, create an `issued_documents` row with kind `historical_pdf_import`, recording the source PDF file URL/name and checksum without downloading the actual file.

**Handler / orchestration** (`frappe-migration.ts`):

1. Extend `runFrappeMigration` to include quotation migration step after client migration, before the final report.
2. Read Frappe Quotation doctype with pagination via the existing `readFrappeDataset`.
3. Build client lineage map from already-imported clients.
4. Normalize, build units, apply via repository, collect reports.
5. Ensure the numbering counter update: find the max imported business number per year and advance the counter past it.

**Tests** (`tests/unit/frappe-migration.test.ts`, `tests/unit/frappe-migration-postgres.test.ts`):

1. Test normalization of valid and edge-case quotations (missing items, unknown statuses, missing client refs).
2. Test status mapping for all Frappe statuses and unknown ones.
3. Test dry-run does not persist.
4. Test idempotent re-execution (running twice produces same result, no duplicate rows).
5. Test numbering counter advancement after import.
6. Test with fixtures covering varied states, years, clients, and incomplete data.
7. Test gap/divergence reporting for missing required fields.

**Fixtures**:

1. Add sanitized Frappe Quotation fixtures in `tests/fixtures/` with varied statuses, years, clients, and edge cases.
2. Add an invalid fixture with malformed records to test validation.

### Design Decisions

1. **Business number format:** The original plan draft specified `ORC-YYYYMMDD` (date-based), but this format would collide for same-day quotations and cannot drive a per-year counter. The implementation uses `ORC-{creation-year}{4-digit sequence from name suffix}` (e.g. `QTN-2024-00042` -> `ORC-20240042`), which satisfies uniqueness, counter requirements, and format parity with locally-created orcamentos via `reserveBusinessNumber`.

### Verifications

- `npm run lint && npm run build && npm run test:unit` must pass.
- Postgres tests must succeed with a running test database.
- Dry-run must not mutate the database.
- Re-execution with same input must produce identical persisted state.
