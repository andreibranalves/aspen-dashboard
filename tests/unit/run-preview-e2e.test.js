import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

const REQUIRED_ENV = {
  PREVIEW_BASE_URL: 'https://preview.example.test',
  DATABASE_URL: 'postgresql://preview:preview@preview.example:5432/aspen_preview',
  PRODUCTION_DATABASE_URL: 'postgresql://production:production@production.example:5432/aspen',
  E2E_USERNAME: 'operator',
  E2E_PASSWORD: 'synthetic-password',
  PREVIEW_E2E_USERNAME: 'operator',
  KNOWN_POSTGRES_QUOTATION_ID: '00000000-0000-4000-8000-000000000001',
  KNOWN_POSTGRES_SCRATCH_QUOTATION_ID: '00000000-0000-4000-8000-000000000002',
  PREVIEW_EGRESS_BLOCKED: '1',
  PREVIEW_FIXTURE_RESET: '1',
};

async function runWithFakeNpx(overrides = {}, extraArgs = [], fakeExitCode = 0) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aspen-preview-e2e-env-'));
  const configPath = path.join(directory, 'preview.env');
  const fakeNpx = path.join(directory, 'npx');
  const capturePath = path.join(directory, 'capture.json');
  const values = { ...REQUIRED_ENV, ...overrides };

  await writeFile(
    configPath,
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600 }
  );
  await writeFile(
    fakeNpx,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
writeFileSync(join(process.env.TMPDIR, 'capture.json'), JSON.stringify({
  args,
  APP_ENV: process.env.APP_ENV,
  EXTERNAL_WRITES_ENABLED: process.env.EXTERNAL_WRITES_ENABLED,
  DOTENV_CONFIG_PATH: process.env.DOTENV_CONFIG_PATH,
  PREVIEW_BASE_URL: process.env.PREVIEW_BASE_URL,
  hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
  hasProductionDatabaseUrl: Boolean(process.env.PRODUCTION_DATABASE_URL),
  hasPassword: Boolean(process.env.E2E_PASSWORD),
}));
process.exit(${fakeExitCode});
`,
    { mode: 0o755 }
  );
  await chmod(fakeNpx, 0o755);

  const result = spawnSync(process.execPath, ['scripts/run-preview-e2e.mjs', ...extraArgs], {
    cwd: PROJECT_ROOT,
    env: {
      PATH: `${directory}${path.delimiter}${process.env.PATH || ''}`,
      HOME: directory,
      TMPDIR: directory,
      CUTOVER_ENV_FILE: configPath,
      PREVIEW_RUN_SENTINEL: 'must-not-leak',
    },
    encoding: 'utf8',
  });

  let capture = null;
  try {
    capture = JSON.parse(await readFile(capturePath, 'utf8'));
  } catch {
    // A preflight or argument guard must leave the fake npx unstarted.
  }
  await rm(directory, { recursive: true, force: true });
  return { result, capture };
}

test('launcher de Preview executa preflight antes do spawn e repassa filtros sem segredos de banco', async () => {
  const { result, capture } = await runWithFakeNpx({}, ['--list', '--grep', '@quotations']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(capture, {
    args: [
      'playwright',
      'test',
      'tests/postgres-only-cutover.spec.js',
      'tests/quotation-cutover-preview.spec.js',
      '--list',
      '--grep',
      '@quotations',
    ],
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    DOTENV_CONFIG_PATH: '/dev/null',
    PREVIEW_BASE_URL: 'https://preview.example.test',
    hasDatabaseUrl: false,
    hasProductionDatabaseUrl: false,
    hasPassword: true,
  });
  assert.doesNotMatch(
    result.stdout,
    /production:production|preview:preview|synthetic-password|must-not-leak/i
  );
});

test('preflight com identidades PostgreSQL coincidentes bloqueia o spawn e não vaza URL', async () => {
  const { result, capture } = await runWithFakeNpx({
    PRODUCTION_DATABASE_URL: REQUIRED_ENV.DATABASE_URL,
  });

  assert.equal(result.status, 1);
  assert.equal(capture, null, 'o falso npx não deveria ter iniciado');
  assert.match(result.stderr, /não pode apontar para produção/);
  assert.doesNotMatch(result.stderr, /preview:preview|production:production/);
});

test('ausência de PREVIEW_BASE_URL ou DATABASE_URL falha antes do spawn', async () => {
  for (const missing of ['PREVIEW_BASE_URL', 'DATABASE_URL']) {
    const { result, capture } = await runWithFakeNpx({ [missing]: undefined });
    assert.equal(result.status, 1, missing);
    assert.equal(capture, null, missing);
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`${missing}: missing`));
  }
});

test('config alternativa do Playwright é recusada antes do spawn', async () => {
  for (const args of [
    ['--config', 'other.config.js'],
    ['--config=other.config.js'],
    ['-c', 'other.config.js'],
    ['-cother.config.js'],
  ]) {
    const { result, capture } = await runWithFakeNpx({}, args);

    assert.equal(result.status, 1, args.join(' '));
    assert.equal(capture, null, args.join(' '));
    assert.match(result.stderr, /configuração alternativa.*recusada/);
  }
});

test('launcher preserva o exit status do Playwright', async () => {
  const { result, capture } = await runWithFakeNpx({}, ['--list'], 7);

  assert.equal(result.status, 7);
  assert.ok(capture, 'o falso npx deveria ter iniciado');
});
