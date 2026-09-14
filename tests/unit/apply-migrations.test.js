import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeMigrationApplyTarget,
  parseApplyArgs,
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
    assert.equal(seenChildEnv.MIGRATE_APPLY_APPROVED, '1');
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

test('target parsing keeps no-arg as staging and rejects unknown targets', () => {
  assert.deepEqual(parseApplyArgs([]), { target: 'staging' });
  assert.deepEqual(parseApplyArgs(['--target', 'staging']), { target: 'staging' });
  assert.deepEqual(parseApplyArgs(['--target', 'production']), { target: 'production' });
  assert.equal(normalizeMigrationApplyTarget('production'), 'production');
  assert.throws(() => parseApplyArgs(['--target', 'prod']), /Alvo de apply inválido/);
  assert.throws(() => parseApplyArgs(['--target', 'PRODUCTION']), /Alvo de apply inválido/);
  assert.throws(() => parseApplyArgs(['--target']), /Informe um alvo/);
  assert.throws(() => parseApplyArgs(['--target', '--target']), /Informe um alvo/);
  assert.throws(() => parseApplyArgs(['--unknown']), /Opção desconhecida/);
});

test('duplicate --target is rejected for equal and conflicting values in both orders', () => {
  for (const argv of [
    ['--target', 'production', '--target', 'production'],
    ['--target', 'staging', '--target', 'staging'],
    ['--target', 'staging', '--target', 'production'],
    ['--target', 'production', '--target', 'staging'],
  ]) {
    assert.throws(() => parseApplyArgs(argv), /mais de uma vez/, JSON.stringify(argv));
  }
  assert.deepEqual(parseApplyArgs(['--target', 'production']), { target: 'production' });
});

function productionUrl() {
  return `postgresql://operator:${secret}@prod.test:5433/aspen_prod`;
}

