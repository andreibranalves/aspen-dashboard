# Acceptance Report - Migração PostgreSQL

Status: `BLOCKED_PENDING_OPERATIONAL_APPROVAL`.

Branch: `fix/migration-customer-lineage`.

Implementation commits: `1ab4e6e` and `290cb91`.

## Verified

- PostgreSQL migration apply completed against the isolated `aspen_test` database with zero blockers and zero errors.
- Final target reconciliation passed with matching source, apply and persisted-run hashes.
- Reconciliation artifact: `/home/andrei/.local/share/aspen-dashboard/cutover-20260808/reconciliation-v5/reconciliation.json`.
- Reconciliation artifact SHA-256: `c33300742ce68f00079f0b97bf749b16ff7778157183b16e4fc01900b240f450`.
- Final reconciled counts were 56 products, 302 pricing tiers, 470 clients, 513 quotations, 513 revisions, 1462 items, 1 template and 1 template version.
- Exact exclusion closure was 5 products, 55 pricing documents, 155 clients, 162 quotations and 0 documents.
- Reconciliation selected 1349 lineage rows with zero invalid lineage, missing identities or extra imported rows.
- Backup and restore validation passed against the isolated `aspen_restore` database.
- Restore validation confirmed accessible products, clients, quotations, revisions, items and lineage tables.
- Restore counts were 5 products, 30 clients, 4 quotations, 7 revisions, 7 items and 39 lineage rows.
- Synthetic restore probe completed and left no persistent probe row.
- PostgreSQL draft-management integration passed against `aspen_test` with the section and legacy-field synchronization assertions.
- Full unit suite passed 672 tests with 13 database-dependent skips when database variables were unset.
- `npm run check` passed, including lint, type-check, Tailwind validation, API build and frontend production build.
- ESLint reported 0 errors and 199 warnings.
- Targeted LSP diagnostics reported no errors for the changed modules and tests.
- Staging PostgreSQL canary scenarios passed in the guarded Preview deployment: PostgreSQL detail, PDF download, public-link issue/read/revoke/expiry, outbox inspection and revision editing.
- Core-mode staging log: `/home/andrei/.local/share/aspen-dashboard/cutover-20260808/staging-e2e-core-review-final.log`.
- Rollback-compatible legacy-read scenario passed in a separate guarded Preview deployment.
- Rollback staging log: `/home/andrei/.local/share/aspen-dashboard/cutover-20260808/staging-e2e-rollback-review-final.log`.
- The final Preview deployment was restored to the legacy rollout state.
- Preview SSO protection is enabled for all previews and production deployment URLs.
- N8N, Evolution and outbox provider variables are absent from Preview.
- No production deployment, production canary, provider delivery or Frappe CLI apply was executed.
- No secrets, raw payloads, Customer or Lead identifiers were written to this report.

## Operational findings

- The staging PDF assertion now observes the browser download and binds response headers and bytes to the revision.
- PostgreSQL quote edits now keep dedicated legacy fields and editable section snapshots synchronized.
- The staging outbox inspection endpoint allows only canonical Preview deployments and fails closed for production, unknown Vercel environments and production-like local execution.
- A KV token can return either 410 while its expired record remains or 404 after KV eviction; the E2E test proves the token first worked and accepts both safe terminal responses.
- The `STAGING_EGRESS_BLOCKED=1` variable and provider guards were present during the tests.
- Independent firewall or DNS evidence proving that Frappe egress is blocked was not produced.
- The rollback-compatible read therefore exercised the approved legacy GET path in a separate temporary rollback deployment, not a network-deny proof.

## Pending gates

- Apply and archive an independent staging firewall or DNS deny rule for the Frappe domain.
- Repeat the PostgreSQL-only staging regression after that deny rule is active.
- Obtain explicit operational approval for the canary and rollback window.
- Execute any production canary only after approval, without changing Frappe or enabling external providers.

## Decision

Migration data, backup, restore and PostgreSQL reconciliation are verified.

Staging PostgreSQL canary and controlled rollback-read scenarios are verified.

Acceptance remains blocked until independent Frappe egress-deny evidence and operational approval exist.

Keep Preview in the legacy rollout state and keep Production unchanged until those gates are approved.
