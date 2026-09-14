import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { runPreviewE2e } from '../../scripts/run-preview-e2e.mjs';
import { inspectOperationEnv } from '../../scripts/lib/operation-env.mjs';
import {
  assertSafeE2eCapability,
  createSafeE2eCapability,
  deleteSafeE2eCapability,
} from '../../scripts/lib/safe-e2e-capability.mjs';
import { PREVIEW_E2E_SPECS } from '../../scripts/lib/preview-e2e-specs.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CAPABILITY_MODULE_URL = pathToFileURL(
  path.join(PROJECT_ROOT, 'scripts/lib/safe-e2e-capability.mjs')
).href;
const PREVIEW_SPECS_MODULE_URL = pathToFileURL(
  path.join(PROJECT_ROOT, 'scripts/lib/preview-e2e-specs.mjs')
).href;

const REQUIRED_ENV = {
  PREVIEW_BASE_URL: 'https://preview.example.test',
  DATABASE_URL: 'postgresql://preview:preview@preview.example:5432/aspen_preview',
  PRODUCTION_DATABASE_URL: 'postgresql://production:production@production.example:5432/aspen',
  E2E_USERNAME: 'operator',
  E2E_PASSWORD: 'synthetic-password',
  PREVIEW_E2E_USERNAME: 'operator',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-vercel-bypass-secret',
  KNOWN_POSTGRES_QUOTATION_ID: '00000000-0000-4000-8000-000000000001',
  KNOWN_POSTGRES_SCRATCH_QUOTATION_ID: 'ORC-20269999',
  PREVIEW_EGRESS_BLOCKED: '1',
  PREVIEW_FIXTURE_RESET: '1',
};

function outputBuffer() {
  let value = '';
  return {
    write(chunk) { value += String(chunk); },
    read() { return value; },
  };
}

async function runWithFakeNpxProcess(extraArgs = []) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aspen-preview-e2e-env-'));
  const configPath = path.join(directory, 'preview.env');
  const fakeNpx = path.join(directory, 'npx');
  const capturePath = path.join(directory, 'capture.json');

  await writeFile(
    configPath,
    Object.entries(REQUIRED_ENV)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600 }
  );
  await chmod(configPath, 0o600);
  await writeFile(
    fakeNpx,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const { assertSafeE2eCapability } = await import(${JSON.stringify(CAPABILITY_MODULE_URL)});
const { PREVIEW_E2E_SPECS } = await import(${JSON.stringify(PREVIEW_SPECS_MODULE_URL)});
const args = process.argv.slice(2);
let capabilityValid = false;
try {
  assertSafeE2eCapability(process.env, {
    config: 'playwright.config.js',
    specs: PREVIEW_E2E_SPECS,
  });
  capabilityValid = true;
} catch {
  // Capture a false value without exposing any capability material.
}
const capabilityPath = process.env.SAFE_E2E_CAPABILITY_PATH || '';
writeFileSync(join(process.env.TMPDIR, 'capture.json'), JSON.stringify({
  args,
  APP_ENV: process.env.APP_ENV,
  EXTERNAL_WRITES_ENABLED: process.env.EXTERNAL_WRITES_ENABLED,
  DOTENV_CONFIG_PATH: process.env.DOTENV_CONFIG_PATH,
  PREVIEW_BASE_URL: process.env.PREVIEW_BASE_URL,
  hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
  hasProductionDatabaseUrl: Boolean(process.env.PRODUCTION_DATABASE_URL),
  hasPassword: Boolean(process.env.E2E_PASSWORD),
  hasVercelBypassSecret: Boolean(process.env.VERCEL_AUTOMATION_BYPASS_SECRET),
  hasInheritedSentinel: Boolean(process.env.PREVIEW_RUN_SENTINEL),
  hasCapabilityRunId: Boolean(process.env.SAFE_E2E_RUN_ID),
  hasCapabilityPath: Boolean(capabilityPath),
  hasCapabilityProof: Boolean(process.env.SAFE_E2E_CAPABILITY_PROOF),
  capabilityFileLive: Boolean(capabilityPath && existsSync(capabilityPath)),
  capabilityValid,
  capabilityPath,
}));
process.exit(0);
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
  const capabilityPath = capture?.capabilityPath || null;
  if (capture) delete capture.capabilityPath;
  const capabilityExistsAfterExit = capabilityPath ? existsSync(capabilityPath) : null;
  const capabilityDirectoriesAfterExit = (await readdir(directory)).filter((entry) =>
    entry.startsWith('aspen-safe-e2e-cap-')
  );
  const configMode = (await stat(configPath)).mode & 0o777;
  await rm(directory, { recursive: true, force: true });
  return {
    result,
    capture,
    capabilityExistsAfterExit,
    capabilityDirectoriesAfterExit,
    configMode,
  };
}

