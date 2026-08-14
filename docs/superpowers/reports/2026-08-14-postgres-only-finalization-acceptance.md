# PostgreSQL-Only Finalization Acceptance

## Git integration

- Commit `d2f56a4d8387a8aa58737f065a230bff4d43d33b`: PASS.
- Commit `95a6b9a9996eddc254fc343fef2635119d89596d`: PASS.
- Commit `7ad8aa605c271b62b0888b0e33f3fb608cca4fd8`: PASS.
- Commit `a993567c2903f711ad883cb625f4eb84b1822e5a`: PASS.
- Commit `5a029d1`: PASS; quotation section-base ordering fix.
- Commit `8606d53`: PASS; regression fixture typing.
- Commit `23c5feb`: PASS; canary metadata detection fix.
- Historical ledger updated at `.worktrees/postgres-only-removal/.superpowers/sdd/2026-08-10-remocao-definitiva-frappe/progress.md`: Task 9 and Task 10 closed; historical branch integrated by squash/manual commit into `de0d4f6`, not ancestry merge.

## Local verification

- `TZ=UTC node --test --test-name-pattern='reports deterministic labels without matched content or PII' tests/unit/check-no-legacy-provider.test.js`: 20/20 PASS; 1 test/run; 0 failures.
- `TZ=UTC node --test tests/unit/*.test.{js,ts}` run 1/3: 674 tests; 645 passed; 0 failed; 29 skipped; PASS.
- `TZ=UTC node --test tests/unit/*.test.{js,ts}` run 2/3: 674 tests; 645 passed; 0 failed; 29 skipped; PASS.
- `TZ=UTC node --test tests/unit/*.test.{js,ts}` run 3/3: 674 tests; 645 passed; 0 failed; 29 skipped; PASS.
- Latest local unit run: 692 tests; 663 passed; 0 failed; 29 skipped.
- Three consecutive latest local unit runs: 692 tests; 663 passed; 0 failed; 29 skipped each.
- PostgreSQL draft-management integration run against staging: 1/1 passed after the section-base ordering fix.
- Protected evidence path: `/root/aspen-staging-evidence/2026-08-10` on staging KVM 1; raw rollback files remain outside the evidence directory.
- Protected staging database backup: `/root/aspen-staging-backup/staging-database-before-0018-0019.dump`.

## Staging deployment

- Status: PASS.
- Hostinger KVM 1 rebooted and recovered; `aspen-staging` and Traefik are running, health returns HTTP 200.
- Build from commit `5a029d1` deployed to the staging container.
- Evolution remains stopped; rollback is `docker compose start` from its project directory.
- PostgreSQL migrations 0018 and 0019 applied after the protected backup; final migration count is 20.
- Synthetic staging fixtures were created through the application lifecycle.
- Staging PostgreSQL credential rotated, old Neon password rejected, new password accepted.

## Staging egress

- Status: PASS.
- Custom `inet aspen_staging` input, output and forward chains use default `drop` policies.
- Unrestricted Docker-bridge DNS and HTTPS allows were removed; only established/related forwarding remains.
- nftables syntax, enabled service, PostgreSQL `select 1`, KV `/ping` and staging HTTPS probes passed.
- Unlisted DNS probe to `9.9.9.9:53` and Frappe HTTPS probe were blocked at network level.
- Reboot persistence passed: service enabled/active, app and Traefik running after reboot, health HTTP 200, Evolution stopped.
- Protected evidence includes `probes.json`, `firewall-final.sha256`, `staging-e2e.log`, `staging-quotation-final.log` and `evidence.sha256` under `/root/aspen-staging-evidence/2026-08-10`.
- Final staging container ID prefix: `797d33f450c2`; deployed commit marker: `5a029d1`; firewall ruleset SHA-256: `c6ce301044bc46c44989aafb7a758a4061497e67e54b499399a9374cc45505ce`.
- Final staging quotation suite passed 2/2 after final credential rotation; earlier full staging suite passed 10/10.

## Production backup and deployment

- Status: PASS.
- Protected Production backup and checksum verified: `$HOME/.local/share/aspen-dashboard/postgres-only-finalization-20260814/backups/backup-2026-08-14T15-05-43-351Z.sql`, SHA-256 `012e4ebf3df5a4ce0639d629929edffb9eae75c3a337ba910653e5b42c93ffe4`.
- Preflight, backup, migration and checksum command logs are protected in the same directory with mode `0600`.
- Production migrations 0018 and 0019 applied after backup; final migration count is 20.
- Final Production deployment: `dpl_EFZEMr79YnVYUxNxHJafP9X4nUVV`, commit `23c5feb`.
- Production domains point to the final PostgreSQL-only build.
- Previous rollback candidate: `dpl_9wytFmfpcHK5smL319dMqjUBKsqb`.
- Cleanup preview: `dpl_FGWHThE9zWX75WsyCrLkBLnBudzv`; post-cleanup promotion: `dpl_73RoL3RSLRHQnq5GM5VCeTB4ND4w`.

## Production canary

- Status: PASS.
- Pre-cleanup read-only canary log: `production-canary-after-promotion.json`, 10/10.
- Post-cleanup read-only canary log: `production-canary-after-cleanup.json`, 10/10.
- Final DB-rotation read-only canary log: `production-canary-final-db-rotation.json`, 10/10.
- Final read-only canary checks: login, operational status, products, leads/clients, quotation, PDF revision binding, CRM deals, sales orders, sales dashboard and public quotation.
- No WhatsApp, Typebot or provider capture call was made.
- Temporary public canary token was revoked after verification; follow-up request returned HTTP 404.

## Vercel environment cleanup

- Status: PASS.
- Forbidden legacy names absent from development, preview and production.
- Removed names: `ERPNEXT_TOKEN` from preview/production; `CRM_CORE_PRODUCTS_ENABLED` from production; `CRM_CORE_QUOTES_ENABLED` and `CRM_QUOTES_ROLLOUT_STATE` from preview/production.
- Plaintext `APP_PASSWORD` removed from preview/production; `APP_PASSWORD_HASH` is encrypted and targets preview/production.
- Production and preview database variables synchronized to the final rotated Neon credential.

## Credential revocation

- Status: PASS for executed issuers.
- Frappe token revoked through the User REST resource; old token verification returned HTTP 401.
- Old Neon password rejected; final Neon password accepted by the database.
- Old E2E password rejected; rotated Production password accepted.
- Hostinger API token issuer does not expose a configured revocation tool; manual hPanel rotation remains recommended.

## Residual risks

- Vercel runtime still emits the pre-existing Node `url.parse()` deprecation warning; no functional or security failure observed.
- Hostinger API token rotation requires hPanel/API-issuer access outside the configured MCP surface.
