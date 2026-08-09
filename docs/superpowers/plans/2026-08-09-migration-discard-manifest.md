# Migration Discard Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a snapshot-bound discard manifest that migrates only the approved dependency-safe subset without hiding blockers or creating orphan records.

**Architecture:** Keep discard policy separate from generic divergence approval.
A pure discard module validates the manifest and computes a deterministic exclusion closure from normalized client, product, pricing, and quotation units.
`runFrappeMigration` consumes that plan before any write, reports exclusions separately, and extends reconciliation to prove that only the writable subset reached PostgreSQL.

**Tech Stack:** Node.js ESM, TypeScript, Node `node:test`, Drizzle/PostgreSQL, existing Frappe migration CLI, existing protected artifacts.

## Global Constraints

- Frappe remains untouched; no delete or write request is added to the source adapter.
- The discard manifest is explicit, snapshot-bound, protected with mode `0600`, and stored outside the checkout.
- The current `--approve-divergence` flow remains for low-risk exceptions only and cannot represent this discard policy.
- Any dependency of an excluded client or product is excluded before it can be written.
- Apply validates the manifest, source hash, closure, and database contract before the first repository write.
- No secrets, PII, HTTP payloads, raw snapshots, or unredacted source identifiers enter reports, commits, or chat.
- No new dependency is added.
- Existing fail-closed behavior remains when no discard manifest is supplied.
- The current approved scope is 46 ambiguous client groups, 5 ambiguous product/pricing units, and a dependency closure of 162 quotations.

---

### Task 1: Add pure discard manifest and closure primitives

**Files:**
- Create: `api/_functions/lib/migration-discard.ts`
- Create: `tests/unit/migration-discard.test.ts`
- Modify: `api/_functions/lib/frappe-migration-core.ts:13-28` only if the shared report status type must expose `excluidos`.

**Interfaces:**
- `DiscardReason = 'ambiguous-client' | 'ambiguous-pricing' | 'invalid-quotation-price' | 'discarded-dependency'`.
- `DiscardEntry = { key: string; source_doctype: string; source_id: string; entity: 'produto' | 'faixa' | 'cliente' | 'orcamento'; reason: DiscardReason; depends_on: string[] }`.
- `DiscardManifest = { schemaVersion: 1; policy: 'discard-all-blockers'; sourceManifestHash: string; dryRunReportHash: string; entries: DiscardEntry[]; closureHash: string }`.
- `DiscardPlan = { entries: Map<string, DiscardEntry>; clientKeys: Set<string>; productKeys: Set<string>; pricingKeys: Set<string>; quotationKeys: Set<string>; closureHash: string }`.
- `parseDiscardManifest(value: unknown): DiscardManifest` rejects unknown versions, malformed keys, duplicate entries, unsupported policy, and non-SHA-256 hashes.
- `validateDiscardManifest(manifest: DiscardManifest, expected: { sourceManifestHash: string; dryRunReportHash: string; requiredKeys: Set<string> }): void` rejects stale, incomplete, or extra keys before writes.
- `buildDiscardPlan(input: { clientUnits: ClientUnit[]; productUnits: ProductUnit[]; quotations: NormalizedQuotation[]; clientKeys: Map<string, ClientUnit>; quotationIssueKeys: Map<string, DiscardReason> }): DiscardPlan` computes direct blockers and dependency closure.
- `hashDiscardEntries(entries: DiscardEntry[]): string` sorts canonical entries before hashing.

- [ ] **Step 1: Write failing closure tests.**

Use a synthetic normalized graph with:

```text
client group C1 -> quotation Q1
product P1 -> pricing tier R1 -> quotations Q1 and Q2
quotation Q3 -> invalid positive-price validation
quotation Q4 -> clean client and product
```

Assert that the plan excludes C1, R1, P1, Q1, Q2, and Q3, preserves Q4, records `depends_on`, and produces the same `closureHash` regardless of input order.

Add a test that duplicate keys, an unknown reason, and a changed manifest hash throw before a plan is accepted.

- [ ] **Step 2: Run the focused test and verify RED.**

Run:

```bash
node --test --import tsx tests/unit/migration-discard.test.ts
```

Expected: FAIL because the manifest types and closure functions do not exist.

- [ ] **Step 3: Implement the minimal pure module.**

Keep it free of filesystem, database, network, and repository imports.
Use `canonicalApprovalKey`/`safeApprovalKey` for source identity keys so Customer and Lead identifiers remain opaque.
Build quotation dependency entries from source lineage and SKU references, not from display names.

- [ ] **Step 4: Run the focused test and verify GREEN.**

Run:

```bash
node --test --import tsx tests/unit/migration-discard.test.ts
```

Expected: PASS with deterministic closure and validation errors.

