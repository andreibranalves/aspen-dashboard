# Acceptance Report - Migração PostgreSQL

Status: BLOCKED_PENDING_OPERATIONAL_APPROVAL.

Branch: `master`.

HEAD: local `master` worktree.

## Verified

- PostgreSQL migrations applied to named staging database `aspen_test`.
- Six PostgreSQL integration suites passed serially with zero skips against the named test database.
- Seven serial PostgreSQL integration tests passed with zero skips in the prior acceptance run.
- Thirty backup, restore-guard, preflight and checklist tests passed with zero skips.
- Backup preflight passed with 8.70 MB database size and 9 active connections.
- Backup was written outside the checkout to a mode `0700` directory.
- Exact backup file mode was `0600` and its SHA-256 checksum passed `sha256sum --check`.
- Restore validation passed against named `aspen_restore`.
- Restore counts were products 5, clients 30, quotations 4, revisions 7, items 7 and lineage 39.
- Synthetic isolated restore probe returned count 1 and left no persistent probe row.
- Synthetic direct dataset apply plus dry-run/apply reconciliation passed against `aspen_test`.
- Synthetic reconciliation verified source-keyed products, pricing documents, pricing tiers, client identity hash and lineage hash.
- Local Playwright passed the impacted operational, quotation, cutover and lifecycle flows.
- Local Playwright passed 57 local tests when the staging spec was excluded; the operational-mode test is a UI contract test with mocked API boundaries.
- Direct unit coverage verifies the OpenRouter request/response contract and PostgreSQL quotation handler routing; database-backed PostgreSQL suites cover persistence when staging variables are supplied.
- Full unit suite passed 668 tests with 13 database-dependent skips when database variables were explicitly unset.
- Operational mode keeps `/auto` available for OpenRouter extraction and PostgreSQL CRM quotation creation; live provider and staging evidence remain pending.
- Type-check, API build, production build, Tailwind check, Drizzle check and whitespace check passed.
- ESLint reported zero errors and 199 pre-existing warnings.
- Targeted LSP diagnostics reported no errors for changed scripts and tests.
- Final scoped review of commit `5992704` returned PASS with no concrete blockers.
- Rollout flags remained `CRM_CORE_QUOTES_ENABLED=false` and `CRM_QUOTES_ROLLOUT_STATE=legacy`.
- No production deployment, provider delivery, Frappe source read or real Frappe CLI apply was executed.

## Evidence

Protected operational artifacts remain outside the repository under the cutover evidence directory.

Artifacts include tool versions, preflight output, backup checksum, restore validation, restore identity counts, synthetic reconciliation reports and checksums.

Reports contain no database URLs, credentials, raw payloads or customer PII.

## Pending gates

- Real anonymized Frappe snapshot dry-run and approved real apply.
- Reconciliation against the approved real apply report.
- Real staging Playwright with staging credentials.
- Staging Frappe egress deny evidence.
- Staging PostgreSQL canary and exercised rollback.
- Production canary, deployment and rollback window approval.
- Final operational acceptance after the pending staging and cutover gates.

## Decision

The migration code is merged locally in `master`, but operational acceptance remains blocked until the pending gates receive explicit approval and evidence.

Keep the rollout flags on the legacy state until all pending gates receive explicit approval and evidence.

Do not cut over production based only on the synthetic reconciliation.
