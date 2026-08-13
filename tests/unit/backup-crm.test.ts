import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseConnectionUrl,
  postgresEnv,
  exceedsMegabyteQuota,
  ensureBackupDirectory,
  resolveBackupDirectory,
  chooseHistoricalLineageTable,
  quoteIdentifier,
} from '../../scripts/backup-crm.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const script = path.join(root, 'scripts/backup-crm.mjs');
const backupSource = readFileSync(script, 'utf8');

function run(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
}

test('named psql service calls use libpq service syntax', () => {
  assert.match(backupSource, /'--dbname', `service=\$\{service\.name\}`/);
  assert.doesNotMatch(backupSource, /'--dbname', service\.name/);
});

test('explicit backup destination is outside checkout and mode 0700', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'backup-crm-secure-'));
  try {
    const configured = resolveBackupDirectory({ CUTOVER_BACKUP_DIR: directory });
    assert.equal(configured, directory);
    const ensured = ensureBackupDirectory({ CUTOVER_BACKUP_DIR: directory });
    assert.equal(ensured, directory);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.throws(
      () => resolveBackupDirectory({ CUTOVER_BACKUP_DIR: path.join(root, 'backups') }),
      /fora do checkout/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('backup preflight exige serviço nomeado e identidade esperada', () => {
  const env = {
    ...process.env,
    DATABASE_URL: 'postgresql://source-user@staging.test:5433/aspen_test',
  };
  for (const key of [
    'CUTOVER_PG_SERVICE',
    'CUTOVER_EXPECTED_DATABASE',
    'PGSERVICEFILE',
    'PGPASSFILE',
  ])
    delete env[key];
  const result = run(['--preflight'], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CUTOVER_PG_SERVICE/);
});

test('backup preflight rejects a source URL that is not the named staging service', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'backup-cutover-'));
  const serviceFile = path.join(directory, 'pg_service.conf');
  writeFileSync(serviceFile, '[staging]\nhost=staging.test\nport=5433\ndbname=aspen_test\n');
  chmodSync(serviceFile, 0o600);
  try {
    const result = run(['--preflight'], {
      ...process.env,
      DATABASE_URL: 'postgresql://source-user@other.test:5433/aspen_test',
      CUTOVER_PG_SERVICE: 'staging',
      CUTOVER_EXPECTED_DATABASE: 'aspen_test',
      PGSERVICEFILE: serviceFile,
      PGPASSFILE: serviceFile,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mesmo destino/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restore validation requires both source and isolated target URLs', () => {
  const withoutSource = { ...process.env };
  delete withoutSource.DATABASE_URL;
  withoutSource.RESTORE_DATABASE_URL = 'postgresql://restore.test/isolated';
  const sourceResult = run(['--validate', '--file', '/tmp/not-a-real-backup.sql'], withoutSource);
  assert.notEqual(sourceResult.status, 0);
  assert.match(sourceResult.stderr, /DATABASE_URL/);

  const withoutRestore = { ...process.env };
  withoutRestore.DATABASE_URL = 'postgresql://source.test/source';
  delete withoutRestore.RESTORE_DATABASE_URL;
  const restoreResult = run(['--validate', '--file', '/tmp/not-a-real-backup.sql'], withoutRestore);
  assert.notEqual(restoreResult.status, 0);
  assert.match(restoreResult.stderr, /RESTORE_DATABASE_URL/);
});

test('restore validation exige serviço nomeado e identidade ativa', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'backup-restore-required-'));
  const dump = path.join(directory, 'backup.sql');
  writeFileSync(dump, '-- isolated test dump\n');
  try {
    const result = run(['--validate', '--file', dump], {
      ...process.env,
      DATABASE_URL: 'postgresql://source-user@source.test:5433/aspen_test',
      RESTORE_DATABASE_URL: 'postgresql://restore-user@restore.test:5433/aspen_restore',
      PRODUCTION_DATABASE_URL: 'postgresql://prod-user@prod.test:5433/aspen_prod',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /RESTORE_PG_SERVICE/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restore validation enforces named isolated service identity', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'backup-service-'));
  const serviceFile = path.join(directory, 'pg_service.conf');
  const dump = path.join(directory, 'backup.sql');
  writeFileSync(serviceFile, '[restore]\nhost=restore.test\nport=5433\ndbname=aspen_restore\n');
  chmodSync(serviceFile, 0o600);
  writeFileSync(dump, '-- isolated test dump\\n');
  try {
    const result = run(['--validate', '--file', dump], {
      ...process.env,
      DATABASE_URL: 'postgresql://source-user@source.test:5433/aspen_test',
      RESTORE_DATABASE_URL: 'postgresql://restore-user@other.test:5433/aspen_restore',
      PRODUCTION_DATABASE_URL: 'postgresql://prod-user@prod.test:5433/aspen_prod',
      RESTORE_PG_SERVICE: 'restore',
      RESTORE_EXPECTED_DATABASE: 'aspen_restore',
      PGSERVICEFILE: serviceFile,
      PGPASSFILE: serviceFile,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mesmo destino/);
    assert.doesNotMatch(result.stderr, /other\\.test/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restore validation rejects a named restore target matching active production', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'backup-production-'));
  const serviceFile = path.join(directory, 'pg_service.conf');
  const dump = path.join(directory, 'backup.sql');
  writeFileSync(serviceFile, '[restore]\nhost=restore.test\nport=5433\ndbname=aspen_restore\n');
  chmodSync(serviceFile, 0o600);
  writeFileSync(dump, '-- isolated test dump\\n');
  try {
    const result = run(['--validate', '--file', dump], {
      ...process.env,
      DATABASE_URL: 'postgresql://source-user@source.test:5433/aspen_test',
      RESTORE_DATABASE_URL: 'postgresql://restore-user@restore.test:5433/aspen_restore',
      PRODUCTION_DATABASE_URL: 'postgresql://prod-user@restore.test:5433/aspen_restore',
      RESTORE_PG_SERVICE: 'restore',
      RESTORE_EXPECTED_DATABASE: 'aspen_restore',
      PGSERVICEFILE: serviceFile,
      PGPASSFILE: serviceFile,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /base ativa/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restore validation refuses implicit newest-backup selection', () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RESTORE_DATABASE_URL: 'postgresql://restore.test/isolated',
  };
  delete env.DATABASE_URL;
  const result = run(['--validate'], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--file/);
});

test('restore validation refuses the source database cluster, even with another user', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'backup-crm-'));
  const dump = path.join(directory, 'backup.sql');
  writeFileSync(dump, '-- isolated test dump\n');
  try {
    for (const [source, restore] of [
      ['postgresql://source-user@same.test/source', 'postgresql://restore-user@same.test/source'],
      [
        'postgresql://source-user@same.test:5433/source',
        'postgresql://restore-user@same.test:5433/source',
      ],
    ]) {
      const result = run(['--validate', '--file', dump], {
        ...process.env,
        DATABASE_URL: source,
        RESTORE_DATABASE_URL: restore,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /alvo isolado diferente/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('parsed connection fields override inherited libpq environment', () => {
  const connection = parseConnectionUrl(
    'postgresql://target-user:target-pass@target.test:5433/target-db'
  );
  const env = postgresEnv(connection, connection.database, {
    PGHOST: 'wrong.test',
    PGHOSTADDR: '192.0.2.1',
    PGPORT: '9999',
    PGUSER: 'wrong-user',
    PGPASSWORD: 'wrong-pass',
    PGDATABASE: 'wrong-db',
    PGSERVICE: 'wrong-service',
    PGSERVICEFILE: '/tmp/wrong-service-file',
    PGPASSFILE: '/tmp/wrong-pass-file',
    TEST_DATABASE_URL: 'postgresql://wrong.test/test-db',
  });
  assert.equal(env.PGHOST, 'target.test');
  assert.equal(env.PGPORT, '5433');
  assert.equal(env.PGUSER, 'target-user');
  assert.equal(env.PGPASSWORD, 'target-pass');
  assert.equal(env.PGDATABASE, 'target-db');
  for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'TEST_DATABASE_URL'])
    assert.equal(env[key], undefined, `${key} must not override parsed connection`);
});

test('discovers exactly one historical lineage table by suffix and full column signature', () => {
  const columns = [
    'provider',
    'source_doctype',
    'source_id',
    'entity_type',
    'local_id',
    'local_key',
    'canonical_hash',
    'source_hash',
    'lineage_status',
    'business_number',
    'legacy_payload',
    'migration_run_id',
    'source_updated_at',
    'imported_at',
    'created_at',
    'updated_at',
  ];
  const result = chooseHistoricalLineageTable([
    { schema: 'public', table: 'history_import_lineage', columns },
  ]);
  assert.equal(result.qualified, '"public"."history_import_lineage"');
  assert.throws(() => chooseHistoricalLineageTable([]), /ausente ou ambígua/);
  assert.throws(
    () =>
      chooseHistoricalLineageTable([
        { schema: 'public', table: 'one_import_lineage', columns },
        { schema: 'public', table: 'two_import_lineage', columns },
      ]),
    /ausente ou ambígua/
  );
  assert.throws(
    () =>
      chooseHistoricalLineageTable([
        { schema: 'public', table: 'bad_import_lineage', columns: columns.slice(1) },
      ]),
    /ausente ou ambígua/
  );
  assert.throws(() => quoteIdentifier('public";DROP TABLE x'), /inválido/);
  assert.throws(
    () => chooseHistoricalLineageTable([
      { schema: 'public', table: 'duplicate_import_lineage', columns: [...columns.slice(1), 'updated_at'] },
    ]),
    /ausente ou ambígua/
  );
});

test('database size quota compares bytes against megabytes', () => {
  assert.equal(exceedsMegabyteQuota(512 * 1024 * 1024, 512), false);
  assert.equal(exceedsMegabyteQuota(512 * 1024 * 1024 + 1, 512), true);
});
