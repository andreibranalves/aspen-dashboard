# Acceptance Report - Migração PostgreSQL

Status: `BLOCKED_PENDING_OPERATIONAL_APPROVAL`.

Branch: `fix/migration-customer-lineage`.

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
- A dedicated Hostinger KVM 1 now serves the self-hosted staging API through the existing Traefik HTTPS endpoint.
- Evolution containers are stopped and their Docker project and volumes remain preserved for explicit later restoration.
- Host and Docker-forwarded egress use a persisted default-deny nftables policy.
- Input, output and forward chains all report policy `drop`.
- PostgreSQL and KV connectivity passed from the staging container with the policy active.
- Frappe TCP connectivity failed from the staging container with the policy active.
- The egress service is enabled, active after Docker restart and active after a controlled VPS reboot.
- The final firewall, dependency inventory, probe and E2E evidence is outside the checkout under `/home/andrei/.local/share/aspen-dashboard/cutover-20260808/vps-staging-egress-v1/`.
- Core staging E2E passed 2 tests after reboot, covering PostgreSQL detail, PDF download, public-link issue/read/revoke/expiry, outbox inspection and revision editing.
- The disposable PostgreSQL fixture returned to zero rows after the E2E run.
- The rollback-compatible Frappe read scenario was previously passed in a separate temporary deployment before the final deny policy.
- The final Preview deployment remains in the legacy rollout state.
- Preview SSO protection is enabled for all previews and production deployment URLs.
- N8N, Evolution and outbox provider URL variables are absent from Preview and VPS staging.
- No Production deployment, production canary, provider delivery or Frappe CLI apply was executed.
- No secrets, raw payloads, Customer or Lead identifiers were written to this report.

## Operational findings

- The staging PDF assertion observes the browser download and binds response headers and bytes to the revision.
- PostgreSQL quote edits keep dedicated legacy fields and editable section snapshots synchronized.
- The staging outbox inspection endpoint allows only canonical Preview deployments and fails closed for production, unknown Vercel environments and production-like local execution.
- A KV token can return either 410 while its expired record remains or 404 after KV eviction; the E2E test proves the token first worked and accepts both safe terminal responses.
- The VPS uses the bundled `@sparticuz/chromium` binary with the required Linux shared libraries and does not depend on a system browser.
- The rollback-compatible read was intentionally executed before egress lockdown because the final staging policy must deny Frappe.

## Pending gates

- Obtain explicit operational approval for the canary and rollback window.
- Define the production canary owner, success criteria, abort thresholds and rollback trigger.
- Execute any production canary only after approval, without changing Frappe or enabling external providers.

## Decision

Migration data, backup, restore and PostgreSQL reconciliation are verified.

Staging PostgreSQL canary, PDF flow, provider isolation and controlled rollback-read scenarios are verified.

Real staging egress enforcement is now evidenced by a persisted VPS firewall and a blocked Frappe TCP probe.

Acceptance remains blocked only until operational approval for the production canary and rollback window exists.

Keep Evolution stopped, keep Preview in the legacy rollout state and keep Production unchanged until that approval is recorded.
