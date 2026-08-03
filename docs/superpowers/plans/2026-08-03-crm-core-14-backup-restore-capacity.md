# CRM Core 14: comprovar backup, restauração e capacidade gratuita

Issue: #16
Parent spec: #2

## Prerequisites

- PostgreSQL client tools (`pg_dump`, `psql`, `createdb`, `dropdb`) must be installed on the machine running the backup/restore scripts.
  - Ubuntu/Debian: `sudo apt install postgresql-client`
  - macOS: `brew install libpq && echo 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"' >> ~/.zshrc`

## Global Constraints

- Brazilian Portuguese for all user-facing output.
- Scripts are standalone `.mjs` ESM files under `scripts/`.
- Tests use `node:test` with `node:assert/strict`.
- Never hardcode credentials — read from environment variables only.
- Use `postgres` (v3.4.9, per `api/_db/client.ts`) for PostgreSQL access; `@vercel/blob` for Blob quota queries.
- Free plan limits: 0.5 GB storage, 100 concurrent connections, 100 databases, 1 GB transfer/month (assume regular Neon free tier).

## Task 1: Backup, restore, and capacity preflight

Implement a documented backup/restore procedure and a capacity preflight that validates the system fits within Neon's free plan before go-live.

### Requirements

**Backup script** (`scripts/backup-crm.mjs`):

1. Read `DATABASE_URL` from environment — no argument that would leak the URL into shell history.
2. Execute `pg_dump` with flags: `--no-owner --no-acl --clean --if-exists --format=plain`.
3. Save to `backups/backup-{ISO-date}.sql` in the project root. Create `backups/` directory if absent.
4. Add `.gitignore` entry for `backups/` if not already present.
5. Report: file path, size in bytes, timestamp in ISO format, dump success/failure.
6. Exit with code 0 on success, non-zero on failure. Write errors to stderr.

**Retention policy** (`scripts/backup-crm.mjs`):

1. Read `BACKUP_RETENTION_DAYS` from environment (default: 30).
2. After successful dump, list all `backups/backup-*.sql` files and delete those older than retention.
3. Never delete files outside the `backups/` directory. Resolve the backup directory to its absolute path and only match files within it.
4. Report deleted files with their age in days.

**Restore validation** (`scripts/backup-crm.mjs --validate`):

1. Read dump file path from `--file` argument or default to the latest `backups/backup-*.sql`.
2. Restore to a NEW temporary database (create with `CREATE DATABASE`, restore, validate, drop). Requires `CREATEDB` privilege on the PostgreSQL instance.
3. **Fallback:** if `CREATE DATABASE` fails (CREATEDB not available on some Neon free tiers), create a fresh schema `restore_validate` within the existing database and restore into that schema instead. Run migration validation against the schema. Drop the schema after validation.
4. Run Drizzle migrations against the restored DB/schema: `npx drizzle-kit migrate`.
5. Validate essential counts: `SELECT count(*)` from `products`, `clients`, `quotations`, `quote_revisions`, `quote_revision_items`, `issued_documents`, `frappe_import_lineage`.
6. Report counts with pass/fail for structural integrity.
7. If any migration fails, report the error and exit non-zero.

**Capacity preflight** (`scripts/backup-crm.mjs --preflight`):

1. Query PostgreSQL size: `SELECT pg_database_size(current_database())` and convert to MB.
2. Query active connections: `SELECT count(*) FROM pg_stat_activity` and compare against `PREFLIGHT_MAX_CONNECTIONS` (default: 100).
3. Query Blob store usage: list all blobs (with `@vercel/blob`'s `list` API, requires `BLOB_READ_WRITE_TOKEN` or `QUOTATION_BLOB_READ_WRITE_TOKEN` env var) and sum their sizes. Handle pagination. Missing Blob token produces AVISO instead of hard error.
4. Transfer estimation: monthly data transfer (1 GB on Neon free tier) is not reliably measurable before production traffic exists. Report "AVISO — não mensurável antes de operação" and never block go-live on this metric.
5. Compare against configured quotas (env vars with sensible defaults matching Neon free plan):
   - `PREFLIGHT_MAX_DB_SIZE_MB` (default: 512)
   - `PREFLIGHT_MAX_BLOB_SIZE_MB` (default: 512)
   - `PREFLIGHT_MAX_CONNECTIONS` (default: 100)
6. Report in Portuguese: status (OK / AVISO / CRÍTICO) per metric.
7. If any storage or connection metric exceeds its quota, exit with code 1 and print `CAPACIDADE INSUFICIENTE. Go-live bloqueado.` to stderr.
8. Never suggest automatic deletion of records or blobs to fit quotas.

**Tests** (`tests/unit/backup.test.ts`):

1. Test dump generation with a test database (requires `TEST_DATABASE_URL`).
2. Test retention: create fake backup files with known ages, verify only old ones are deleted.
3. Test retention safety: verify files outside `backups/` are never touched.
4. Test preflight capacity decisions with known PostgreSQL size and blob size fixtures.
5. Test preflight blocks go-live (exit code 1) when limits exceeded.
6. Test restore validation detects structural issues (missing table, wrong column count).
7. Test connection count query against `PREFLIGHT_MAX_CONNECTIONS` quota.
8. Test Blob token missing case produces AVISO, not hard error.
9. Test restore fallback: when CREATEDB is unavailable, schema-based validation succeeds.

**Fixtures**:

1. Fixture for preflight: mock blob list response and database size query.
2. Fixture for retention: set of `backup-*.sql` files with known timestamps.

### Verifications

- `npm run lint && npm run test:unit` must pass.
- `node scripts/backup-crm.mjs` must succeed in an environment with `DATABASE_URL` pointing to PostgreSQL.
- `node scripts/backup-crm.mjs --preflight` must report realistic capacity metrics.
- Retention must never delete files outside the backups directory.
