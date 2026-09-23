import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLocalE2eEnvironment } from '../../scripts/lib/local-e2e-env.mjs';

const databaseUrl = 'postgresql://test:test@127.0.0.1:55432/aspen_test';

test('local E2E strips operational credentials and fixes test runtime before discovery', () => {
  const env = buildLocalE2eEnvironment({
    PATH: '/usr/bin', HOME: '/synthetic',
    APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '1',
    VERCEL_ENV: 'production', VERCEL: '1',
    RESEND_API_KEY: 'sentinel', BLOB_READ_WRITE_TOKEN: 'sentinel',
    APP_SESSION_SECRET: 'sentinel', QSTASH_TOKEN: 'sentinel', UNKNOWN_SECRET: 'sentinel',
    NODE_OPTIONS: '--import /hostile.mjs', NODE_PATH: '/hostile',
    npm_config_node_options: '--import /hostile.mjs',
    DOTENV_CONFIG_PATH: '/operational.env',
    SAFE_E2E: '1', SAFE_E2E_CAPABILITY_PROOF: 'sentinel',
    HOST: '0.0.0.0', TEST_DATABASE_URL: databaseUrl,
  });
  assert.doesNotMatch(JSON.stringify(env), /sentinel|hostile|operational/);
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.APP_ENV, 'test');
  assert.equal(env.EXTERNAL_WRITES_ENABLED, '0');
  assert.equal(env.DOTENV_CONFIG_PATH, '/dev/null');
  assert.equal(env.DATABASE_URL, databaseUrl);
  assert.equal(env.HOST, '127.0.0.1');
  assert.equal(env.BASE_URL, 'http://localhost:5173');
  assert.equal(env.PATH, '/usr/bin');
});

test('local E2E preserves Windows process keys needed by the Playwright server', () => {
  const env = buildLocalE2eEnvironment({
    PATH: 'C:\\Windows\\System32',
    Path: 'C:\\Tools\\node;C:\\Windows\\System32',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    SystemRoot: 'C:\\Windows',
    windir: 'C:\\Windows',
  });
  assert.equal(env.Path, 'C:\\Tools\\node;C:\\Windows\\System32');
  assert.equal(env.ComSpec, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.windir, 'C:\\Windows');
});

test('local E2E refuses remote HTTP/database and mismatched targets without echoing values', () => {
  for (const env of [
    { BASE_URL: 'https://production.example.test' },
    { BASE_URL: 'http://localhost:6000', PLAYWRIGHT_PORT: '5173' },
    { BASE_URL: 'https://localhost:5173' },
    { BASE_URL: 'http://[::1]:5173' },
    { TEST_DATABASE_URL: 'postgresql://secret@remote.example/db' },
    { DATABASE_URL: 'postgresql://secret@remote.example/db' },
    { TEST_DATABASE_URL: databaseUrl, DATABASE_URL: 'postgresql://secret@remote.example/db' },
    { PLAYWRIGHT_PORT: 'secret' },
  ]) {
    assert.throws(() => buildLocalE2eEnvironment(env), (error: Error) => {
      assert.doesNotMatch(error.message, /secret|production\.example|remote\.example/);
      return true;
    });
  }
});

test('Vite also disables its own dotenv loader in tests (no server started)', () => {
  const root = mkdtempSync(join(tmpdir(), 'aspen-vite-env-'));
  try {
    writeFileSync(join(root, '.env'), 'VITE_POISON=sentinel\n');
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { resolveConfig } from 'vite';
      import config from './vite.config.js';
      const resolved = await resolveConfig({ ...config, root: process.argv[1], configFile: false }, 'serve');
      assert.equal(resolved.envDir, false);
      assert.equal(resolved.env.VITE_POISON, undefined);
    `, root], { env: buildLocalE2eEnvironment({ PATH: process.env.PATH }), stdio: 'pipe', timeout: 10_000 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('test API binds only loopback even with HOST set to all interfaces (no socket opened)', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { Server } from 'node:http';
    Server.prototype.listen = function (port, host) {
      assert.equal(host, '127.0.0.1');
      process.exit(0);
    };
    await import('./scripts/app-server.mjs');
    throw new Error('listen was not called');
  `], {
    env: { ...buildLocalE2eEnvironment({ PATH: process.env.PATH }), HOST: '0.0.0.0' },
    stdio: 'pipe', timeout: 10_000,
  });
});

test('mocked local E2E needs no database; RELEASE requires an explicit disposable target', () => {
  assert.equal(buildLocalE2eEnvironment({}).DATABASE_URL, '');
  assert.throws(() => buildLocalE2eEnvironment({}, { requireDatabase: true }), /TEST_DATABASE_URL/);
  assert.equal(buildLocalE2eEnvironment({ TEST_DATABASE_URL: databaseUrl }, { requireDatabase: true }).DATABASE_URL, databaseUrl);
});
