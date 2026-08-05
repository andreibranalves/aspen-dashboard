# Task 12 report

## Scope

Added only regression coverage required by the brief:

- lifecycle status response explicitly proves no PDF/document issuance artifacts are returned;
- shared advisory lock fake-seam test proves migration and revision-writer lock calls serialize.

No production files, generated API output, PDF, Blob, or design docs changed.

## Targeted unit tests

Command:

```bash
TZ=UTC node --test tests/unit/quotation-content.test.ts tests/unit/quotation-template-library.test.ts tests/unit/quotation-template-migration.test.ts tests/unit/quotation-templates-core.test.js tests/unit/settings.test.ts tests/unit/quotations-core.test.ts tests/unit/quotations-postgres.test.ts tests/unit/quotation-lifecycle-postgres.test.ts
```

Result: PASS, 92 passed, 0 failed, 2 skipped.

Skipped tests are PostgreSQL integration tests because `TEST_QUOTE_DATABASE_URL` / `TEST_DATABASE_URL` are absent. This is reported as unavailable integration coverage, not as a pass.

## Affected E2E

Command:

```bash
npx playwright test tests/settings.spec.js tests/quotation-templates-core.spec.js tests/quotation-lifecycle.spec.js
```

Result: PASS, 9 passed, 0 failed.

The quotation lifecycle E2E covers on-demand PDF preview URL behavior, historical preview identity, status transition, and revision creation. Template preview runs sandboxed in the browser test suite.

## Project verification

- `npm run lint`: PASS, zero errors; existing warnings remain.
- `npm run type-check`: PASS.
- `npm run check:tailwind`: PASS.
- `npm run build`: PASS.
- `npm run test:unit`: PASS, 460 passed, 0 failed, 12 skipped. PostgreSQL skips remain due to absent database URL.

## Forbidden-reference/security checks

The requested TypeScript/TSX scan found only existing intentional matches:

- `api/_functions/lib/quotation-html.ts` print button validator fixture (`onclick`), existing.
- React `onClick` handlers in application source, expected.
- Existing sandboxed template preview iframe in `QuotationTemplateManager`, expected and covered by E2E.

The issuance dependency scan found only historical migration comments/types for `issued_documents` and the historical migration Blob pipeline. No new issuance dependency was introduced. Generated `api/**/*.js` files were not included in source scan and none were staged.

## Migration verification

`npm run migrate:quotation-templates` was attempted. It failed safely because `DATABASE_URL` is absent:

```text
[quotation-template-migration] failed (Error)
Falha na migração de templates. Consulte os logs operacionais.
```

A second idempotency run was not claimed because no database URL exists. Production verification must run `npm run db:migrate`, then `npm run migrate:quotation-templates` twice against PostgreSQL and inspect reports for zero additional revisions on the second run.

## Files

- `tests/unit/quotation-template-migration.test.ts`
- `tests/unit/quotations-core.test.ts`
- this report

## Residual risks

- PostgreSQL migration idempotency and real cross-process advisory-lock behavior remain unverified in this environment.
- PostgreSQL lifecycle persistence/concurrency integration remains skipped without a database URL.
- Existing intentional forbidden-reference matches require reviewer distinction from accepted template source paths.

## Round-1 evidence

- `runQuotationTemplateMigration` now exposes a dependency seam while the production CLI still acquires the shared advisory lock and performs post-commit verification.
- The concurrency regression invokes the actual migration runner and actual lifecycle repository `setStatus` path concurrently, records advisory key `8417392051842`, and asserts both paths acquire the same lock in serialized order.
- The lifecycle regression invokes the actual PostgreSQL lifecycle repository against a fake transaction/database and asserts the status response has no `pdf_url`, `document_url`, `issued_document`, or `issued_document_id`; no PDF, Blob, document-storage, or document-URL side-effect seam is called.
- Focused seam tests: 12 passed, 0 failed.
- `npm run build:api` and `git diff --check` passed.
- Existing TypeScript fixture diagnostics in `tests/unit/quotations-core.test.ts` remain unrelated pre-existing mock-shape findings; runtime tests pass.
- No generated API, PDF, Blob, or design-document changes were introduced.
