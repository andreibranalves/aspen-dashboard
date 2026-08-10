# SDD ledger — plan: docs/superpowers/plans/2026-08-08-fechamento-migracao-cutover.md

## Setup

- Workspace: `.superpowers/sdd/2026-08-08-fechamento-migracao-cutover`
- Branch: `feature/migracao-sem-frappe`
- Starting HEAD: `68e074e`
- Design: `docs/superpowers/specs/2026-08-08-fechamento-migracao-cutover-design.md`
- Plan: `docs/superpowers/plans/2026-08-08-fechamento-migracao-cutover.md`
- User decisions: use `STAGING_DATABASE_URL` explicitly; use this plan's ledger; normalize mechanical plan details before implementation.
- Global constraints: PostgreSQL internal CRM; no external CRM/N8N/Evolution; no secrets/PII/raw payloads; rollout disabled until gates pass.

## Task status

- Tasks 1 through 9: complete in the predecessor migration worktrees with focused reviews recorded in their SDD ledgers.
- Task 10: complete for real migration apply, backup, restore and reconciliation.
- Task 11: staging PostgreSQL canary and controlled rollback-read scenarios complete.
- Task 11: independent Frappe egress-deny evidence and operational approval complete.
- Task 12: acceptance report updated with migration, restore, reconciliation, staging and full-cutover evidence.
- Production-target canary passed and rollback restored the previous Production aliases and legacy flags.
- Production database apply, reconciliation, authenticated canaries and alias promotion completed.

## Preflight

- Worktree verified and clean at setup.
- Plan conflict scan completed before Task 1.
- Environment target ambiguity resolved in favor of `STAGING_DATABASE_URL`.
- Acceptance ledger path resolved to this workspace.
- Mechanical plan corrections committed in `68e074e`.

Task 1: fix round 1/5 (2 addressed, 0 open; commits `ff6d9a4`..`16ceb1a`)

Task 1: complete (commits `ff6d9a4`..`16ceb1a`, review clean)

Task 2: fix round 1/5 (4 addressed, 0 open; commits `774d1f8`..`1b4e64a`)

Task 2: complete (commits `774d1f8`..`1b4e64a`, review clean)

Task 3: fix round 1/5 (6 addressed, 2 open; commits `7a644fb`..`8e6e327`)

Task 3: fix round 2/5 (2 addressed, 0 open; commits `8e6e327`..`b1b109a`)

Task 3: complete (commits `7a644fb`..`b1b109a`, review clean)

Task 4: fix round 1/5 (4 addressed, 1 open; commits `d716ef3`..`9764ffa`)

Task 4: fix round 2/5 (1 addressed, 0 open; commits `9764ffa`..`f3359e0`)

Task 4: complete (commits `d716ef3`..`f3359e0`, review clean)

Task 5: minor (deferred): public-token test uses frozen old snapshot rather than repository-backed historical read; exact revision loader is covered statically and staging/backup validation remains later.

Task 5: minor (deferred): pre-existing PostgreSQL lifecycle test expects `enviado` for a new `rascunho`; separate cleanup belongs to full integration verification.

Task 5: complete (commits `6d85690`..`f184d4b`, review clean; 2 deferred minors)

Task 6: fix round 1/5 (3 addressed, 0 open; commits `c9f79cc`..`7b2c5df`)

Task 6: complete (commits `c9f79cc`..`7b2c5df`, review clean)

Task 7: fix round 1/5 (6 addressed, 0 open; commits `9ac2814`..`e5ace31`)

Task 7: complete (commits `9ac2814`..`e5ace31`, review clean)

Task 8: fix round 1/5 (3 addressed, 2 open; commits `99bc657`..`fafacdc`)

Task 8: fix round 2/5 (2 addressed, 2 open; commits `fafacdc`..`dd23ec1`)

Task 8: fix round 3/5 (2 addressed, 0 open; commits `dd23ec1`..`72456bb`)

Task 8: complete (commits `99bc657`..`72456bb`, review clean)

Task 9: fix round 1/5 (10 addressed, 4 open; commits `73a738e`..`2958361`)

Task 9: fix round 2/5 (4 addressed, 3 open; commits `2958361`..`7a3204f`)

Task 9: fix round 3/5 (3 addressed, 0 open; commits `7a3204f`..`8b9d8d9`)

Task 9: complete (commits `73a738e`..`8b9d8d9`, review clean)
- Task 1 implementer report: `task-1-report.md`.
- Task 1 implementation commit: `ff6d9a4`.
- Task 1 focused tests and build checks passed; PostgreSQL integration tests skipped without `TEST_DATABASE_URL`.

Task 10: implementation and operational hardening complete through commit `5992704`; synthetic reconciliation, staging backup/restore, focused tests and local verification passed.

Task 10 residual gate: real Frappe apply/reconciliation completed and reconciled.

Task 11: production-target canary and rollback complete; full cutover direct/live canaries and alias promotion complete.

Task 12: acceptance report updated with verified evidence and full-cutover closure.

## Final operational closure

- Real apply completed against isolated `aspen_test` with zero blockers and zero errors.
- Backup and restore validation passed against isolated `aspen_restore`.
- Reconciliation v5 passed with matching hashes, expected closure counts and zero invalid lineage.
- PostgreSQL draft-management integration passed with synchronized legacy fields and section snapshots.
- Core-mode staging E2E passed for detail, PDF, public link, outbox and revision edit.
- Rollback-compatible legacy-read E2E passed in a separate temporary rollback deployment.
- Preview was restored to legacy rollout with SSO protection enabled.
- N8N, Evolution and outbox provider variables were removed from Preview.
- Hostinger KVM 1 staging API is deployed behind Traefik with Evolution stopped and preserved.
- Persisted host and Docker egress policy has input, output and forward `drop` chains.
- PostgreSQL and KV probes pass while Frappe TCP probe is blocked.
- Egress policy survives service restart and controlled VPS reboot.
- Core staging E2E passes 2 tests after reboot and disposable fixture cleanup returns zero rows.
- Production-target canary passed one synthetic non-financial quotation through create, emission, PDF, public link, outbox and revision paths.
- Canary cleanup removed the quotation, 3 synthetic clients and 9 orphan outbox rows; verification found zero remaining canary records.
- Previous Production deployment remained available as the rollback target.
- Production database apply and reconciliation passed with zero blockers; two stale lineage rows inside the approved closure were removed while clients were preserved.
- Password hash rotation was explicitly approved and validated by live login `200`; plaintext password was removed after use.
- Direct and live authenticated canaries passed create, emission, PDF, public link, outbox fail-closed, revision and cleanup checks.
- All four Production aliases now point to the final `READY` deployment.
- Production flags are `true` and `postgres-write`; temporary Vercel automation bypass is disabled and provider variables remain absent.