async function runWithFakeNpx(overrides = {}, extraArgs = [], fakeExitCode = 0, reset = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aspen-preview-e2e-env-'));
  const values = { ...REQUIRED_ENV, ...overrides };
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const resetCalls = [];
  const events = [];
  let capture = null;

  const resetFixture = async () => {
    const phase = resetCalls.length === 0 ? 'pre' : 'post';
    resetCalls.push(phase);
    events.push(phase);
    if (reset.failOn === resetCalls.length) throw new Error(reset.error || 'synthetic reset failure');
  };
  const fakeSpawn = (command, args, options) => {
    assert.equal(command, 'npx');
    events.push('spawn');
    const childEnv = options.env;
    let capabilityValid = false;
    try {
      assertSafeE2eCapability(childEnv, {
        config: 'playwright.config.js',
        specs: PREVIEW_E2E_SPECS,
      });
      capabilityValid = true;
    } catch {
      // Capture a false value without exposing capability material.
    }
    const capabilityPath = childEnv.SAFE_E2E_CAPABILITY_PATH || '';
    capture = {
      args,
      APP_ENV: childEnv.APP_ENV,
      EXTERNAL_WRITES_ENABLED: childEnv.EXTERNAL_WRITES_ENABLED,
      DOTENV_CONFIG_PATH: childEnv.DOTENV_CONFIG_PATH,
      PREVIEW_BASE_URL: childEnv.PREVIEW_BASE_URL,
      hasDatabaseUrl: Boolean(childEnv.DATABASE_URL),
      hasProductionDatabaseUrl: Boolean(childEnv.PRODUCTION_DATABASE_URL),
      hasPassword: Boolean(childEnv.E2E_PASSWORD),
      hasVercelBypassSecret: Boolean(childEnv.VERCEL_AUTOMATION_BYPASS_SECRET),
      hasInheritedSentinel: Boolean(childEnv.PREVIEW_RUN_SENTINEL),
      hasCapabilityRunId: Boolean(childEnv.SAFE_E2E_RUN_ID),
      hasCapabilityPath: Boolean(capabilityPath),
      hasCapabilityProof: Boolean(childEnv.SAFE_E2E_CAPABILITY_PROOF),
      capabilityFileLive: Boolean(capabilityPath && existsSync(capabilityPath)),
      capabilityValid,
      capabilityPath,
    };
    return { status: fakeExitCode };
  };

  const result = await runPreviewE2e({
    env: { ...values, HOME: directory, TMPDIR: directory, PREVIEW_RUN_SENTINEL: 'must-not-leak' },
    args: extraArgs,
    spawn: fakeSpawn,
    resetFixture,
    createCapability: (options) => {
      events.push('create');
      return createSafeE2eCapability({ ...options, dir: directory });
    },
    deleteCapability: (capability) => {
      events.push('delete');
      if (reset.deleteFails) throw new Error(reset.error || 'synthetic capability cleanup failure');
      return deleteSafeE2eCapability(capability);
    },
    inspectEnv: (env) => inspectOperationEnv('preview-e2e', { env, exists: () => false }),
    stdout,
    stderr,
  });

  const capabilityPath = capture?.capabilityPath || null;
  if (capture) delete capture.capabilityPath;
  const capabilityExistsAfterExit = capabilityPath ? existsSync(capabilityPath) : null;
  const capabilityDirectoriesAfterExit = (await readdir(directory)).filter((entry) =>
    entry.startsWith('aspen-safe-e2e-cap-')
  );
  await rm(directory, { recursive: true, force: true });
  return {
    result: { status: result, stdout: stdout.read(), stderr: stderr.read() },
    capture,
    resetCalls,
    events,
    capabilityExistsAfterExit,
    capabilityDirectoriesAfterExit,
  };
}

