# Task 9 report

## Changed

- Historical snapshot loading now accepts quotation business number, quotation UUID, or revision UUID.
- Snapshot includes persisted template version and immutable section snapshot.
- Draft-only `template_version_id` override validates active model and rejects persisted overrides.
- Preview renders persisted template source/hash, preserves static legacy fallback, and returns version metadata headers.
- Legacy `template` and `template_key` query overrides are rejected.
- HTML responses include no-store and safe CSP/referrer/content-type headers.
- Section view model uses revision production deadline and persisted section flags/content.
- Added genuine deterministic fake-DB coverage for revision UUID exact selection, business-number latest revision, persisted dynamic source/hash, no-settings reads and stable historical output after simulated global mutation.
- Added preview coverage for draft `template_version_id`, both legacy query override rejections, and injected on-the-fly PDF rendering.
- Added a PDF renderer injection seam to the preview handler. Production default remains `renderQuotationPdfHtml`.

## Validation

- `node --test tests/unit/quotation-templates-core.test.js tests/unit/quotation-html.test.js` - 57 passed.
- `npm run build:api` - passed.
- `npm run lint -- --no-warn-ignored` - passed with existing warnings only, zero errors.
- `lsp_diagnostics` on changed TypeScript/JavaScript files - zero diagnostics.
- `git diff --check` - passed.

## Residual risks

- PostgreSQL integration was not claimed or run because no test database was configured; focused tests use deterministic fake DB/repository seams.
- Existing repository JavaScript build artifacts are not tracked or modified.
- Worktree contains only intended source/test modifications; no generated PDF/Blob artifacts.

## Round-3 evidence

- Revision UUID and business-number tests now use competing revisions with distinct IDs, versions, sources, hashes, and rendered output.
- Draft override coverage now uses a table-identity fake DB that exercises `readQuotationTemplateSnapshot`, including distinct base/selected persisted versions, active model validation, selected source, key, and hash.
- `node --test tests/unit/quotation-templates-core.test.js tests/unit/quotation-html.test.js` - 57 passed.
- `npm run build:api` - passed.
- `npm run lint -- --no-warn-ignored` - passed with existing warnings only, zero errors.
- `git diff --check` - passed.
- No production files, generated API files, PDF, or Blob artifacts changed.
