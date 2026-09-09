import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const configUrl = new URL('../../playwright.config.js', import.meta.url);
const missingEnvPath = fileURLToPath(new URL('./missing-playwright.env', import.meta.url));
const probe = `
  const { default: config } = await import(${JSON.stringify(configUrl.href)});
  process.stdout.write(JSON.stringify({
    workers: config.workers,
    webServer: Boolean(config.webServer),
    testIgnore: config.testIgnore || null,
    baseURL: config.use.baseURL,
    environmentBaseURL: process.env.BASE_URL,
  }));
`;

function loadConfig(env) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: missingEnvPath,
      ...env,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('APP_ENV=development mantém servidor local e ignora specs staging', () => {
  const config = loadConfig({ APP_ENV: 'development', BASE_URL: 'http://127.0.0.1:5173' });
  assert.equal(config.workers, 2);
  assert.equal(config.webServer, true);
  assert.deepEqual(config.testIgnore, [
    'tests/postgres-only-cutover.spec.js',
    'tests/quotation-cutover-staging.spec.js',
  ]);
  assert.equal(config.baseURL, 'http://127.0.0.1:5173');
});

test('APP_ENV=preview usa origem remota, um worker e nenhum servidor local', () => {
  const config = loadConfig({
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    STAGING_BASE_URL: 'https://preview.example.test',
    BASE_URL: 'https://preview.example.test',
  });
  assert.equal(config.workers, 1);
  assert.equal(config.webServer, false);
  assert.equal(config.testIgnore, null);
  assert.equal(config.baseURL, 'https://preview.example.test');
  assert.equal(config.environmentBaseURL, config.baseURL);
});

test('PLAYWRIGHT_PORT mantém config e testes no mesmo servidor local', () => {
  const config = loadConfig({ APP_ENV: 'development', PLAYWRIGHT_PORT: '5202' });
  assert.equal(config.baseURL, 'http://localhost:5202');
  assert.equal(config.environmentBaseURL, config.baseURL);
});

test('Preview rejeita BASE_URL fora da origem staging', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: missingEnvPath,
      APP_ENV: 'preview',
      EXTERNAL_WRITES_ENABLED: '0',
      STAGING_BASE_URL: 'https://preview.example.test',
      BASE_URL: 'https://outside.example.test',
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BASE_URL must match STAGING_BASE_URL during staging E2E/);
});
