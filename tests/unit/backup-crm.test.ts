import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const script = path.join(root, 'scripts/backup-crm.mjs');

function run(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
}

test('restore validation requires an explicit dump and RESTORE_DATABASE_URL', () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.RESTORE_DATABASE_URL;
  const result = run(['--validate', '--file', '/tmp/not-a-real-backup.sql'], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RESTORE_DATABASE_URL/);
});

test('restore validation refuses implicit newest-backup selection', () => {
  const env = { ...process.env, RESTORE_DATABASE_URL: 'postgresql://restore.test/isolated' };
  delete env.DATABASE_URL;
  const result = run(['--validate'], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--file/);
});

test('restore validation refuses the source database as its target', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'backup-crm-'));
  const dump = path.join(directory, 'backup.sql');
  writeFileSync(dump, '-- isolated test dump\n');
  try {
    const env = {
      ...process.env,
      DATABASE_URL: 'postgresql://same.test/source',
      RESTORE_DATABASE_URL: 'postgresql://same.test/source',
    };
    const result = run(['--validate', '--file', dump], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /alvo isolado diferente/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
