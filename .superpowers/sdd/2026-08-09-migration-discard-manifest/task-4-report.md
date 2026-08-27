# Task 4 Report: Reconciliation closure proof

> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../../../AGENTS.md) e [`docs/release-lanes.md`](../../../docs/release-lanes.md).

STATUS: DONE

## Initial implementation

Added exact exclusion-count and discard-closure validation to reconciliation.

Added guards for excluded target lineage, excluded-SKU quotation dependencies, missing closure dependencies, closure hash mismatch, and unapproved blockers.

Kept approved-divergence checks unchanged and persisted only opaque source-key tokens in reconciliation artifacts.

Updated the cutover runbook with protected discard-manifest generation, snapshot/report checksum binding, pre-write validation, dependency closure rules, exact reconciliation checks, and the warning that source records remain in Frappe.

## Fix round 1

Addressed review findings from `568ed9c..d85e54a`:

- Restored the repository-root `task-4-report.md` to its exact pre-reconciliation content and moved the reconciliation report to this SDD path.
- Bound `manifest.exclusionCounts` to counts derived from the validated discard closure when a closure projection is present.
- Rejected raw Customer and Lead closure keys and dependencies; only canonical lowercase `cliente-<12 hex>` identifiers are accepted for those doctypes.
- Added target dependency scanning across every target quotation and its revisions, including quotations absent from selected source lineage.
- Clarified the runbook distinction between the byte-level `report.dry-run.sha256` checksum and canonical `dryRunReportHash`.
- Preserved approved-divergence behavior, opaque reconciliation artifacts, external protected-artifact guards, and no-dependency policy.

## Tests and checks

Focused reconciliation tests passed with 16 tests.

The regression coverage verifies wrong exclusion counts, raw Customer and Lead keys and dependencies, canonical opaque keys, target quotations outside selected lineage, approved divergences, closure hashes, and unresolved blockers.

No source-system, production, staging, or PostgreSQL writes were performed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reconciliation closure validation, opaque key guards, all-target quotation dependency scanning, runbook terminology, and report placement were fixed without new dependencies or artifact-scope changes."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Focused reconciliation regressions cover every requested review finding and passed."
    }
  ],
  "changedFiles": [
    "scripts/reconcile-migration.mjs",
    "tests/unit/reconcile-migration.test.ts",
    "docs/superpowers/plans/2026-08-05-quotation-cutover-runbook.md",
    "task-4-report.md",
    ".superpowers/sdd/2026-08-09-migration-discard-manifest/task-4-report.md"
  ],
  "testsAddedOrUpdated": [
    "tests/unit/reconcile-migration.test.ts"
  ],
  "commandsRun": [
    {
      "command": "node --test --import tsx tests/unit/reconcile-migration.test.ts",
      "result": "passed",
      "summary": "16 tests passed"
    }
  ],
  "validationOutput": [
    "Root task-4-report.md matches git show 568ed9c:task-4-report.md exactly.",
    "Raw source identifiers are not included in closure validation errors or reconciliation artifacts."
  ],
  "residualRisks": [
    "PostgreSQL integration evidence still requires the protected staging environment described by the runbook."
  ],
  "noStagedFiles": true,
  "diffSummary": "Reconciliation now validates closure-derived exclusion counts and canonical client keys, scans all target quotation dependencies, and documents checksum semantics.",
  "reviewFindings": [],
  "manualNotes": "No source-system or database write was performed."
}
```

## Fix round 2

- Apply manifests now include the same opaque, hash-bound discard-plan projection as dry-run manifests.
- Reconciliation rejects non-zero exclusion counts when no discard plan is present instead of trusting supplied counts.
- Added regressions for missing-plan rejection and valid apply projection.
- Focused reconciliation and migration tests, API build, type-check, lint, and diff-check passed.
- No source-system, PostgreSQL, staging, or production writes were performed.
