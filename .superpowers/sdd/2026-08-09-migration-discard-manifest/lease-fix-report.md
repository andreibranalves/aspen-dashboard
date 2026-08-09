# Migration lease idle-timeout fix

Implemented a migration-only PostgreSQL connection with `idle_timeout: 0` for session advisory leases.

The normal application connection remains configured with `idle_timeout: 20`.

Added a fast regression test covering the migration connection option and acquire/release lease seam without database writes.

No staging, source, or database writes were performed.

Validation passed for focused migration tests, API build, type-check, touched-file lint, and `git diff --check`.

Integration PostgreSQL tests remained skipped because `TEST_DATABASE_URL` was not configured.

Added a conditional PostgreSQL integration regression test that acquires a session advisory lease through the public repository interface, waits 21 seconds, verifies the backend session remains unchanged, and releases the lease without data writes.
The test has a bounded 35-second timeout and closes its migration connection cleanly.