test('seam público carrega a configuração externa e isola o filho do runner', async () => {
  const extraArgs = [
    '--list',
    '--grep',
    '@quotations',
    '--grep=@smoke',
    '--grep-invert',
    '@database',
    '--grep-invert=@critical',
  ];
  const {
    result,
    capture,
    configMode,
    capabilityExistsAfterExit,
    capabilityDirectoriesAfterExit,
  } = await runWithFakeNpxProcess(extraArgs);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(configMode, 0o600);
  assert.deepEqual(capture, {
    args: [
      'playwright',
      'test',
      'tests/postgres-only-cutover.spec.js',
      'tests/quotation-cutover-preview.spec.js',
      ...extraArgs,
    ],
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    DOTENV_CONFIG_PATH: '/dev/null',
    PREVIEW_BASE_URL: 'https://preview.example.test',
    hasDatabaseUrl: false,
    hasProductionDatabaseUrl: false,
    hasPassword: true,
    hasVercelBypassSecret: true,
    hasInheritedSentinel: false,
    hasCapabilityRunId: true,
    hasCapabilityPath: true,
    hasCapabilityProof: true,
    capabilityFileLive: true,
    capabilityValid: true,
  });
  assert.equal(capabilityExistsAfterExit, false);
  assert.deepEqual(capabilityDirectoriesAfterExit, []);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /production:production|preview:preview|synthetic-password|synthetic-vercel-bypass-secret|must-not-leak/i
  );
});

test('launcher executa --list sem reset e repassa filtros sem segredos de banco', async () => {
  const { result, capture, resetCalls } = await runWithFakeNpx(
    {},
    [
      '--list',
      '--grep',
      '@quotations',
      '--grep=@smoke',
      '--grep-invert',
      '@database',
      '--grep-invert=@critical',
    ]
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(resetCalls, []);
  assert.deepEqual(capture, {
    args: [
      'playwright',
      'test',
      'tests/postgres-only-cutover.spec.js',
      'tests/quotation-cutover-preview.spec.js',
      '--list',
      '--grep',
      '@quotations',
      '--grep=@smoke',
      '--grep-invert',
      '@database',
      '--grep-invert=@critical',
    ],
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    DOTENV_CONFIG_PATH: '/dev/null',
    PREVIEW_BASE_URL: 'https://preview.example.test',
    hasDatabaseUrl: false,
    hasProductionDatabaseUrl: false,
    hasPassword: true,
    hasVercelBypassSecret: true,
    hasInheritedSentinel: false,
    hasCapabilityRunId: true,
    hasCapabilityPath: true,
    hasCapabilityProof: true,
    capabilityFileLive: true,
    capabilityValid: true,
  });
  assert.doesNotMatch(
    result.stdout,
    /production:production|preview:preview|synthetic-password|synthetic-vercel-bypass-secret|must-not-leak/i
  );
});

test('execução real chama pre-reset e post-reset', async () => {
  const { result, resetCalls } = await runWithFakeNpx({}, [], 0);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(resetCalls, ['pre', 'post']);
});

test('ordem de execução remove capability antes do post-reset', async () => {
  const { result, events } = await runWithFakeNpx();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(events, ['pre', 'create', 'spawn', 'delete', 'post']);
});

test('falha de pre-reset impede fake npx', async () => {
  const { result, capture, resetCalls } = await runWithFakeNpx({}, [], 0, { failOn: 1 });
  assert.equal(result.status, 1);
  assert.equal(capture, null);
  assert.deepEqual(resetCalls, ['pre']);
  assert.match(result.stderr, /pre-reset/);
});

test('falha de post-reset converte sucesso do fake npx em exit 1', async () => {
  const { result, capture, resetCalls } = await runWithFakeNpx({}, [], 0, { failOn: 2 });
  assert.equal(result.status, 1);
  assert.ok(capture);
  assert.deepEqual(resetCalls, ['pre', 'post']);
  assert.match(result.stderr, /post-reset/);
});

test('falha de remoção da capability ainda executa post-reset e retorna exit 1', async () => {
  const { result, resetCalls, events } = await runWithFakeNpx({}, [], 0, {
    deleteFails: true,
    error: 'raw-capability-cleanup-secret',
  });
  assert.equal(result.status, 1);
  assert.deepEqual(resetCalls, ['pre', 'post']);
  assert.deepEqual(events, ['pre', 'create', 'spawn', 'delete', 'post']);
  assert.match(result.stderr, /remoção da capability/);
  assert.doesNotMatch(result.stderr, /raw-capability-cleanup-secret/i);
});

test('falha do reset não imprime URL, segredo ou erro bruto', async () => {
  const { result } = await runWithFakeNpx({}, [], 0, {
    failOn: 1,
    error: 'raw-error-secret-sentinel',
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /raw-error|secret-sentinel/i);
  assert.match(result.stderr, /pre-reset/);
});

test('exit não zero do Playwright é preservado quando cleanup passa', async () => {
  const { result, resetCalls } = await runWithFakeNpx({}, [], 7);
  assert.equal(result.status, 7);
  assert.deepEqual(resetCalls, ['pre', 'post']);
});

test('preflight com identidades PostgreSQL coincidentes bloqueia o spawn e não vaza URL', async () => {
  const { result, capture, resetCalls } = await runWithFakeNpx({
    PRODUCTION_DATABASE_URL: REQUIRED_ENV.DATABASE_URL,
  });

  assert.equal(result.status, 1);
  assert.equal(capture, null);
  assert.deepEqual(resetCalls, []);
  assert.match(result.stderr, /não pode apontar para produção/);
  assert.doesNotMatch(result.stderr, /preview:preview|production:production/);
});

test('ausência de PREVIEW_BASE_URL, DATABASE_URL ou segredo de bypass falha antes do spawn', async () => {
  for (const missing of ['PREVIEW_BASE_URL', 'DATABASE_URL', 'VERCEL_AUTOMATION_BYPASS_SECRET']) {
    const { result, capture, resetCalls } = await runWithFakeNpx({ [missing]: undefined });
    assert.equal(result.status, 1, missing);
    assert.equal(capture, null, missing);
    assert.deepEqual(resetCalls, [], missing);
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`${missing}: missing`));
  }
});

