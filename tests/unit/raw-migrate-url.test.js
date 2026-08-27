import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRawMigrateDatabaseUrl } from '../../scripts/lib/raw-migrate-url.mjs';

test('raw apply accepts disposable loopback TEST_DATABASE_URL', () => {
  const url = 'postgresql://postgres:postgres@127.0.0.1:5432/aspen_test';
  assert.equal(resolveRawMigrateDatabaseUrl({ TEST_DATABASE_URL: url }), url);
});

test('raw apply fails closed without TEST_DATABASE_URL', () => {
  assert.throws(
    () => resolveRawMigrateDatabaseUrl({}),
    /exige TEST_DATABASE_URL apontando para um PostgreSQL local descartável/,
  );
});

test('raw apply rejects remote operational targets (staging/production)', () => {
  assert.throws(
    () =>
      resolveRawMigrateDatabaseUrl({
        TEST_DATABASE_URL: 'postgresql://operator:x@staging.test:5433/aspen_stage',
      }),
    /deve apontar para um PostgreSQL local descartável/,
  );
  assert.throws(
    () =>
      resolveRawMigrateDatabaseUrl({
        TEST_DATABASE_URL: 'not-a-postgres-url',
      }),
    /deve apontar para um PostgreSQL local descartável/,
  );
});