- [ ] **Step 5: Commit the pure module.**

```bash
git add api/_functions/lib/migration-discard.ts tests/unit/migration-discard.test.ts api/_functions/lib/frappe-migration-core.ts
git commit -m "feat(migration): add discard manifest closure"
```

---

### Task 2: Integrate exclusions into migration reports and writes

**Files:**
- Modify: `api/_functions/lib/frappe-migration-core.ts:13-28,285-324,1735-1826,1951-1970`
- Modify: `api/_functions/frappe-migration.ts:101-117,192-244,1685-2572`
- Test: `tests/unit/frappe-migration.test.ts`
- Test: `tests/unit/migration-discard.test.ts`

**Interfaces:**
- Add `excluidos` to `IMPORT_STATUSES`, `ImportStatus`, `ImportDetail`, `EntityReport`, and aggregate totals.
- Extend `MigrationOptions` with `discardManifest?: DiscardManifest`.
- Extend `MigrationManifest` with `discardManifestHash: string | null` and `exclusionCounts: { produtos: number; faixas: number; clientes: number; orcamentos: number; documentos: number }`.
- Add `addExcluded(report: EntityReport, detail: ImportDetail): void` that increments `excluidos` and keeps the source key opaque.
- `runFrappeMigration` must validate `discardManifest` after computing the source manifest hash and before acquiring an apply lease or writing a repository unit.

- [ ] **Step 1: Write failing report and write-guard tests.**

Add tests that:

```text
- apply without a discard manifest still fails on the existing blockers;
- valid discard entries change blocker details to `excluidos`;
- excluded clients/products/quotations never call MemoryFrappeMigrationRepository writes;
- a quotation using an excluded SKU is excluded even when it has no direct validation detail;
- unknown or stale discard entries fail before `repository.writes` changes;
- a clean quotation remains created and appears in reconciliation expectations.
```

Assert exact counts for the synthetic graph from Task 1.

- [ ] **Step 2: Run the focused tests and verify RED.**

Run:

```bash
node --test --import tsx tests/unit/frappe-migration.test.ts tests/unit/migration-discard.test.ts
```

Expected: new exclusion assertions fail while existing migration tests remain green.

- [ ] **Step 3: Add exclusion status and manifest metadata.**

Update `emptyEntityReport`, `finalizeReport`, `totalValue`, and `buildManifest` so exclusions are counted but do not make `entityFailed` true.
Keep `divergentes` and `erros` blocking when they are not represented in the discard manifest.

- [ ] **Step 4: Apply the validated discard plan before write planning.**

In `runFrappeMigration`:

1. Build normalized clients/products and quotation dependencies.
2. Validate the supplied manifest against the current source hash and dry-run report hash.
3. Mark excluded client and product/pricing details with `excluidos`.
4. Omit excluded product and client units from write planning.
5. Omit every quotation in the computed dependency closure.
6. Re-run blocker detection after exclusions and fail if any unexcluded blocker remains.
7. Build reconciliation expectations only from writable units.

Never use approval keys to silently convert financial or duplication blockers into writes.

- [ ] **Step 5: Run the focused tests and verify GREEN.**

Run:

```bash
node --test --import tsx tests/unit/frappe-migration.test.ts tests/unit/migration-discard.test.ts
```

Expected: PASS with zero writes for excluded units and unchanged fail-closed behavior without a manifest.

- [ ] **Step 6: Run API type-check and commit.**

```bash
npm run build:api
npm run type-check
git add api/_functions/lib/frappe-migration-core.ts api/_functions/frappe-migration.ts tests/unit/frappe-migration.test.ts tests/unit/migration-discard.test.ts
git commit -m "feat(migration): apply discard closure safely"
```

---

### Task 3: Add protected manifest generation and CLI loading

**Files:**
- Create: `scripts/create-migration-discard-manifest.mjs`
- Modify: `scripts/migrate-frappe-crm.mjs:1-110,260-315`
- Test: `tests/unit/migrate-frappe-cli.test.ts`
- Test: `tests/unit/migration-discard.test.ts`

**Interfaces:**
- CLI generator:

```text
node scripts/create-migration-discard-manifest.mjs \
  --report <dry-run-report.json> \
  --snapshot-manifest-hash <sha256> \
  --output <protected-discard-manifest.json>
```

- Migration CLI accepts `--discard-manifest <path>` in both modes and passes the parsed `DiscardManifest` to `runFrappeMigration`.
- `--fixture` remains dry-run-only.
- Generator output uses mode `0600`, refuses an existing output, and emits only path, checksum, and counts to stdout.

- [ ] **Step 1: Write failing CLI tests.**

Add tests for:

