# Task 3 report

> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../../../AGENTS.md) e [`docs/release-lanes.md`](../../../docs/release-lanes.md).

## Reconciliation follow-up

Compared current worktree against commit `718ba1f` before changing anything.
The five modified Task 3 files contain the same implementation behavior, with formatting expansion and readability changes applied across the repository, handler, local server snippets, and tests.
No unrelated files or generated `api/**/*.js` files were changed.
The current implementation was retained, not discarded.

## Implementation

- Added PostgreSQL repository seam with validation, SHA-256 versions, transaction-backed mutations, archive/default rules, usage counts, and current-version reader.
- Added handler routing for list/detail/create/validate/save-version/archive/set-default.
- Added local server URL propagation.
- Added repository-seam handler tests.

## Validation

- `npm run build:api` passed.
- `node --test tests/unit/quotation-template-library.test.ts tests/unit/quotation-templates-core.test.js` passed: 51 tests, 0 failures.
- `git diff --check` passed.
- Follow-up commit created after reconciliation.

Residual risk: database integration tests were not run because no PostgreSQL test database was provisioned.

## Fix round 1

- Exported one deterministic preview view model from the core template module and reused it in the repository.
- Added all nested standard-template fields, including client document/contact/address, item SKU/description, delivery terms, validity and sections.
- Moved create preview/render before the first database insert and removed the unused preview variable.
- Missing template details now return repository-style HTTP 404.
- Expanded handler coverage for missing details, duplicate keys, blank names, invalid HTML, invalid Handlebars and archive-current-default conflict errors.
- Added core regression coverage proving the standard template renders with the complete deterministic fixture.

Validation commands and exact results:

```text
node --test tests/unit/quotation-template-library.test.ts tests/unit/quotation-templates-core.test.js
# tests 53, pass 53, fail 0
npm run build:api
# tsc -p api/tsconfig.api.json (passed)
git diff --check
# passed (no output)
```

Changed files:

- api/_db/quotation-template-library-repository.ts
- api/_functions/quotation-templates.ts
- api/_functions/lib/quotation-templates.ts
- tests/unit/quotation-template-library.test.ts
- tests/unit/quotation-templates-core.test.js
