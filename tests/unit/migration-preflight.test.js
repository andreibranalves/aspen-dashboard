import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  formatMigrationPreflight,
  formatMigrationPreflightFailure,
  runMigrationPreflight,
} from '../../scripts/migration-preflight.mjs';

const secret = 'sentinel-secret-value';
const fixedNow = () => new Date('2026-08-18T12:00:00.000Z');

function withProtectedFiles(callback) {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-preflight-'));
  const serviceFile = path.join(root, 'pg_service.conf');
  const passFile = path.join(root, '.pgpass');
  writeFileSync(serviceFile, '[staging]\nhost=staging.test\nport=5433\ndbname=aspen_stage\n');
  writeFileSync(passFile, `staging.test:5433:aspen_stage:operator:${secret}\n`);
  chmodSync(serviceFile, 0o600);
  chmodSync(passFile, 0o600);
  try {
    return callback({ serviceFile, passFile });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function completeEnv(serviceFile, passFile) {
  return {
    STAGING_DATABASE_URL: `postgresql://operator:${secret}@staging.test:5433/aspen_stage`,
    STAGING_PG_SERVICE: 'staging',
    PRODUCTION_DATABASE_URL: `postgresql://operator:${secret}@prod.test:5433/aspen_prod`,
    PGSERVICEFILE: serviceFile,
    PGPASSFILE: passFile,
    DATABASE_URL: `postgresql://operator:${secret}@prod.test:5433/aspen_prod`,
    TEST_DATABASE_URL: `postgresql://operator:${secret}@wrong.test/wrong`,
  };
}

test('requires every staging target input', () => {
  for (const missing of [
    'STAGING_DATABASE_URL',
    'STAGING_PG_SERVICE',
    'PRODUCTION_DATABASE_URL',
    'PGSERVICEFILE',
    'PGPASSFILE',
  ]) {
    const env = {
      STAGING_DATABASE_URL: 'postgresql://staging.test/aspen_stage',
      STAGING_PG_SERVICE: 'staging',
      PRODUCTION_DATABASE_URL: 'postgresql://prod.test/aspen_prod',
      PGSERVICEFILE: '/missing/service',
      PGPASSFILE: '/missing/pass',
    };
    delete env[missing];
    assert.throws(
      () => runMigrationPreflight({ env, execute: () => '', now: fixedNow }),
      new RegExp(missing)
    );
  }
});

test('rejects insecure PostgreSQL files', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    chmodSync(passFile, 0o644);
    assert.throws(
      () =>
        runMigrationPreflight({
          env: completeEnv(serviceFile, passFile),
          execute: () => 'aspen_stage\n',
          now: fixedNow,
        }),
      /PGPASSFILE.*0600/
    );
  });
});

test('rejects a divergent hostaddr override', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    writeFileSync(
      serviceFile,
      '[staging]\nhost=staging.test\nhostaddr=192.0.2.10\nport=5433\ndbname=aspen_stage\n'
    );
    assert.throws(
      () =>
        runMigrationPreflight({
          env: completeEnv(serviceFile, passFile),
          execute: () => 'aspen_stage\n',
          now: fixedNow,
        }),
      /não pode sobrescrever host com hostaddr/
    );
  });
});

test('rejects missing service section and URL-service divergence', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    const env = completeEnv(serviceFile, passFile);
    assert.throws(
      () =>
        runMigrationPreflight({
          env: { ...env, STAGING_PG_SERVICE: 'missing' },
          execute: () => 'aspen_stage\n',
          now: fixedNow,
        }),
      /STAGING_PG_SERVICE não informa host e database/
    );
    assert.throws(
      () =>
        runMigrationPreflight({
          env: {
            ...env,
            STAGING_DATABASE_URL: `postgresql://operator:${secret}@other.test:5433/aspen_stage`,
          },
          execute: () => 'aspen_stage\n',
          now: fixedNow,
        }),
      /não apontam para o mesmo destino/
    );
  });
});

