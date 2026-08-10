# Staging/Rollback Legacy Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the Frappe legacy-read gate from final PostgreSQL staging so both environments have an executable, accurately documented contract.

**Architecture:** Final staging keeps egress default-deny and runs only PostgreSQL cutover flows. Rollback-compatible deployment keeps the existing authenticated legacy-read check from the rollback runbook and stores only protected evidence. No application runtime changes or provider configuration changes.

**Tech Stack:** Playwright, Node.js ESM, Bash, `curl`, `jq`, Markdown.

## Global Constraints

- PostgreSQL is the source of truth; Frappe remains read-only legacy.
- Final staging keeps external providers disabled and Frappe egress blocked.
- Rollback legacy reads use a protected authenticated configuration and never print secrets or payloads.
- Do not add dependencies.
- Do not modify Production flags or deployment aliases.
- Evidence files stay outside Git with directory mode `0700` and file mode `0600`.

---

### Task 1: Remove the incompatible legacy case from final staging

**Files:**
- Modify: `tests/quotation-cutover-staging.spec.js`
- Modify: `tests/support/staging-auth.js`
- Modify: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`

**Interfaces:**
- `assertStagingConfig()` continues returning `baseUrl`, `username`, `password`, `postgresQuotationId` and `scratchQuotationId`.
- `tests/quotation-cutover-staging.spec.js` continues using `CONFIG` for PostgreSQL-only flows.

- [ ] **Step 1: Confirm the current failing boundary**

Run the existing staging file with the protected staging environment and no provider variables:

```bash
STAGING_E2E=1 npx playwright test tests/quotation-cutover-staging.spec.js --project=chromium
```

Expected before the change: the two PostgreSQL tests pass and the legacy-read test fails because final staging denies Frappe access.

- [ ] **Step 2: Remove only the legacy test**

Delete the `test('opens a known legacy quotation for rollback-compatible read', ...)` block from `tests/quotation-cutover-staging.spec.js`.

Leave `assertNoForbiddenEgress()` and all PostgreSQL/public-link/outbox/revision assertions unchanged.

- [ ] **Step 3: Remove the staging-only legacy prerequisite**

In `tests/support/staging-auth.js`, remove `KNOWN_LEGACY_QUOTATION_ID` from `REQUIRED_STAGING_VARS` and remove `legacyQuotationId` from the returned staging config.

Keep `KNOWN_LEGACY_QUOTATION_ID` available to the rollback runbook; it is no longer a final-staging precondition.

- [ ] **Step 4: Correct the staging runbook command**

In the final-staging setup and Playwright command in `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`, remove the `KNOWN_LEGACY_QUOTATION_ID` requirement/export.

State beside that command that the legacy read is intentionally excluded and is required only in the rollback section.

- [ ] **Step 5: Run the focused final-staging suite**

```bash
STAGING_E2E=1 npx playwright test tests/quotation-cutover-staging.spec.js --project=chromium
```

Expected: `2 passed`, with no Frappe/provider request and disposable scratch cleanup successful.

- [ ] **Step 6: Commit the test contract change**

```bash
git add tests/quotation-cutover-staging.spec.js tests/support/staging-auth.js docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md
git commit -m "test: isolate legacy read from staging"
```

### Task 2: Register the rollback-only legacy gate

**Files:**
- Modify: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md`
- Modify: `docs/superpowers/reports/2026-08-08-migracao-acceptance.md`
- Modify: `.superpowers/sdd/2026-08-08-fechamento-migracao-cutover/progress.md`

**Interfaces:**
- Rollback read consumes `KNOWN_LEGACY_QUOTATION_ID`, `APP_ORIGIN` and protected `APP_CURL_CONFIG`.
- Rollback evidence is written to `$CUTOVER_DIR/rollback-legacy-read.json`, never to Git.

- [ ] **Step 1: Label the existing rollback command**

In the runbook rollback section, label the authenticated legacy route check as the mandatory `rollback-compatible` gate, explicitly separate from final staging, and retain the PostgreSQL identity check beside it.

Use the existing protected command shape:

```bash
curl --fail --silent --show-error --config "$APP_CURL_CONFIG" \
  --url "$APP_ORIGIN/api/quotations?id=$KNOWN_LEGACY_QUOTATION_ID" \
  > "$CUTOVER_DIR/rollback-legacy-read.json"
jq -e 'type == "object" and length > 0' "$CUTOVER_DIR/rollback-legacy-read.json"
```

Document that Frappe must be read-only, egress may be available only on this rollback deployment, and the final staging default-deny policy must not be relaxed.

- [ ] **Step 2: Record the two separate evidence gates**

In the acceptance report, replace the ambiguous combined wording with two explicit entries:

- final staging: two PostgreSQL cutover tests passed after reboot with Frappe egress blocked;
- rollback-compatible: one legacy-read test passed in the separate temporary deployment, recorded in `staging-e2e-rollback-id-v3.log`.

Keep the existing no-secrets/no-payloads statement.

- [ ] **Step 3: Update the execution ledger**

In `.superpowers/sdd/2026-08-08-fechamento-migracao-cutover/progress.md`, state that the final staging suite excludes legacy reads and that the rollback-compatible legacy-read gate passed separately.

- [ ] **Step 4: Commit the registration**

```bash
git add docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md docs/superpowers/reports/2026-08-08-migracao-acceptance.md .superpowers/sdd/2026-08-08-fechamento-migracao-cutover/progress.md
git commit -m "docs: register rollback legacy gate"
```

### Task 3: Run repository verification

**Files:**
- Read: changed files from Tasks 1-2
- Test: `tests/quotation-cutover-staging.spec.js`, unit suite, repository checks

- [ ] **Step 1: Run diagnostics on changed code**

```bash
npx eslint tests/quotation-cutover-staging.spec.js tests/support/staging-auth.js
npx tsc -p api/tsconfig.api.json --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run unit tests**

```bash
npm run test:unit
```

Expected: all configured unit tests pass; only pre-existing database-dependent skips remain when no `TEST_DATABASE_URL` is configured.

- [ ] **Step 3: Run final staging E2E**

```bash
STAGING_E2E=1 npx playwright test tests/quotation-cutover-staging.spec.js --project=chromium
```

Expected: `2 passed`; no legacy test runs in this environment.

- [ ] **Step 4: Verify rollback evidence without exposing contents**

```bash
stat -c '%a %n' /home/andrei/.local/share/aspen-dashboard/cutover-20260808/staging-e2e-rollback-id-v3.log
```

Expected: protected evidence exists; do not print its contents or secrets.

- [ ] **Step 5: Run final checks**

```bash
git diff --check
npm run check
git status --short
```

Expected: checks pass and only intended commits/files are present.

- [ ] **Step 6: Commit any verification-only doc correction**

Only if a documented result changed during verification:

```bash
git add docs/superpowers/reports/2026-08-08-migracao-acceptance.md .superpowers/sdd/2026-08-08-fechamento-migracao-cutover/progress.md
git commit -m "docs: record staging gate evidence"
```
