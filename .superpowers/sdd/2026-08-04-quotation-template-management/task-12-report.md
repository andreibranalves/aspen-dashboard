# Task 12 report

> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../../../AGENTS.md) e [`docs/release-lanes.md`](../../../docs/release-lanes.md).

## Round 3 scope

Removed the inert lifecycle side-effect seam introduced by the previous round:

- removed exported `QuotationLifecycleSideEffects`;
- removed `sideEffects` from `QuotationLifecycleRepositoryOptions`;
- removed test-only PDF, Blob, document-storage, and document-URL callback spies.

The production lifecycle repository now exposes only behavior it implements.
Status transitions still use the actual repository `setStatus` path, and tests retain honest source-level and response assertions:

- `quotation-lifecycle-repository.ts` imports no PDF, document-storage, Blob, or issued-document dependency;
- the actual repository status response has no issuance fields such as `pdf_url`, `document_url`, `issued_document`, or `issued_document_id`.

The keyed lock regression and migration CLI behavior from prior rounds remain unchanged.
No generated `api/**/*.js`, PDF, Blob, or design-document files changed.

## Files changed in round 3

- `api/_db/quotation-lifecycle-repository.ts`
- `tests/unit/quotations-core.test.ts`
- this report

## Targeted verification

Command:

```bash
TZ=UTC node --test tests/unit/quotations-core.test.ts tests/unit/quotation-template-migration.test.ts
```

Result: PASS, 12 passed, 0 failed, 0 skipped.

The lifecycle regression invokes the actual PostgreSQL repository status transition against a transaction double, verifies the response contains no issuance fields, and verifies source-level absence of PDF, document-storage, Blob, and issued-document imports.
The keyed lock regression still extracts the actual migration and lifecycle advisory keys and proves same-key serialization.

## Full verification status

Prior round evidence remains valid for the unchanged scope:

- targeted unit suite: 92 passed, 0 failed, 2 PostgreSQL integration tests skipped because database variables are absent;
- affected Playwright suite: 9 passed, 0 failed;
- `npm run lint`: passed with existing warnings;
- `npm run type-check`: passed;
- `npm run check:tailwind`: passed;
- `npm run build`: passed;
- full unit suite: 460 passed, 0 failed, 12 PostgreSQL tests skipped because database variables are absent.

Migration CLI execution remains unavailable in this checkout because `DATABASE_URL` is absent.
Real PostgreSQL migration idempotency, advisory-lock behavior, and lifecycle persistence require `DATABASE_URL` or `TEST_DATABASE_URL`.

## Review finding addressed

The dead seam finding is resolved.
Production no longer exports or accepts an inert side-effect callback contract, and tests no longer claim runtime callback-spy coverage.
The accepted alternative is source-level dependency verification plus the actual repository response assertion.

## Residual risks

- PostgreSQL migration idempotency and real cross-process advisory-lock behavior remain unverified without a database URL.
- PostgreSQL lifecycle persistence/concurrency integration remains skipped without a database URL.
- Existing historical migration references to issued-document data remain outside this lifecycle production scope.