```text
- parseArgs accepts --discard-manifest and returns its path;
- apply still requires --expected-manifest-hash;
- malformed JSON, wrong schema version, stale hash, and unknown source key fail safely;
- generator refuses an existing output and writes mode 0600;
- CLI output contains exclusion counts but no raw source values.
```

- [ ] **Step 2: Run CLI tests and verify RED.**

```bash
node --test --import tsx tests/unit/migrate-frappe-cli.test.ts
```

Expected: new argument and generator tests fail.

- [ ] **Step 3: Implement generator and CLI wiring.**

Load the protected report, calculate the deterministic closure through `buildDiscardPlan`, attach the supplied source manifest hash and report checksum, and write the manifest atomically.
Do not accept a hand-edited report as a substitute for the manifest.
Add safe CLI error prefixes for manifest path, schema, hash, and validation failures.

- [ ] **Step 4: Run CLI tests and verify GREEN.**

```bash
node --test --import tsx tests/unit/migrate-frappe-cli.test.ts
```

Expected: PASS with no raw PII or secrets in stdout/stderr.

- [ ] **Step 5: Commit CLI support.**

```bash
git add scripts/create-migration-discard-manifest.mjs scripts/migrate-frappe-crm.mjs tests/unit/migrate-frappe-cli.test.ts tests/unit/migration-discard.test.ts
git commit -m "feat(migration): expose discard manifest CLI"
```

---

### Task 4: Make reconciliation prove exclusions

**Files:**
- Modify: `scripts/reconcile-migration.mjs:223-352,503-654`
- Test: `tests/unit/reconcile-migration.test.ts`
- Modify: `docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md:404-648`

**Interfaces:**
- `expectedReconciliation(manifest, label)` reads `manifest.exclusionCounts` and the exact exclusion closure.
- `compareReconciliation(input)` returns `excludedRowsMatch`, `excludedClosureHashMatch`, and `unapprovedExclusionKeys` alongside existing comparisons.
- Reconciliation fails when target contains lineage for an excluded key, when an excluded dependency is absent from the manifest, or when any unapproved blocker remains.

- [ ] **Step 1: Write failing reconciliation tests.**

Add fixtures for:

```text
- exact writable projections plus exact exclusion closure -> pass;
- target lineage contains an excluded quotation -> fail;
- excluded SKU is used by a target quotation -> fail;
- exclusion count or closure hash differs -> fail;
- unresolved divergence remains -> fail.
```

- [ ] **Step 2: Run the tests and verify RED.**

```bash
node --test --import tsx tests/unit/reconcile-migration.test.ts
```

Expected: new exclusion assertions fail.

- [ ] **Step 3: Implement comparison fields and guards.**

Preserve the existing approved-divergence checks.
Add exact exclusion checks without printing raw source identifiers.
Keep all artifacts outside the checkout with existing `0600`/`0700` guards.

- [ ] **Step 4: Run reconciliation tests and verify GREEN.**

```bash
node --test --import tsx tests/unit/reconcile-migration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update the runbook and commit.**

Document:

```text
- discard manifest generation from a protected dry-run;
- snapshot hash and report checksum binding;
- apply pre-write validation;
- dependency closure rules;
- exact reconciliation checks;
- explicit warning that source records remain in Frappe.
```

```bash
git add scripts/reconcile-migration.mjs tests/unit/reconcile-migration.test.ts docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md
git commit -m "docs: reconcile migration exclusions"
```

---

### Task 5: Validate the approved partial snapshot in staging

**Files:**
- Create outside checkout: protected discard manifest and dry-run/apply/reconciliation artifacts.
- Modify: `docs/superpowers/reports/2026-08-08-migracao-acceptance.md`
- Modify: `.superpowers/sdd/2026-08-08-fechamento-migracao-cutover/progress.md`

**Interfaces:**
- The final operational manifest is generated from a fresh live GET-only dry-run after fixture validation.
- Apply uses the live source and `--expected-manifest-hash`; it never uses `--fixture`.
- `CUTOVER_PG_SERVICE` must resolve to `aspen_test`.

- [ ] **Step 1: Run full local verification.**

```bash
npm run test:unit
npm run build:api
npm run type-check
npm run lint
npm run build
git diff --check
```

Expected: zero failures, existing lint warnings documented, no generated artifacts staged.

- [ ] **Step 2: Regenerate and validate the stable anonymized fixture.**

Use the protected salt file and the raw snapshot outside the repository.
Verify counts, safety scan, raw/anonymized identity-group parity, file mode `0600`, and checksum.
Do not print the fixture or its contents.

- [ ] **Step 3: Run fixture dry-run and generate a preview discard manifest.**

```bash
set +e
node scripts/migrate-frappe-crm.mjs --dry-run --fixture "$ANON_SNAPSHOT" \
  > "$CUTOVER_DIR/report.fixture.dry-run.json"
