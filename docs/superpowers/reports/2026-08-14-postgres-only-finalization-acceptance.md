# PostgreSQL-Only Finalization Acceptance

## Git integration

- Commit `d2f56a4d8387a8aa58737f065a230bff4d43d33b`: PASS.
- Commit `95a6b9a9996eddc254fc343fef2635119d89596d`: PASS.
- Commit `7ad8aa605c271b62b0888b0e33f3fb608cca4fd8`: PASS.
- Commit `a993567c2903f711ad883cb625f4eb84b1822e5a`: PASS.

## Local verification

- `TZ=UTC node --test --test-name-pattern='reports deterministic labels without matched content or PII' tests/unit/check-no-legacy-provider.test.js`: 20/20 PASS; 1 test/run; 0 failures.
- `TZ=UTC node --test tests/unit/*.test.{js,ts}` run 1/3: 674 tests; 645 passed; 0 failed; 29 skipped; PASS.
- `TZ=UTC node --test tests/unit/*.test.{js,ts}` run 2/3: 674 tests; 645 passed; 0 failed; 29 skipped; PASS.
- `TZ=UTC node --test tests/unit/*.test.{js,ts}` run 3/3: 674 tests; 645 passed; 0 failed; 29 skipped; PASS.
- Latest local unit run: 690 tests; 661 passed; 0 failed; 29 skipped.
- PostgreSQL draft-management integration run against staging: 1/1 passed after the section-base ordering fix.
- Protected evidence path: `/root/aspen-staging-evidence/2026-08-10` on staging KVM 1; raw rollback files remain outside the evidence directory.
- Protected staging database backup: `/root/aspen-staging-backup/staging-database-before-0018-0019.dump`.

## Staging deployment

- Status: PASS for exercised staging gates; reboot persistence remains pending.
- Hostinger KVM 1 confirmed as staging: `aspen-staging` and Traefik are running, the staging route returns HTTP 200, and the health route returns HTTP 200.
- Build from commit `5a029d1` deployed to the staging container.
- Evolution was stopped reversibly after explicit approval; all three containers are exited and the rollback command is `docker compose start` from its project directory.
- PostgreSQL migrations 0018 and 0019 applied after the protected backup.
- Synthetic staging product, client and quotation fixtures were created through the application lifecycle.
- No Production change, deployment or provider capture call was executed.

## Staging egress

- Status: PASS for exercised egress and E2E gates; Docker reboot persistence remains pending.
- Custom `inet aspen_staging` input, output and forward chains use default `drop` policies.
- Unrestricted Docker-bridge DNS and HTTPS allows were removed; only established/related forwarding remains.
- nftables syntax, enabled service, PostgreSQL `select 1`, KV `/ping` and staging HTTPS probes passed.
- An unlisted HTTPS probe was blocked.
- The final staging suites passed 10/10 with one worker.
- Docker restart/reboot persistence was not exercised; the policy file and enabled service remain present.

## Production backup and deployment

- Status: PENDING.

## Production canary

- Status: PENDING.

## Vercel environment cleanup

- Status: PENDING.

## Credential revocation

- Status: PENDING.

## Residual risks

- Status: PENDING staging and Production gates.
