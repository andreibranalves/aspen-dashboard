import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  createDisposableTestEnvironment,
  evaluatePostgresRun,
  isDisposablePostgresUrl,
  parseTapSkippedCount,
  runPostgresTests,
  selectPostgresTestFiles,
} from '../../scripts/test-postgres.mjs';

test('accepts only loopback PostgreSQL URLs for disposable runs', () => {
  assert.equal(isDisposablePostgresUrl('postgresql://postgres:postgres@127.0.0.1:5432/test'), true);
  assert.equal(isDisposablePostgresUrl('postgresql://postgres:postgres@localhost/test'), true);
  assert.equal(isDisposablePostgresUrl('postgresql://postgres:postgres@[::1]/test'), true);
  assert.equal(
    isDisposablePostgresUrl('postgresql://postgres:postgres@staging.example/test'),
    false
  );
  assert.equal(isDisposablePostgresUrl('https://localhost/test'), false);
});

test('isolates child database environment from operational targets', () => {
  const environment = createDisposableTestEnvironment(
    {
      DATABASE_URL: 'postgresql://production.example/prod',
      TEST_DATABASE_URL: 'postgresql://127.0.0.1/test',
      TEST_QUOTE_DATABASE_URL: 'postgresql://staging.example/stage',
      STAGING_DATABASE_URL: 'postgresql://staging.example/stage',
      PGPASSFILE: '/secret/.pgpass',
      OTHER_FLAG: 'preserved',
      PRODUCTION_PG_SERVICE: 'aspen-prod',
      OPENROUTER_API_KEY: 'sk-or-secret',
      KV_REST_API_TOKEN: 'kv-secret',
    },
    'postgresql://postgres:postgres@127.0.0.1:5432/test'
  );

  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.TEST_DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:5432/test');
  assert.equal(environment.TEST_QUOTE_DATABASE_URL, environment.TEST_DATABASE_URL);
  assert.equal(environment.STAGING_DATABASE_URL, undefined);
  assert.equal(environment.PGPASSFILE, undefined);
  assert.equal(environment.PRODUCTION_PG_SERVICE, undefined);
  assert.equal(environment.OPENROUTER_API_KEY, undefined);
  assert.equal(environment.KV_REST_API_TOKEN, undefined);
  assert.equal(environment.OTHER_FLAG, 'preserved');
});

test('reads the final TAP skipped count', () => {
  const output = ['# skipped 1', '# tests 2', '# skipped 0', '# tests 4'].join('\n');

  assert.equal(parseTapSkippedCount(output), 0);
});

test('accepts a successful PostgreSQL run without skipped tests', () => {
  const result = evaluatePostgresRun({
    status: 0,
    output: '# tests 4\n# pass 4\n# fail 0\n# skipped 0\n',
  });

  assert.deepEqual(result, { ok: true, skipped: 0 });
});

test('rejects a successful PostgreSQL run that skipped tests', () => {
  const result = evaluatePostgresRun({
    status: 0,
    output: '# tests 4\n# pass 3\n# fail 0\n# skipped 1\n',
  });

  assert.deepEqual(result, { ok: false, reason: 'skipped-tests', skipped: 1 });
});

test('rejects a run with test failures before checking skips', () => {
  const result = evaluatePostgresRun({
    status: 1,
    output: '# tests 4\n# pass 3\n# fail 1\n# skipped 0\n',
  });

  assert.deepEqual(result, { ok: false, reason: 'test-failure' });
});

test('selectPostgresTestFiles fails closed on empty or missing manifest', () => {
  const empty = selectPostgresTestFiles({ manifest: [], discovered: ['tests/unit/a-postgres.test.ts'] });
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /manifesto vazio ou ausente/);

  const missing = selectPostgresTestFiles({ manifest: null, discovered: ['tests/unit/a-postgres.test.ts'] });
  assert.equal(missing.ok, false);
});

test('selectPostgresTestFiles refuses a vacuous discovered set', () => {
  const result = selectPostgresTestFiles({ manifest: ['tests/unit/a-postgres.test.ts'], discovered: [] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /seleção vazia/);
});

test('selectPostgresTestFiles detects DB-gated files outside the manifest', () => {
  const result = selectPostgresTestFiles({
    manifest: ['tests/unit/a-postgres.test.ts'],
    discovered: [
      'tests/unit/a-postgres.test.ts',
      'tests/unit/b-new-db-gated.test.ts',
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /fora do manifesto/);
  assert.match(result.reason, /b-new-db-gated\.test\.ts/);
});

test('selectPostgresTestFiles rejects stale manifest entries', () => {
  const result = selectPostgresTestFiles({
    manifest: [
      'tests/unit/a-postgres.test.ts',
      'tests/unit/removed-postgres.test.ts',
    ],
    discovered: ['tests/unit/a-postgres.test.ts'],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /sem teste DB-gated correspondente/);
});

test('selectPostgresTestFiles returns the deterministic sorted selection', () => {
  const result = selectPostgresTestFiles({
    manifest: ['tests/unit/b-postgres.test.ts', 'tests/unit/a-postgres.test.ts'],
    discovered: ['tests/unit/a-postgres.test.ts', 'tests/unit/b-postgres.test.ts'],
  });
  assert.deepEqual(result, {
    ok: true,
    files: ['tests/unit/a-postgres.test.ts', 'tests/unit/b-postgres.test.ts'],
  });
});

test('runPostgresTests executes only the selected DB-gated files', () => {
  const calls = [];
  const tap = '# tests 1\n# pass 1\n# fail 0\n# skipped 0\n';
  const exitCode = runPostgresTests({
    env: { TEST_DATABASE_URL: 'postgresql://postgres@127.0.0.1/test' },
    execute: (command, args) => {
      calls.push(args.filter((arg) => arg.startsWith('tests/')));
      return { status: 0, stdout: tap, stderr: '' };
    },
  });

  assert.equal(exitCode, 0);
  const manifest = JSON.parse(readFileSync('scripts/test-postgres-manifest.json', 'utf8'));
  assert.deepEqual([...calls[0]].sort(), [...manifest].sort());
  assert.ok(manifest.length > 0);
});