test('rejects production identity and unexpected current database', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    const env = completeEnv(serviceFile, passFile);
    assert.throws(
      () =>
        runMigrationPreflight({
          env: { ...env, PRODUCTION_DATABASE_URL: env.STAGING_DATABASE_URL },
          execute: () => 'aspen_stage\n',
          now: fixedNow,
        }),
      /produção/
    );
    assert.throws(
      () =>
        runMigrationPreflight({
          env,
          execute: () => 'unexpected_database\n',
          now: fixedNow,
        }),
      /database inesperado/
    );
  });
});

test('localizes malformed percent-encoded target URLs', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    const env = completeEnv(serviceFile, passFile);
    for (const key of ['STAGING_DATABASE_URL', 'PRODUCTION_DATABASE_URL']) {
      assert.throws(
        () =>
          runMigrationPreflight({
            env: {
              ...env,
              [key]: `postgresql://operator:${secret}@staging.test:5433/aspen_%ZZ`,
            },
            execute: () => 'aspen_stage\n',
            now: fixedNow,
          }),
        (error) => {
          assert.match(error.message, new RegExp(`${key} inválida\\.`));
          const output = formatMigrationPreflightFailure(error, fixedNow);
          assert.match(output, /FAIL preflight de migration: .*inválida\./);
          assert.doesNotMatch(output, /URI malformed|URIError|staging\.test|%ZZ/);
          assert.doesNotMatch(output, new RegExp(secret));
          return true;
        }
      );
    }

    const output = formatMigrationPreflightFailure(new URIError('URI malformed'), fixedNow);
    assert.match(output, /FAIL preflight de migration: URL PostgreSQL inválida\./);
    assert.doesNotMatch(output, /URI malformed|URIError/);
  });
});

test('hides tool failures and all sensitive values', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    const env = completeEnv(serviceFile, passFile);
    assert.throws(
      () =>
        runMigrationPreflight({
          env,
          execute: () => {
            throw new Error(`psql leaked ${secret} staging.test`);
          },
          now: fixedNow,
        }),
      (error) => {
        assert.match(error.message, /Falha ao validar database efetivo/);
        const output = formatMigrationPreflightFailure(error, fixedNow);
        assert.match(output, /2026-08-18T12:00:00.000Z/);
        assert.match(output, /FAIL preflight de migration/);
        assert.doesNotMatch(output, new RegExp(secret));
        assert.doesNotMatch(output, /staging\.test/);
        return true;
      }
    );
  });
});

test('runs one read-only database identity query and emits redacted evidence', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    const env = completeEnv(serviceFile, passFile);
    let calls = 0;
    const result = runMigrationPreflight({
      env,
      now: fixedNow,
      execute(file, args, options) {
        calls += 1;
        assert.equal(file, 'psql');
        assert.deepEqual(args, [
          '--no-psqlrc',
          '--quiet',
          '--tuples-only',
          '--no-align',
          '--set=ON_ERROR_STOP=1',
          '--dbname',
          'service=staging',
          '--command',
          'SELECT current_database();',
        ]);
        for (const key of [
          'DATABASE_URL',
          'TEST_DATABASE_URL',
          'RESTORE_DATABASE_URL',
          'STAGING_DATABASE_URL',
          'PRODUCTION_DATABASE_URL',
        ]) {
          assert.equal(options.env[key], undefined);
        }
        assert.equal(options.env.PGSERVICE, 'staging');
        assert.equal(options.env.PGSERVICEFILE, serviceFile);
        assert.equal(options.env.PGPASSFILE, passFile);
        return 'aspen_stage\n';
      },
    });

    assert.equal(calls, 1);
    const output = formatMigrationPreflight(result);
    assert.match(output, /2026-08-18T12:00:00.000Z/);
    assert.match(output, /PASS arquivos PostgreSQL protegidos/);
    assert.match(output, /PASS staging difere de produção/);
    assert.match(output, /PASS database efetivo confirmado/);
    assert.doesNotMatch(output, new RegExp(secret));
    assert.doesNotMatch(output, /staging\.test|operator|aspen_stage/);
  });
});
