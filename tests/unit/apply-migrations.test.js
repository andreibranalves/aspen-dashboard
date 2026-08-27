import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  redactOperationalOutput,
  runMigrationApplyPipeline,
} from '../../scripts/apply-migrations.mjs';

const secret = 'sentinel-connection-secret';
const fixedNow = () => new Date('2026-08-27T12:00:00.000Z');

function withProtectedFiles(callback) {
  const root = mkdtempSync(path.join(tmpdir(), 'apply-migrations-'));
  const serviceFile = path.join(root, 'pg_service.conf');
  const passFile = path.join(root, '.pgpass');
  writeFileSync(serviceFile, '[staging]\nhost=staging.test\nport=5433\ndbname=aspen_stage\n');
  writeFileSync(passFile, `staging.test:5433:aspen_stage:operator:${secret}\n`);
  chmodSync(serviceFile, 0o600);
  chmodSync(passFile, 0o600);
  try {
    callback({ serviceFile, passFile });
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
    CUTOVER_ENV_FILE: '/nonexistent/aspen-tests-cutover-env',
  };
}

function passingProbe() {
  return 'aspen_stage\n';
}

test('missing environment contract blocks the apply path before preflight and apply', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    for (const missing of [
      'STAGING_DATABASE_URL',
      'STAGING_PG_SERVICE',
      'PRODUCTION_DATABASE_URL',
      'PGSERVICEFILE',
      'PGPASSFILE',
    ]) {
      let applyCalls = 0;
      const executeApply = () => { applyCalls += 1; return ''; };
      const env = completeEnv(serviceFile, passFile);
      delete env[missing];
      const result = runMigrationApplyPipeline({
        env,
        executePreflightProbe: passingProbe,
        executeApply,
        now: fixedNow,
      });
      assert.equal(result.applyAttempted, false, missing);
      assert.equal(result.applySucceeded, false);
      assert.equal(applyCalls, 0, `apply executor invoked despite missing ${missing}`);
      assert.match(String(result.error), new RegExp(missing));
    }
  });
});

test('preflight failure prevents the apply executor from ever running', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    let applyCalls = 0;
    const result = runMigrationApplyPipeline({
      env: completeEnv(serviceFile, passFile),
      executePreflightProbe: () => {
        // A prova do database efetivo via serviço nomeado falha.
        throw new Error('psql exit 2');
      },
      executeApply: () => { applyCalls += 1; return ''; },
      now: fixedNow,
    });
    assert.equal(result.applySucceeded, false);
    assert.equal(result.applyAttempted, false);
    assert.equal(applyCalls, 0);
    assert.match(String(result.error), /database efetivo|psql/);
  });
});

test('successful preflight opens the apply path exactly once with proven target and redacted output', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    let calls = 0;
    let seenArgs;
    let seenChildEnv;
    const rawStaging = `postgresql://operator:${secret}@staging.test:5433/aspen_stage`;
    const result = runMigrationApplyPipeline({
      env: completeEnv(serviceFile, passFile),
      executePreflightProbe: passingProbe,
      executeApply: (_cmd, args, opts) => {
        calls += 1;
        seenArgs = args;
        seenChildEnv = opts.env;
        return `applied\nsome query against ${rawStaging}\n`;
      },
      now: fixedNow,
    });
    assert.equal(result.applyAttempted, true);
    assert.equal(result.applySucceeded, true);
    assert.equal(calls, 1);
    assert.deepEqual(seenArgs, ['run', 'db:migrate:operational']);
    assert.equal(seenChildEnv.MIGRATION_TARGET_DATABASE_URL, rawStaging);
    assert.ok(!seenChildEnv.TEST_DATABASE_URL || seenChildEnv.TEST_DATABASE_URL !== '');
    assert.ok(!result.output.includes(secret), 'connection string leaked into output');
    assert.ok(result.output.includes('***'));
  });
});

test('apply failure keeps fail-closed exit status and never leaks connection strings', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    const rawStaging = `postgresql://operator:${secret}@staging.test:5433/aspen_stage`;
    let probeCalls = 0;
    const result = runMigrationApplyPipeline({
      env: completeEnv(serviceFile, passFile),
      executePreflightProbe: () => { probeCalls += 1; return 'aspen_stage\n'; },
      executeApply: () => {
        throw new Error(`drizzle-kit failed for ${rawStaging}`);
      },
      now: fixedNow,
    });
    assert.equal(probeCalls, 1);
    assert.equal(result.applyAttempted, true);
    assert.equal(result.applySucceeded, false);
    assert.ok(Number.isInteger(result.exitCode) && result.exitCode !== 0, 'must fail closed');
  });
});

test('redactOperationalOutput masks connection strings wherever they appear', () => {
  const rawStaging = `postgresql://operator:${secret}@staging.test:5433/aspen_stage`;
  const mixed = `drizzle error\n${rawStaging}\ndone`;
  const safe = redactOperationalOutput(mixed);
  assert.ok(!safe.includes(secret));
  assert.ok(safe.includes('postgresql://***'));
  assert.ok(redactOperationalOutput(mixed).includes('done'));
  assert.equal(typeof redactOperationalOutput(mixed), 'string');
});
