# Task 4 report

Implemented idempotent quotation-template and legacy revision migration.

## Changed

- Added pure migration helpers in `api/_db/quotation-template-migration.ts`.
- Added transaction-scoped PostgreSQL advisory lock in `api/_db/quotation-write-lock.ts`.
- Applied lock to draft creation, draft updates, lifecycle status/revision writes, and Frappe quotation imports.
- Added `scripts/migrate-quotation-templates.mjs` with transactional seed, backfill, verification, post-commit verification, and JSON report.
- Added `npm run migrate:quotation-templates`.
- Added focused pure tests.
- Added shared revision metadata resolution so every new writer persists `template_version_id` and `sections_snapshot` under the quotation lock.
- Fixed postgres.js tagged-template lock execution, snake_case legacy deadline normalization, semantic section-default detection, safe CLI diagnostics, and post-commit verification awaiting.

Generated `api/**/*.js` files were not manually edited.

## Tests

- `npm run build:api` - passed.
- `node --test tests/unit/quotation-template-migration.test.ts` - passed, 5 tests (lock adapter, snake_case deadline, semantic settings detection, frozen snapshot invariants).
- `node --test tests/unit/quotations-postgres.test.ts` - skipped because no `TEST_DATABASE_URL`, `TEST_QUOTE_DATABASE_URL`, or `DATABASE_URL` was configured.
- `npm run lint -- --quiet` - passed.
- `npm run type-check` - passed.
- `git diff --check` - passed.

## PostgreSQL

Not run. No database URL configured.

## Fix evidence (round 1)

- `api/_db/quotation-write-lock.ts` now sends an actual tagged-template query to postgres.js transaction clients and retains Drizzle `.execute()` support.
- `api/_db/quotation-revision-invariants.ts` resolves template version by key/hash and derives frozen section snapshots from current legacy revision fields.
- Quote creation, draft update, lifecycle revision creation, and Frappe import now write both revision metadata fields while holding the shared lock.
- `snapshotFromLegacyRevision` accepts both `prazoProducao` and `prazo_producao`.
- `isEmptyQuotationSections` canonicalizes nested JSON before comparing the normalized schema, so key order does not alter legacy seeding and meaningful settings remain untouched.
- CLI now logs only error kind and emits safe Portuguese diagnostics; migration post-commit verification is awaited.
- Removed unused migration maps and corrected duplicate snapshot identity assertion.

## Risks

The PostgreSQL migration CLI requires the normal release order: `npm run db:migrate`, then `npm run migrate:quotation-templates`.

## Reconciliation (2026-08-04)

Compared all five uncommitted Task 4 files against commit `00550ae`.
The apparent changes were formatter-only: Prettier-normalized versions of each file matched byte-for-byte after applying the repository `.prettierrc` to both sides.
No migration, advisory-lock, transaction, or repository behavior differed.

Restored only those accidental formatter edits from `00550ae`.
No follow-up commit was needed because the worktree now matches `00550ae` exactly and remains clean.

- `git diff --check` - passed.
- `git status --short` - clean.
- `git diff --stat 00550ae` - empty.
- `npx prettier --check api/_db/quotation-lifecycle-repository.ts api/_db/quotation-template-migration.ts api/_db/quotation-write-lock.ts api/_db/quote-draft-management-repository.ts scripts/migrate-quotation-templates.mjs` - passed before restoration.

## Fix evidence (round 2)

- `scripts/migrate-quotation-templates.mjs` now parses string-valued `app_settings.quotation_sections` inside a guarded helper; malformed JSON becomes `undefined` instead of aborting the transaction.
- Parsed primitive strings and invalid object shapes continue through `isEmptyQuotationSections`, whose normalization fallback treats them as invalid/empty and seeds legacy settings.
- Existing semantic empty-default detection and meaningful valid settings preservation remain unchanged.
- Added regression coverage for malformed JSON strings, JSON string primitives, and invalid object values.
- `npm run build:api` - passed.
- `node --test tests/unit/quotation-template-migration.test.ts` - passed, 6 tests.
- `npm run type-check` - passed.
- `npm run lint -- --quiet` - passed.
- `node --test tests/unit/quotations-postgres.test.ts` - skipped because no database URL is configured.
- `git diff --check` - passed.
