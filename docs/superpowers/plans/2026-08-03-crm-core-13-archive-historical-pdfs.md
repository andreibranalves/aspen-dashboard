# CRM Core 13: arquivar PDFs históricos importados

Issue: #15
Parent spec: #2

## Global Constraints

- Preserve existing migration framework patterns: `frappe-migration-core.ts` for normalization, `frappe-migration-repository.ts` for persistence, `frappe-migration.ts` for orchestration.
- Use existing `quotation-document-storage.ts` and Vercel Blob for archival.
- No PDF re-generation — only original Frappe PDFs are preserved.
- Deterministic blob keys for idempotent re-execution.
- Never download actual PDF files in tests — use fixtures with known checksums.
- All tests use `node:test` with `node:assert/strict`.
- Brazilian Portuguese for all user-facing errors and reports.

## Task 1: Archive historical PDFs into Vercel Blob

Replace the placeholder `issued_documents` rows (kind: `historical_pdf_import`, size=0) created by #14 with actual PDF uploads to Vercel Blob, preserving the original Frappe PDFs as immutable issued documents.

### Requirements

**Blob key conventions** (`frappe-migration-core.ts`):

1. Add `deriveHistoricalPdfBlobPath(businessNumber: string, sourceId: string, checksum: string): string` — deterministic blob key: `quotations-migration/{businessNumber}/{sourceId}-{checksum}.pdf`.
2. The key includes the business number (for human-readable listing), the source ID (for idempotent re-association), and the checksum (to detect content changes).

**Normalization layer** (`frappe-migration-core.ts`):

1. Add `HistoricalPdfRecord` interface: `{ sourceId: string, businessNumber: string, revisionSourceId: string, fileUrl: string, fileName: string | null, mimeType: string, checksumSha256: string | null, sizeBytes: number | null }`.
2. Add `normalizeHistoricalPdf(record: SourceRecord): HistoricalPdfRecord | null` — extracts PDF metadata from a Frappe Quotation record. The `fileUrl` is deterministically constructed from the Quotation's `name` field (e.g., `QTN-2024-00042`) using the `printview` endpoint: `{ERPNEXT_BASE}/printview?doctype=Quotation&name={name}&format={format}&no_letterhead=0`. The print format defaults to `padrao` (matching the migration's template marker). If a Quotation has no `name`, report a divergence. This approach is consistent with `quotation-html.ts` and the project constraint in AGENTS.md: "Do NOT use ERPNext `download_pdf`; use Puppeteer + `@sparticuz/chromium` with `--headless=new`."
3. The `fileUrl` resolution does NOT use `printing_settings` (which is not a standard Frappe Quotation field). It uses purely the Quotation `name` field for URL construction, then pipes the HTML response through the Puppeteer pipeline (system browser or `@sparticuz/chromium`) to produce the PDF, consistent with `quotation-pdf.js` and `quotation-html.ts`.
4. Report divergence when the Quotation's `name` field is missing (can't construct URL). During dry-run, validate URL constructability at normalization stage but do NOT actually fetch PDFs. Report divergence when checksum is missing (can't verify integrity later).
5. `fileName` defaults to `{quotationName}.pdf` (derived from the `name` field). `mimeType` defaults to `application/pdf` (`QUOTATION_PDF_MIME_TYPE` from `quotation-document-storage.ts`).

**Persistence layer** (`frappe-migration-repository.ts`):

1. Add `updateIssuedDocumentPdf(documentId: string, blobPathname: string, fileName: string, mimeType: string, sizeBytes: number, checksumSha256: string): Promise<void>` to the repository interface.
2. Postgres: UPDATE the existing `issued_documents` row (matched by `id` from the placeholder) — set `blobPathname`, `fileName`, `mimeType`, `sizeBytes`, `checksumSha256`.
3. Memory: update the in-memory `issuedDocuments` map with all six fields.
4. The `revision_unique` constraint prevents duplicate documents per revision — the placeholder row already occupies it.

**PDF archival** (`frappe-migration.ts`):

1. Add `archiveHistoricalPdfs` step after quotation import and before final report.
2. Read `issued_documents` with `kind = 'historical_pdf_import'` from the repository (Postgres or memory).
3. For each placeholder: construct the `printview` URL from the Quotation's `name`, fetch the HTML from Frappe, render it to PDF through the existing Puppeteer pipeline (`renderQuotationPdfHtml` from `quotation-pdf.js`), compute checksum, upload to Vercel Blob with deterministic key, update the issued_document row.
4. Handle errors per-document: a single failed fetch or render must not block other PDFs.
5. Before uploading, validate each downloaded buffer with `isValidPdfBuffer()` (from `quotation-document-storage.ts`). Report corrupted PDFs as divergences — do not upload them.
6. Validate uploaded checksums match downloaded content before committing the update.
7. Dry-run: report counts (documents found, documents with constructable URLs, estimated total volume), flag Quotations with missing `name` fields or URL construction failures as divergences. Do NOT actually fetch PDFs or render them during dry-run — "unreachable" detection is purely at the normalization stage (missing `name` field → can't construct URL → divergence).
8. Idempotent: if a blob already exists at the deterministic key, verify its checksum matches the downloaded content and skip the upload. If the checksum differs, report a divergence (Frappe PDF changed since last migration).

**Tests** (`tests/unit/frappe-migration.test.ts`, `tests/unit/frappe-migration-postgres.test.ts`):

1. Test blob key derivation for valid and edge-case inputs.
2. Test PDF record normalization from valid and missing/incomplete Frappe records (including missing `name` field).
3. Test dry-run reports estimated volume and file count without fetching or uploading.
4. Test idempotent re-execution: second run skips already-archived documents.
5. Test checksum mismatch detection between Frappe source and existing blob.
6. Test graceful handling of unreachable Frappe PDF URL (Quotation with no `name` → divergence, not crash).
7. Test that a failed upload for one document does not block others.
8. Test that corrupted PDF buffers (failing `isValidPdfBuffer`) are reported as divergences and not uploaded.

**Fixtures**:

1. Extend `tests/fixtures/frappe-migration-valid.json` with PDF metadata in quotation records (must include `name` field).
2. Add a fixture with a quotation that has a `name` but no checksum (edge case).
3. Add a fixture with a quotation that has no `name` (edge case — should produce divergence).
4. All fixtures must be sanitized — no real URLs or checksums.

### Verifications

- `npm run lint && npm run build && npm run test:unit` must pass.
- Dry-run must not upload to Vercel Blob and must not fetch URLs from Frappe.
- Re-execution with same input must be idempotent (no duplicate blobs, no duplicate updates).
