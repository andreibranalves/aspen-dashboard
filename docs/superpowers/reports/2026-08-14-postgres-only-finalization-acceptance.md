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
- Protected evidence path: `/root/aspen-staging-evidence/2026-08-10` on staging KVM 1; raw rollback files remain outside the evidence directory.

## Staging deployment

- Status: BLOCKED pending staging E2E credentials and disposable quotation identifiers.
- Hostinger KVM 1 confirmed as staging: `aspen-staging` and Traefik are running, the staging route returns HTTP 200, and the health route returns HTTP 200.
- Evolution was stopped reversibly after explicit approval; all three containers are exited and the rollback command is `docker compose start` from its project directory.
- No database migration, deployment, Production change or provider capture call was executed.

## Staging egress

- Status: PARTIAL - persisted deny policy applied; acceptance E2E remains pending.
- Custom `inet aspen_staging` input, output and forward chains use default `drop` policies.
- Unrestricted Docker-bridge DNS and HTTPS allows were removed; only established/related forwarding remains.
- nftables syntax, enabled service, PostgreSQL `select 1`, KV `/ping` and staging HTTPS probes passed.
- An unlisted HTTPS probe was blocked.
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
