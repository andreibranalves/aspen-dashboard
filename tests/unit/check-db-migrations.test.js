import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  formatMigrationCheck,
  migrationRisk,
  parseNameStatus,
  runMigrationCheck,
} from '../../scripts/check-db-migrations.mjs';

const fixedNow = () => new Date('2026-08-18T12:00:00.000Z');

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function withRepository(callback) {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-check-'));
  mkdirSync(path.join(root, 'drizzle'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Migration Test');
  git(root, 'config', 'user.email', 'migration-test@example.invalid');
  writeFileSync(path.join(root, 'drizzle/0000_history.sql'), 'CREATE TABLE history (id int);\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function check(root, baseRef) {
  return runMigrationCheck({
    projectRoot: root,
    baseRef,
    now: fixedNow,
    executeGit: (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }),
    readContent: (file) => readFileSync(path.join(root, file), 'utf8'),
  });
}

test('accepts exactly one risk header as the first non-empty line', () => {
  assert.deepEqual(migrationRisk('\n-- migration-risk: additive\nCREATE TABLE x ();\n'), {
    risk: 'additive',
    valid: true,
  });
  assert.deepEqual(migrationRisk('-- migration-risk: destructive\nDROP TABLE x;\n'), {
    risk: 'destructive',
    valid: true,
  });
});

test('rejects missing, unknown and duplicate risk headers', () => {
  for (const content of [
    'CREATE TABLE x ();\n',
    '-- migration-risk: safe\nCREATE TABLE x ();\n',
    '-- comment\n-- migration-risk: additive\nCREATE TABLE x ();\n',
    '-- migration-risk: additive\n-- migration-risk: destructive\nCREATE TABLE x ();\n',
  ]) {
    assert.equal(migrationRisk(content).valid, false);
  }
});

test('parses NUL name-status records and rename paths', () => {
  assert.deepEqual(
    parseNameStatus('A\0drizzle\\0001_add.sql\0R100\0drizzle/0001_old.sql\0drizzle/0001_new.sql\0'),
    [
      { path: 'drizzle/0001_add.sql', previousPath: null, status: 'A' },
      {
        path: 'drizzle/0001_new.sql',
        previousPath: 'drizzle/0001_old.sql',
        status: 'R100',
      },
    ]
  );
});

test('passes a clean workspace without reading historical migration headers', () => {
  withRepository((root) => {
    const result = check(root);
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.violations, []);
    assert.match(formatMigrationCheck(result), /PASS migrations: nenhuma mudança/);
  });
});

test('accepts a classified untracked migration and redacts SQL contents', () => {
  withRepository((root) => {
    const secret = 'sentinel-secret-value';
    writeFileSync(
      path.join(root, 'drizzle/0001_additive.sql'),
      `\n-- migration-risk: additive\nSELECT '${secret}';\n`
    );
    const result = check(root);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.changes, [
      { path: 'drizzle/0001_additive.sql', previousPath: null, status: 'A' },
    ]);
    const output = formatMigrationCheck(result);
    assert.match(output, /status=A risk=additive result=PASS/);
    assert.doesNotMatch(output, new RegExp(secret));
  });
});

test('rejects new migrations with missing, unknown or duplicate headers', () => {
  withRepository((root) => {
    for (const [name, content] of [
      ['0001_missing.sql', 'CREATE TABLE x ();\n'],
      ['0002_unknown.sql', '-- migration-risk: safe\nCREATE TABLE x ();\n'],
      [
        '0003_duplicate.sql',
        '-- migration-risk: additive\n-- migration-risk: destructive\nCREATE TABLE x ();\n',
      ],
    ]) {
      writeFileSync(path.join(root, `drizzle/${name}`), content);
    }
    const result = check(root);
    assert.equal(result.violations.length, 3);
    assert.ok(result.violations.every((violation) => violation.reason === 'invalid-risk'));
  });
});

test('rejects modification and deletion of historical migrations', () => {
  withRepository((root) => {
    const historical = path.join(root, 'drizzle/0000_history.sql');
    writeFileSync(historical, 'ALTER TABLE history ADD COLUMN changed int;\n');
    let result = check(root);
    assert.deepEqual(
      result.violations.map(({ status }) => status),
      ['M']
    );

    git(root, 'restore', 'drizzle/0000_history.sql');
    unlinkSync(historical);
    result = check(root);
    assert.deepEqual(
      result.violations.map(({ status }) => status),
      ['D']
    );
  });
});

test('rejects staged modification and detects staged additions', () => {
  withRepository((root) => {
    writeFileSync(
      path.join(root, 'drizzle/0000_history.sql'),
      'ALTER TABLE history ADD COLUMN staged int;\n'
    );
    git(root, 'add', 'drizzle/0000_history.sql');
    let result = check(root);
    assert.deepEqual(
      result.violations.map(({ status }) => status),
      ['M']
    );

    git(root, 'restore', '--staged', 'drizzle/0000_history.sql');
    git(root, 'restore', 'drizzle/0000_history.sql');
    writeFileSync(
      path.join(root, 'drizzle/0001_staged.sql'),
      '-- migration-risk: additive\nCREATE TABLE staged (id int);\n'
    );
    git(root, 'add', 'drizzle/0001_staged.sql');
    result = check(root);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.changes, [
      { path: 'drizzle/0001_staged.sql', previousPath: null, status: 'A' },
    ]);
  });
});

test('rejects rename or copy of a historical migration', () => {
  withRepository((root) => {
    renameSync(
      path.join(root, 'drizzle/0000_history.sql'),
      path.join(root, 'drizzle/0001_renamed.sql')
    );
    let result = check(root);
    assert.ok(result.violations.some(({ status }) => status.startsWith('R') || status === 'D'));

    git(root, 'reset', '--hard', 'HEAD');
    writeFileSync(
      path.join(root, 'drizzle/0001_copy.sql'),
      readFileSync(path.join(root, 'drizzle/0000_history.sql'), 'utf8')
    );
    git(root, 'add', '.');
    result = check(root);
    assert.ok(
      result.violations.some(({ status }) => status.startsWith('C')) ||
        result.violations.some(({ reason }) => reason === 'invalid-risk')
    );
  });
});

test('uses MIGRATION_BASE_REF semantics across committed branch changes', () => {
  withRepository((root) => {
    const base = git(root, 'rev-parse', 'HEAD').trim();
    writeFileSync(
      path.join(root, 'drizzle/0001_committed.sql'),
      '-- migration-risk: destructive\nDROP TABLE future_contract;\n'
    );
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'add migration');

    const result = check(root, base);
    assert.deepEqual(result.violations, []);
    assert.equal(result.changes[0].path, 'drizzle/0001_committed.sql');
    assert.match(formatMigrationCheck(result), /risk=destructive result=PASS/);
  });
});