test('allowlist do Playwright recusa overrides, specs, aliases e valores ausentes antes da capability', async () => {
  const rejectedArguments = [
    ['--trace', 'on'],
    ['--trace=on'],
    ['--ui'],
    ['--debug'],
    ['--reporter', 'line'],
    ['--reporter=line'],
    ['--config', 'other.config.js'],
    ['--config=other.config.js'],
    ['-c', 'other.config.js'],
    ['-cother.config.js'],
    ['tests/quotation-cutover-preview.spec.js'],
    ['--unknown-preview-flag'],
    ['loose-value'],
    ['--grep'],
    ['--grep-invert'],
    ['--grep='],
    ['--grep-invert='],
  ];

  for (const args of rejectedArguments) {
    const { result, capture, resetCalls, capabilityDirectoriesAfterExit } = await runWithFakeNpx({}, args);

    assert.equal(result.status, 1, args.join(' '));
    assert.equal(capture, null, args.join(' '));
    assert.deepEqual(resetCalls, [], args.join(' '));
    assert.deepEqual(capabilityDirectoriesAfterExit, [], args.join(' '));
    assert.match(result.stderr, new RegExp(`Argumento do Playwright recusado: ${args[0]}`));
    assert.doesNotMatch(result.stderr, /synthetic-vercel-bypass-secret|synthetic-password/);
  }
});

test('origem HTTP de Preview é recusada antes do spawn', async () => {
  const { result, capture, resetCalls, capabilityDirectoriesAfterExit } = await runWithFakeNpx({
    PREVIEW_BASE_URL: 'http://preview.example.test',
  });

  assert.equal(result.status, 1);
  assert.equal(capture, null);
  assert.deepEqual(resetCalls, []);
  assert.deepEqual(capabilityDirectoriesAfterExit, []);
  assert.match(`${result.stdout}\n${result.stderr}`, /HTTPS/);
  assert.doesNotMatch(result.stderr, /synthetic-vercel-bypass-secret/);
});

test('capability fica viva no spawn e é removida após sucesso ou falha do Playwright', async () => {
  for (const fakeExitCode of [0, 7]) {
    const { result, capture, capabilityExistsAfterExit } = await runWithFakeNpx(
      {},
      ['--list'],
      fakeExitCode
    );

    assert.equal(result.status, fakeExitCode);
    assert.ok(capture);
    assert.equal(capture.capabilityValid, true);
    assert.equal(capture.capabilityFileLive, true);
    assert.equal(capabilityExistsAfterExit, false);
  }
});