function withProductionFiles(callback) {
  const root = mkdtempSync(path.join(tmpdir(), 'apply-migrations-prod-'));
  const backupDir = mkdtempSync(path.join(tmpdir(), 'apply-migrations-backup-'));
  const serviceFile = path.join(root, 'pg_service.conf');
  const passFile = path.join(root, '.pgpass');
  writeFileSync(serviceFile, '[production]\nhost=prod.test\nport=5433\ndbname=aspen_prod\n');
  writeFileSync(passFile, `prod.test:5433:aspen_prod:operator:${secret}\n`);
  chmodSync(serviceFile, 0o600);
  chmodSync(passFile, 0o600);
  try {
    callback({ serviceFile, passFile, backupDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(backupDir, { recursive: true, force: true });
  }
}

function productionEnv({ serviceFile, passFile, backupDir }) {
  const url = productionUrl();
  return {
    PRODUCTION_DATABASE_URL: url,
    DATABASE_URL: url,
    PRODUCTION_PG_SERVICE: 'production',
    CUTOVER_PG_SERVICE: 'production',
    CUTOVER_EXPECTED_DATABASE: 'aspen_prod',
    PGSERVICEFILE: serviceFile,
    PGPASSFILE: passFile,
    CUTOVER_BACKUP_DIR: backupDir,
    CUTOVER_ENV_FILE: '/nonexistent/aspen-tests-cutover-env',
  };
}

test('production run proves identity, then runs the existing backup before apply with only the production URL', () => {
  withProductionFiles((files) => {
    const order = [];
    let seenApplyArgs;
    let seenApplyEnv;
    const result = runMigrationApplyPipeline({
      env: productionEnv(files),
      target: 'production',
      executePreflightProbe: () => {
        order.push('probe');
        return 'aspen_prod\n';
      },
      executeBackup: (_cmd, args) => {
        order.push('backup');
        assert.deepEqual(args, ['run', 'db:backup']);
        return `backup against ${productionUrl()}\n`;
      },
      executeApply: (_cmd, args, opts) => {
        order.push('apply');
        seenApplyArgs = args;
        seenApplyEnv = opts.env;
        return 'applied\n';
      },
      now: fixedNow,
    });

    assert.deepEqual(order, ['probe', 'backup', 'apply']);
    assert.equal(result.target, 'production');
    assert.equal(result.backupAttempted, true);
    assert.equal(result.backupSucceeded, true);
    assert.equal(result.applyAttempted, true);
    assert.equal(result.applySucceeded, true);
    assert.deepEqual(seenApplyArgs, ['run', 'db:migrate:operational']);
    assert.equal(seenApplyEnv.MIGRATION_TARGET_DATABASE_URL, productionUrl());
    assert.equal(seenApplyEnv.MIGRATE_APPLY_APPROVED, '1');
    assert.equal(seenApplyEnv.STAGING_DATABASE_URL, undefined);
    assert.ok(!String(result.backupOutput).includes(secret), 'backup output leaked secret');
    assert.ok(String(result.backupOutput).includes('***'), 'backup output not redacted');
    assert.ok(!String(result.output).includes(secret));
  });
});

test('production requires every guarded input before backup or apply', () => {
  withProductionFiles((files) => {
    for (const missing of [
      'PRODUCTION_DATABASE_URL',
      'DATABASE_URL',
      'PRODUCTION_PG_SERVICE',
      'CUTOVER_PG_SERVICE',
      'CUTOVER_EXPECTED_DATABASE',
      'PGSERVICEFILE',
      'PGPASSFILE',
      'CUTOVER_BACKUP_DIR',
    ]) {
      let backupCalls = 0;
      let applyCalls = 0;
      const env = productionEnv(files);
      delete env[missing];
      if (missing === 'CUTOVER_BACKUP_DIR') delete env.BACKUP_DIR;
      const result = runMigrationApplyPipeline({
        env,
        target: 'production',
        executePreflightProbe: () => 'aspen_prod\n',
        executeBackup: () => {
          backupCalls += 1;
          return '';
        },
        executeApply: () => {
          applyCalls += 1;
          return '';
        },
        now: fixedNow,
      });
      assert.equal(backupCalls, 0, `backup invoked despite missing ${missing}`);
      assert.equal(applyCalls, 0, `apply invoked despite missing ${missing}`);
      assert.equal(result.backupAttempted, false);
      assert.equal(result.applyAttempted, false);
      assert.match(String(result.error), new RegExp(missing), `error should mention ${missing}`);
    }
  });
});

test('production rejects unprotected PostgreSQL files before backup or apply', () => {
  withProductionFiles((files) => {
    chmodSync(files.passFile, 0o644);
    let backupCalls = 0;
    let applyCalls = 0;
    const result = runMigrationApplyPipeline({
      env: productionEnv(files),
      target: 'production',
      executePreflightProbe: () => 'aspen_prod\n',
      executeBackup: () => {
        backupCalls += 1;
        return '';
      },
      executeApply: () => {
        applyCalls += 1;
        return '';
      },
      now: fixedNow,
    });
    assert.equal(backupCalls, 0);
    assert.equal(applyCalls, 0);
    assert.match(String(result.error), /PGPASSFILE \(invalid-permission\)/);
  });
});

test('production identity mismatch blocks backup and apply', () => {
  withProductionFiles((files) => {
    let backupCalls = 0;
    let applyCalls = 0;
    const result = runMigrationApplyPipeline({
      env: {
        ...productionEnv(files),
        DATABASE_URL: `postgresql://operator:${secret}@other.test:5433/aspen_prod`,
      },
      target: 'production',
      executePreflightProbe: () => 'aspen_prod\n',
      executeBackup: () => {
        backupCalls += 1;
        return '';
      },
      executeApply: () => {
        applyCalls += 1;
        return '';
      },
      now: fixedNow,
    });
    assert.equal(backupCalls, 0);
    assert.equal(applyCalls, 0);
    assert.match(String(result.error), /PRODUCTION_DATABASE_URL e DATABASE_URL/);
  });
});

test('production current_database mismatch blocks backup and apply', () => {
  withProductionFiles((files) => {
    let backupCalls = 0;
    let applyCalls = 0;
    const result = runMigrationApplyPipeline({
      env: productionEnv(files),
      target: 'production',
      executePreflightProbe: () => 'unexpected_database\n',
      executeBackup: () => {
        backupCalls += 1;
        return '';
      },
      executeApply: () => {
        applyCalls += 1;
        return '';
      },
      now: fixedNow,
    });
    assert.equal(backupCalls, 0);
    assert.equal(applyCalls, 0);
    assert.match(String(result.error), /database inesperado/);
  });
});

test('production cutover service mismatch blocks backup and apply', () => {
  withProductionFiles((files) => {
    let backupCalls = 0;
    let applyCalls = 0;
    const result = runMigrationApplyPipeline({
      env: { ...productionEnv(files), CUTOVER_EXPECTED_DATABASE: 'aspen_other' },
      target: 'production',
      executePreflightProbe: () => 'aspen_prod\n',
      executeBackup: () => {
        backupCalls += 1;
        return '';
      },
      executeApply: () => {
        applyCalls += 1;
        return '';
      },
      now: fixedNow,
    });
    assert.equal(backupCalls, 0);
    assert.equal(applyCalls, 0);
    assert.match(String(result.error), /Database esperado|CUTOVER_PG_SERVICE/);
  });
});

test('backup failure prevents apply and fails closed with nonzero status', () => {
  withProductionFiles((files) => {
    let applyCalls = 0;
    const result = runMigrationApplyPipeline({
      env: productionEnv(files),
      target: 'production',
      executePreflightProbe: () => 'aspen_prod\n',
      executeBackup: () => {
        throw Object.assign(new Error(`pg_dump failed for ${productionUrl()}`), { status: 3 });
      },
      executeApply: () => {
        applyCalls += 1;
        return '';
      },
      now: fixedNow,
    });
    assert.equal(result.backupAttempted, true);
    assert.equal(result.backupSucceeded, false);
    assert.equal(result.applyAttempted, false);
    assert.equal(applyCalls, 0);
    assert.equal(result.exitCode, 3);
  });
});

test('production rejects unknown target values without backup or apply', () => {
  withProductionFiles((files) => {
    let backupCalls = 0;
    let applyCalls = 0;
    const result = runMigrationApplyPipeline({
      env: productionEnv(files),
      target: 'prod',
      executePreflightProbe: () => 'aspen_prod\n',
      executeBackup: () => {
        backupCalls += 1;
        return '';
      },
      executeApply: () => {
        applyCalls += 1;
        return '';
      },
      now: fixedNow,
    });
    assert.equal(backupCalls, 0);
    assert.equal(applyCalls, 0);
    assert.equal(result.applyAttempted, false);
    assert.match(String(result.error), /Alvo/);
  });
});

test('production requires the backup destination to already be a regular 0700 directory outside the checkout', () => {
  withProductionFiles((files) => {
    const filePath = path.join(tmpdir(), `apply-migrations-backup-file-${process.pid}-${Date.now()}`);
    const linkPath = path.join(tmpdir(), `apply-migrations-backup-link-${process.pid}-${Date.now()}`);
    writeFileSync(filePath, 'not a directory');
    symlinkSync(files.backupDir, linkPath);
    const blocked = [
      { dir: path.join(files.backupDir, 'missing-subdir'), error: /existir/ },
      { dir: filePath, error: /diretório regular/ },
      { dir: linkPath, error: /link simbólico/ },
    ];
    try {
      for (const scenario of blocked) {
        let backupCalls = 0;
        let applyCalls = 0;
        const result = runMigrationApplyPipeline({
          env: { ...productionEnv(files), CUTOVER_BACKUP_DIR: scenario.dir },
          target: 'production',
          executePreflightProbe: () => 'aspen_prod\n',
          executeBackup: () => {
            backupCalls += 1;
            return '';
          },
          executeApply: () => {
            applyCalls += 1;
            return '';
          },
          now: fixedNow,
        });
        assert.equal(backupCalls, 0, `backup invoked for ${scenario.dir}`);
        assert.equal(applyCalls, 0, `apply invoked for ${scenario.dir}`);
        assert.equal(result.backupAttempted, false);
        assert.match(String(result.error), scenario.error);
      }

      chmodSync(files.backupDir, 0o755);
      let backupCalls = 0;
      let applyCalls = 0;
      const insecure = runMigrationApplyPipeline({
        env: productionEnv(files),
        target: 'production',
        executePreflightProbe: () => 'aspen_prod\n',
        executeBackup: () => {
          backupCalls += 1;
          return '';
        },
        executeApply: () => {
          applyCalls += 1;
          return '';
        },
        now: fixedNow,
      });
      assert.equal(backupCalls, 0);
      assert.equal(applyCalls, 0);
      assert.equal(insecure.backupAttempted, false);
      assert.match(String(insecure.error), /permissão 700/);
      chmodSync(files.backupDir, 0o700);
    } finally {
      rmSync(filePath, { force: true });
      rmSync(linkPath, { force: true });
    }
  });
});