status=$?
set -e
[ "$status" -eq 1 ]
node scripts/create-migration-discard-manifest.mjs \
  --report "$CUTOVER_DIR/report.fixture.dry-run.json" \
  --snapshot-manifest-hash "$FIXTURE_MANIFEST_HASH" \
  --output "$CUTOVER_DIR/discard.fixture.json"
```

Expected: the unapproved preview exits `1`, then the generated closure contains 162 quotations and the approved client/product blocker roots.

- [ ] **Step 4: Run a fresh live GET-only dry-run.**

Use the existing protected ERPNext token, source cutoff, and staging database contract.
Persist only the protected report, manifest hash, counts, and checksums.
Abort if the live closure differs from the preview closure.

- [ ] **Step 5: Generate the final live discard manifest.**

Bind it to the live source manifest hash and live report checksum.
Require exact closure parity with the approved preview or stop for review.

- [ ] **Step 6: Apply and reconcile `aspen_test`.**

Run the existing database contract assertion, then:

```bash
node scripts/migrate-frappe-crm.mjs --apply \
  --expected-manifest-hash "$LIVE_MANIFEST_HASH" \
  --discard-manifest "$CUTOVER_DIR/discard.live.json"
node scripts/reconcile-migration.mjs \
  --manifest "$CUTOVER_DIR/report.apply.json" \
  --backup "$BACKUP_FILE" \
  --output "$CUTOVER_DIR/reconciliation.json"
```

Expected: only 56 products, 470 clients, 513 quotations, and their dependencies are writable.
Expected: zero unapproved blockers, exact exclusion closure, and no orphan lineage.

- [ ] **Step 7: Commit documentation evidence.**

```bash
git add docs/superpowers/reports/2026-08-08-migracao-acceptance.md .superpowers/sdd/2026-08-08-fechamento-migracao-cutover/progress.md
git commit -m "docs: record partial migration acceptance"
```

---

### Task 6: Resume cutover gates after partial reconciliation

**Files:**
- Modify: `docs/superpowers/reports/2026-08-08-migracao-acceptance.md`
- Existing tests/artifacts: `tests/quotation-cutover-staging.spec.js`, backup/restore reports, egress evidence.

**Interfaces:**
- E2E IDs must come only from the writable PostgreSQL subset.
- `STAGING_FIXTURE_RESET=1`, `STAGING_EGRESS_BLOCKED=1`, and `STAGING_EXTERNAL_PROVIDERS_DISABLED=1` remain mandatory.
- Canary and rollback stay disabled until backup, reconciliation, E2E, and egress evidence pass.

- [ ] **Step 1: Create non-PII known IDs from migrated rows.**

Select one migrated quotation and one disposable migrated scratch quotation from `aspen_test`.
Record only opaque IDs in the protected environment file.

- [ ] **Step 2: Run backup, restore, and reconciliation gates.**

Use the existing named PostgreSQL services and protected artifacts.
Verify checksums, database identities, expected writable counts, and exact exclusion closure.

- [ ] **Step 3: Run staging browser regression with Frappe egress blocked.**

Run the existing staging suite with provider variables empty and all staging attestations set to `1`.
Expected: PostgreSQL reads/writes pass, excluded records are absent, and no external provider request occurs.

- [ ] **Step 4: Execute staging canary and rollback.**

Enable `postgres-write` only in staging, create one internal quotation using a migrated product/client, verify revision/PDF/link behavior, then restore legacy rollout state.
Do not use excluded records or real external sends.

- [ ] **Step 5: Update acceptance report and run final diagnostics.**

Run `lens_diagnostics` with `mode=all` for edited files and record every command, artifact checksum, exclusion count, canary result, rollback result, and remaining limitation.

- [ ] **Step 6: Commit final evidence after independent scoped review.**

Review the new commits from `7d114f7` through the final evidence commit.
Resolve Critical and Important findings before merge.

---

## Definition of Done

- [ ] A protected discard manifest is required for intentional partial migration.
- [ ] No generic approval flag can silently represent all blockers.
- [ ] Manifest and closure hashes bind the decision to one source report.
- [ ] Exclusions are explicit in reports and reconciliation.
- [ ] No excluded client, product, pricing tier, quotation, or dependent item is written.
- [ ] No orphan quotation or lineage is created.
- [ ] Apply without a manifest or with a stale/incomplete manifest fails before writes.
- [ ] `aspen_test` contains only the reconciled writable subset.
- [ ] Frappe remains unchanged.
- [ ] Backup, restore, E2E, egress, canary, and rollback gates pass after the partial migration.
