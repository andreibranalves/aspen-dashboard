import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import {
  inspectCutoverEnv,
  readEnvKeys,
  requiredCutoverKeys,
  resolveCutoverEnvFiles,
} from '../../scripts/cutover-env-status.mjs';

const scriptPath = fileURLToPath(new URL('../../scripts/cutover-env-status.mjs', import.meta.url));
const secret = 'sentinel-secret-value';

function withTempDir(callback) {
  const root = mkdtempSync(join(tmpdir(), 'cutover-env-status-'));
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeCompleteEnvFile(path, extra = '') {
  writeFileSync(
    path,
    `${requiredCutoverKeys.map((key) => `${key}=present`).join('\n')}\n${extra}`,
  );
  return path;
}

function completeEnvFile(root, extra = '') {
  return writeCompleteEnvFile(join(root, '.env'), extra);
}

function defaultEnvFile(root) {
  const configDir = join(root, 'aspen-dashboard');
  mkdirSync(configDir, { recursive: true });
  return join(configDir, '.env');
}

function defaultCliEnv(root) {
  const env = { ...process.env, XDG_CONFIG_HOME: root };
  delete env.CUTOVER_ENV_FILE;
  return env;
}

test('parses dotenv assignment names without exposing values', () => {
  withTempDir((root) => {
    const path = join(root, '.env');
    writeFileSync(path, `# comment\nFIRST=${secret}\nexport SECOND=two\nBLANK=\nmalformed\n\n`);

    assert.deepEqual([...readEnvKeys(path)], ['FIRST', 'SECOND']);
    assert.doesNotMatch(JSON.stringify([...readEnvKeys(path)]), new RegExp(secret));
  });
});

test('resolves external defaults and an explicit protected file override', () => {
  assert.deepEqual(
    resolveCutoverEnvFiles({ XDG_CONFIG_HOME: '/tmp/operator-config' }),
    ['/tmp/operator-config/aspen-dashboard/.env.local', '/tmp/operator-config/aspen-dashboard/.env'],
  );
  assert.deepEqual(
    resolveCutoverEnvFiles({ CUTOVER_ENV_FILE: '/protected/cutover.env' }),
    ['/protected/cutover.env'],
  );
});

test('reports key presence without returning environment values', () => {
  withTempDir((root) => {
    const path = join(root, '.env');
    writeFileSync(path, `${requiredCutoverKeys[0]}=${secret}\n`);
    const result = inspectCutoverEnv({
      env: { CUTOVER_ENV_FILE: path },
    });

    assert.deepEqual(result.files, [{ path, status: 'present' }]);
    assert.deepEqual(result.keys[0], { name: requiredCutoverKeys[0], status: 'present' });
    assert.deepEqual(result.keys[1], { name: requiredCutoverKeys[1], status: 'missing' });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  });
});

test('CLI reports statuses only and succeeds for a complete temporary file', () => {
  withTempDir((root) => {
    const path = completeEnvFile(root, `NOT_REQUIRED=${secret}\n`);
    const result = spawnSync(process.execPath, [scriptPath], {
      env: { ...process.env, CUTOVER_ENV_FILE: path },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /config files:/);
    assert.match(result.stdout, new RegExp(`${requiredCutoverKeys[0]}: present`));
    assert.doesNotMatch(result.stdout, new RegExp(secret));
    assert.equal(result.stderr, '');
  });
});

test('CLI fails when a required key is missing', () => {
  withTempDir((root) => {
    const path = join(root, '.env');
    writeFileSync(path, `${requiredCutoverKeys[0]}=present\n`);
    const result = spawnSync(process.execPath, [scriptPath], {
      env: { ...process.env, CUTOVER_ENV_FILE: path },
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`${requiredCutoverKeys[1]}: missing`));
    assert.doesNotMatch(result.stdout, new RegExp(secret));
    assert.equal(result.stderr, '');
  });
});

test('CLI treats blank and quote-only required values as missing', () => {
  withTempDir((root) => {
    const path = join(root, '.env');
    writeFileSync(
      path,
      requiredCutoverKeys
        .map((key, index) => `${key}=${['   ', "''", '"   "'][index % 3]}`)
        .join('\n'),
    );
    const result = spawnSync(process.execPath, [scriptPath], {
      env: { ...process.env, CUTOVER_ENV_FILE: path },
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`${requiredCutoverKeys[0]}: missing`));
    assert.doesNotMatch(result.stdout, /unreadable/);
    assert.equal(result.stderr, '');
  });
});

test('CLI accepts one complete default environment alternative', () => {
  withTempDir((root) => {
    const path = defaultEnvFile(root);
    writeCompleteEnvFile(path);
    const result = spawnSync(process.execPath, [scriptPath], {
      env: defaultCliEnv(root),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\.env: present/);
    assert.equal(result.stderr, '');
  });
});

test('CLI fails closed when neither default environment file exists', () => {
  withTempDir((root) => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: defaultCliEnv(root),
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /\.env\.local: missing/);
    assert.match(result.stdout, /\.env: missing/);
    assert.doesNotMatch(result.stdout, /unreadable/);
    assert.equal(result.stderr, '');
  });
});

test('CLI reports an unreadable selected file as missing', () => {
  withTempDir((root) => {
    const path = defaultEnvFile(root);
    mkdirSync(path);
    const result = spawnSync(process.execPath, [scriptPath], {
      env: defaultCliEnv(root),
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`${path}: missing`));
    assert.doesNotMatch(result.stdout, /unreadable/);
    assert.equal(result.stderr, '');
  });
});

