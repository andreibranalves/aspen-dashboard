import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TEST_DATABASE_CANDIDATE_KEYS,
  requireMatchingDisposableTestDatabaseUrl,
  resolveDisposableTestDatabaseUrl,
} from '../support/disposable-postgres.js';

const DISPOSABLE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/aspen_test';

test('accepts loopback PostgreSQL URLs unchanged', () => {
  assert.equal(
    resolveDisposableTestDatabaseUrl({ TEST_DATABASE_URL: DISPOSABLE_URL }),
    DISPOSABLE_URL
  );
  assert.equal(
    resolveDisposableTestDatabaseUrl(
      { TEST_DATABASE_URL: 'postgresql://postgres@localhost/aspen_test' },
      ['TEST_DATABASE_URL']
    ),
    'postgresql://postgres@localhost/aspen_test'
  );
  assert.equal(
    resolveDisposableTestDatabaseUrl(
      { TEST_DATABASE_URL: 'postgresql://postgres@[::1]:55432/t' },
      ['TEST_DATABASE_URL']
    ),
    'postgresql://postgres@[::1]:55432/t'
  );
});

test('returns undefined when no candidate key is configured', () => {
  assert.equal(resolveDisposableTestDatabaseUrl({}), undefined);
  assert.equal(resolveDisposableTestDatabaseUrl({ TEST_DATABASE_URL: '' }), undefined);
  assert.equal(resolveDisposableTestDatabaseUrl({ TEST_DATABASE_URL: '   ' }), undefined);
});

test('throws fail-closed on remote targets, wrong schemes and malformed URLs', () => {
  for (const bad of [
    'postgresql://postgres:secret@staging.example:5432/aspen',
    'postgresql://postgres@10.0.0.8/aspen',
    'postgres://operator:secret@db.internal.internal/aspen',
    'mysql://localhost:3306/aspen',
    'https://localhost/aspen',
    'postgresql://',
  ]) {
    assert.throws(
      () => resolveDisposableTestDatabaseUrl({ TEST_DATABASE_URL: bad }, ['TEST_DATABASE_URL']),
      /local descartável/
    );
  }
});

test('resolves candidates in priority order', () => {
  const keys = ['TEST_QUOTE_DATABASE_URL', 'TEST_DATABASE_URL'];
  const env = { TEST_QUOTE_DATABASE_URL: DISPOSABLE_URL, TEST_DATABASE_URL: 'not-a-url' };
  assert.equal(resolveDisposableTestDatabaseUrl(env, keys), DISPOSABLE_URL);

  const onlyBase = { TEST_DATABASE_URL: 'postgresql://localhost/base' };
  assert.equal(
    resolveDisposableTestDatabaseUrl(onlyBase, keys),
    'postgresql://localhost/base'
  );

  // A blank alias is not selected even though it is first in priority.
  assert.equal(
    resolveDisposableTestDatabaseUrl(
      { TEST_QUOTE_DATABASE_URL: ' ', TEST_DATABASE_URL: 'postgresql://[::1]/t' },
      keys
    ),
    'postgresql://[::1]/t'
  );
});

test('default candidate list only consults TEST_DATABASE_URL', () => {
  assert.deepEqual(DEFAULT_TEST_DATABASE_CANDIDATE_KEYS, ['TEST_DATABASE_URL']);
  assert.equal(
    resolveDisposableTestDatabaseUrl({ TEST_SALES_DATABASE_URL: 'postgresql://127.0.0.1/sales' }),
    undefined
  );
});

test('quotation-origin E2E target guard rejects operational or mismatched targets before DB setup', () => {
  let connectionCalls = 0;
  let migrationCalls = 0;
  const openAndMigrate = (env) => {
    const target = requireMatchingDisposableTestDatabaseUrl(env);
    connectionCalls += 1;
    migrationCalls += 1;
    return target;
  };

  for (const env of [
    { DATABASE_URL: 'postgresql://synthetic.invalid/operational' },
    {
      TEST_DATABASE_URL: 'postgresql://synthetic.invalid/operational',
      DATABASE_URL: 'postgresql://synthetic.invalid/operational',
    },
    {
      TEST_DATABASE_URL: 'postgresql://127.0.0.1:55433/aspen_test',
      DATABASE_URL: 'postgresql://synthetic.invalid/operational',
    },
  ]) {
    assert.throws(() => openAndMigrate(env), /TEST_DATABASE_URL|DATABASE_URL/);
  }

  assert.equal(connectionCalls, 0);
  assert.equal(migrationCalls, 0);
  assert.equal(
    openAndMigrate({
      TEST_DATABASE_URL: 'postgresql://127.0.0.1:55433/aspen_test',
      DATABASE_URL: 'postgresql://127.0.0.1:55433/aspen_test',
    }),
    'postgresql://127.0.0.1:55433/aspen_test',
  );
  assert.equal(connectionCalls, 1);
  assert.equal(migrationCalls, 1);
});
