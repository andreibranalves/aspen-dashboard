import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseConnectionUrl,
  postgresEnv,
  exceedsMegabyteQuota,
} from '../../scripts/backup-crm.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const script = path.join(root, 'scripts/backup-crm.mjs');

function run(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
}

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

test('restore validation refuses implicit newest-backup selection', () => {
  const env = { ...process.env, RESTORE_DATABASE_URL: 'postgresql://restore.test/isolated' };
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
  });
  assert.equal(env.PGHOST, 'target.test');
  assert.equal(env.PGPORT, '5433');
  assert.equal(env.PGUSER, 'target-user');
  assert.equal(env.PGPASSWORD, 'target-pass');
  assert.equal(env.PGDATABASE, 'target-db');
  for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE'])
    assert.equal(env[key], undefined, `${key} must not override parsed connection`);
});

test('database size quota compares bytes against megabytes', () => {
  assert.equal(exceedsMegabyteQuota(512 * 1024 * 1024, 512), false);
  assert.equal(exceedsMegabyteQuota(512 * 1024 * 1024 + 1, 512), true);
});
