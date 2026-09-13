import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  MIN_INGEST_TOKEN_BYTES,
  NETWORK_GUARD_PATH,
  SAFE_E2E_APP_ENV,
  SAFE_E2E_DOTENV_PATH,
  SAFE_E2E_EGRESS_LOG_VAR,
  SAFE_E2E_MARKER,
  SAFE_E2E_RUN_ID_VAR,
  SAFE_E2E_SERVER_ENTRY,
  SAFE_E2E_SPECS,
  aggregateSafeE2eStatus,
  auditSafeE2eEgressLog,
  buildSafeE2eEnvironment,
  isAllowedRuntimeKey,
  isOperationalKey,
  safeE2eEnvironmentIsValid,
} from '../../scripts/lib/safe-e2e-env.mjs';

const DISPOSABLE_URL = 'postgresql://review:review@127.0.0.1:55432/aspen_safe_e2e';
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SAFE_ENV_MODULE = fileURLToPath(
  new URL('../../scripts/lib/safe-e2e-env.mjs', import.meta.url)
);

/** Ambientes "envenenados": credenciais reais de operação jamais podem chegar. */
const POISONED = {
  EVOLUTION_BASE_URL: 'https://evolution.aspen.example',
  EVOLUTION_API_KEY: 'real-evolution-key',
  EVOLUTION_INSTANCE: 'aspen-production',
  OPENROUTER_API_KEY: 'sk-real-openrouter',
  RESEND_API_KEY: 're_real_resend',
  RESEND_FROM_EMAIL: 'contato@aspenestamparia.com',
  SMTP_PASSWORD: 'smtp-real-secret',
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_real',
  QUOTATION_BLOB_READ_WRITE_TOKEN: 'quotation_blob_real',
  KV_REST_API_URL: 'https://kv.example',
  KV_REST_API_TOKEN: 'kv-real-token',
  SANITY_PROJECT_ID: 'real-project',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'ads-real',
  TYPEBOT_LEAD_WEBHOOK_TOKEN: 'typebot-real',
  META_CAPI_ACCESS_TOKEN: 'meta-real',
  QSTASH_TOKEN: 'qstash-real-token',
  QSTASH_CURRENT_SIGNING_KEY: 'qstash-current-signing-key',
  QSTASH_NEXT_SIGNING_KEY: 'qstash-next-signing-key',
  QSTASH_API_URL: 'https://qstash.upstash.io',
  CRON_SECRET: 'cron-real-secret',
  QUOTATION_FOLLOW_UP_WORKER_URL:
    'https://dashboard.aspenestamparia.com/api/quotation-follow-up-worker',
  QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT: '2026-01-01T00:00:00.000Z',
  QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: 'follow-up-writes-real',
  WHATSAPP_CONTEXT_EXTENSION_ORIGIN: 'chrome-extension://real-extension-id',
  MIGRATION_TARGET_DATABASE_URL: 'postgresql://user:pass@migrate.example:5432/aspen',
  RESTORE_EXPECTED_DATABASE: 'aspen_production_restore',
  CLIENT_CONSOLIDATION_TEMP_DATABASE_URL: 'postgresql://user:pass@consolidate.example:5432/aspen',
  PRODUCTION_DATABASE_URL: 'postgresql://user:pass@prod.example:5432/aspen',
  STAGING_DATABASE_URL: 'postgresql://user:pass@stage.example:5432/aspen',
  PGSSLMODE: 'require',
  CUTOVER_ENV_FILE: '/home/operator/.config/aspen-dashboard/.env',
  LITE_BASELINE_BACKUP_FILE: '/home/operator/backup.sql',
  APP_PASSWORD_HASH: 'real-password-hash',
  APP_SESSION_SECRET: 'real-session-secret',
  E2E_PASSWORD: 'preview-e2e-password',
  BASE_URL: 'https://preview.aspen.example',
  PREVIEW_BASE_URL: 'https://preview.aspen.example',
  VERCEL: 'deployed-vercel-mode',
  VERCEL_PROJECT_PRODUCTION_URL: 'aspen-production.vercel.app',
  DEPLOY_PRIME_URL: 'https://aspen-prime.netlify.app',
  URL: 'https://preview.aspen.example',
  VERCEL_URL: 'aspen-production.vercel.app',
  DEPLOYMENT_URL: 'https://deployment.aspen.example',
  PREVIEW_DEPLOYMENT_URL: 'https://preview-deployment.aspen.example',
  KNOWN_PRODUCTION_PUBLIC_QUOTATION_URL: 'https://aspenestamparia.com/orcamento/known',
  CANARY_BASE_URL: 'https://canary.aspen.example',
  VERCEL_ENV: 'production',
  QUOTE_LEADS_INGEST_TOKEN: 'inherited-ingest-token-0123456789abcdef',
  QUOTE_LEADS_INGEST_PREVIOUS_TOKEN: 'previous-ingest-token-0123456789abcdef',
  NODE_OPTIONS: '--require /tmp/inherited-preload.cjs',
  // npm config aliases (case-insensitive) can rewrite NODE_OPTIONS in the
  // descendants or point npm at a hostile .npmrc; NPM_TOKEN is a credential.
  NPM_TOKEN: 'npm-real-token-sentinel',
  npm_config_node_options: '--no-warnings',
  NPM_CONFIG_NODE_OPTIONS: '--max-old-space-size=64',
  Npm_Config_Node_Options: '--trace-warnings',
  npm_config_userconfig: '/tmp/evil-aspen.npmrc',
  NPM_CONFIG_USERCONFIG: '/tmp/evil-aspen-upper.npmrc',
  npm_config_cache: '/tmp/evil-aspen-cache',
};

const BASE_ENV = { ...POISONED, TEST_DATABASE_URL: DISPOSABLE_URL, PATH: '/usr/bin' };

// Chaves cujo nome é reutilizado com um valor sintético após a remoção: o valor
// herdado nunca sobrevive, mas a chave reaparece controlada pelo runner.
const REPLACED_KEYS = new Set(['BASE_URL', 'QUOTE_LEADS_INGEST_TOKEN']);

test('operational credentials and remote targets are stripped and cannot reach the server', () => {
  const { env } = buildSafeE2eEnvironment(BASE_ENV, {
    egressLog: '/tmp/safe-e2e-test.log',
  });

  for (const key of Object.keys(POISONED)) {
    if (key === 'NODE_OPTIONS') continue; // rebuilt from scratch, asserted below
    if (REPLACED_KEYS.has(key)) {
      assert.notEqual(env[key], POISONED[key], `${key} must not keep its inherited value`);
    } else {
      assert.equal(key in env, false, `${key} must not survive into the isolated environment`);
    }
    assert.equal(isOperationalKey(key), true, `${key} must be classified as operational`);
  }
  for (const value of Object.values(POISONED)) {
    assert.equal(
      Object.values(env).includes(value),
      false,
      'no operational value may appear anywhere in the isolated environment'
    );
  }
  const serialized = JSON.stringify(env);
  assert.equal(serialized.includes('preview.aspen.example'), false);
  assert.equal(serialized.includes('inherited-preload'), false);
  assert.equal(isOperationalKey('BASE_URL'), true);
  assert.equal(env.BASE_URL, 'http://localhost:5173');

  assert.equal(env.APP_ENV, SAFE_E2E_APP_ENV);
  assert.notEqual(env.APP_ENV, 'production');
  assert.equal(env.EXTERNAL_WRITES_ENABLED, '0');
  assert.equal(env.DOTENV_CONFIG_PATH, SAFE_E2E_DOTENV_PATH);
  assert.equal(env[SAFE_E2E_EGRESS_LOG_VAR], '/tmp/safe-e2e-test.log');
  assert.equal(env[SAFE_E2E_MARKER], '1');
  // NODE_OPTIONS é reconstruído do zero; o preload herdado sumiu.
  assert.equal(env.NODE_OPTIONS, `--import ${NETWORK_GUARD_PATH}`);
  assert.equal(safeE2eEnvironmentIsValid(env), true);
});

/**
 * npm reads configuration from case-insensitive `npm_config_*` env aliases and
 * interpolates `${NPM_TOKEN}` in `.npmrc`. `node-options` is the dangerous one:
 * npm assigns it to the child's NODE_OPTIONS, which would drop the egress guard
 * before the app server starts. None of these are test plumbing, and every
 * other `npm_*` alias is discarded by the fail-closed default allowlist.
 */
test('npm config aliases, NPM_TOKEN and unknown npm aliases never reach the server', () => {
  const aliases = {
    npm_config_node_options: '--no-warnings',
    NPM_CONFIG_NODE_OPTIONS: '--max-old-space-size=64',
    Npm_Config_Node_Options: '--trace-warnings',
    npm_config_userconfig: '/tmp/evil-aspen.npmrc',
    NPM_CONFIG_USERCONFIG: '/tmp/evil-aspen-upper.npmrc',
    NPM_TOKEN: 'npm-secret-sentinel',
    npm_lifecycle_event: 'test:e2e:safe',
    npm_package_name: 'aspen-dashboard',
    npm_execpath: '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
  };
  const { env } = buildSafeE2eEnvironment(
    { ...BASE_ENV, ...aliases },
    { egressLog: '/tmp/safe-e2e-test.log' }
  );

  for (const [key, value] of Object.entries(aliases)) {
    assert.equal(key in env, false, `${key} must not survive into the isolated environment`);
    assert.equal(
      Object.values(env).includes(value),
      false,
      `${key} must not leave its value anywhere in the isolated environment`
    );
  }
  for (const key of [
    'npm_config_node_options',
    'NPM_CONFIG_NODE_OPTIONS',
    'Npm_Config_Node_Options',
    'npm_config_userconfig',
    'NPM_CONFIG_USERCONFIG',
    'NPM_TOKEN',
  ]) {
    assert.equal(isOperationalKey(key), true, `${key} must be classified as operational`);
    assert.equal(isAllowedRuntimeKey(key), false, `${key} must not be allowlisted`);
  }
  // Unknown npm aliases are dropped by the fail-closed default, not by name.
  assert.equal(isAllowedRuntimeKey('npm_lifecycle_event'), false);
  assert.equal(isAllowedRuntimeKey('npm_package_name'), false);
  assert.equal(isAllowedRuntimeKey('npm_execpath'), false);
});

test('platform mode and origin URL variables cannot select the deployed Vercel branch', () => {
  // PORT is a legitimate runtime knob (the Vite dev server port) and survives;
  // the deployed-mode branch requires VERCEL, which must never survive.
  const { env } = buildSafeE2eEnvironment(
    { ...BASE_ENV, PORT: '5000' },
    { egressLog: '/tmp/safe-e2e-test.log' }
  );

  for (const key of ['VERCEL', 'VERCEL_PROJECT_PRODUCTION_URL', 'DEPLOY_PRIME_URL', 'URL']) {
    assert.equal(key in env, false, `${key} must not survive into the isolated environment`);
    assert.equal(isOperationalKey(key), true);
  }
  assert.equal(env.PORT, '5000', 'the local Vite port must still be configurable');
  assert.equal(
    Boolean(env.PORT && env.VERCEL),
    false,
    'the current Vite UI branch, not the deployed build branch, must be selected'
  );
});

test('the effective HTTP target is forced to loopback derived from the validated port', () => {
  const { env, baseUrl } = buildSafeE2eEnvironment(
    { ...BASE_ENV, PLAYWRIGHT_PORT: '5311' },
    { egressLog: '/tmp/safe-e2e-test.log' }
  );

  assert.equal(baseUrl, 'http://localhost:5311');
  assert.equal(env.BASE_URL, 'http://localhost:5311');
  assert.equal(env.PLAYWRIGHT_PORT, '5311');
  assert.equal('PREVIEW_BASE_URL' in env, false);
  assert.throws(
    () => buildSafeE2eEnvironment({ ...BASE_ENV, PLAYWRIGHT_PORT: 'not-a-port' }),
    /PLAYWRIGHT_PORT/
  );
  assert.throws(
    () => buildSafeE2eEnvironment({ ...BASE_ENV, PLAYWRIGHT_PORT: '70000' }),
    /PLAYWRIGHT_PORT/
  );
});

test('the ingestion token is synthetic, valid-length and never inherited', () => {
  const inherited = POISONED.QUOTE_LEADS_INGEST_TOKEN;
  const first = buildSafeE2eEnvironment(BASE_ENV).env;
  const second = buildSafeE2eEnvironment(BASE_ENV).env;

  assert.notEqual(first.QUOTE_LEADS_INGEST_TOKEN, inherited);
  assert.ok(
    Buffer.byteLength(first.QUOTE_LEADS_INGEST_TOKEN, 'utf8') >= MIN_INGEST_TOKEN_BYTES,
    'the token must satisfy the machine-auth minimum length'
  );
  assert.notEqual(
    first.QUOTE_LEADS_INGEST_TOKEN,
    second.QUOTE_LEADS_INGEST_TOKEN,
    'each run gets a fresh token'
  );
  assert.ok(first[SAFE_E2E_RUN_ID_VAR], 'the run id must be present');
  assert.notEqual(
    first[SAFE_E2E_RUN_ID_VAR],
    second[SAFE_E2E_RUN_ID_VAR],
    'each run gets a fresh run-scoped id'
  );
  assert.equal('QUOTE_LEADS_INGEST_PREVIOUS_TOKEN' in first, false);
});

test('a non-disposable or mismatched database target fails closed', () => {
  assert.throws(
    () =>
      buildSafeE2eEnvironment({
        TEST_DATABASE_URL: 'postgresql://user:pass@prod.example:5432/aspen',
      }),
    /descartável/
  );
  assert.throws(() => buildSafeE2eEnvironment({}), /TEST_DATABASE_URL/);
  assert.throws(
    () =>
      buildSafeE2eEnvironment({
        TEST_DATABASE_URL: DISPOSABLE_URL,
        DATABASE_URL: 'postgresql://other@127.0.0.1:55432/other',
      }),
    /coincidir/
  );
});

test('the integrated suite list is a single frozen source', () => {
  assert.deepEqual(SAFE_E2E_SPECS, ['tests/commercial-queue-integrated.spec.js']);
  assert.equal(Object.isFrozen(SAFE_E2E_SPECS), true);
  const { env } = buildSafeE2eEnvironment(BASE_ENV, { egressLog: '/tmp/safe-e2e-test.log' });
  assert.equal(safeE2eEnvironmentIsValid(env), true);
});

test('an unsanitized environment is refused as unsafe', () => {
  assert.equal(
    safeE2eEnvironmentIsValid({ ...POISONED, TEST_DATABASE_URL: DISPOSABLE_URL }),
    false
  );
  assert.equal(
    safeE2eEnvironmentIsValid({
      [SAFE_E2E_MARKER]: '1',
      APP_ENV: 'production',
      EXTERNAL_WRITES_ENABLED: '1',
      DOTENV_CONFIG_PATH: SAFE_E2E_DOTENV_PATH,
      [SAFE_E2E_EGRESS_LOG_VAR]: '/tmp/x.log',
      PLAYWRIGHT_PORT: '5173',
      BASE_URL: 'http://127.0.0.1:5173',
    }),
    false
  );
  // Um alvo remoto herdado no BASE_URL reprova mesmo com o resto íntegro.
  assert.equal(
    safeE2eEnvironmentIsValid({
      [SAFE_E2E_MARKER]: '1',
      APP_ENV: SAFE_E2E_APP_ENV,
      EXTERNAL_WRITES_ENABLED: '0',
      DOTENV_CONFIG_PATH: SAFE_E2E_DOTENV_PATH,
      [SAFE_E2E_EGRESS_LOG_VAR]: '/tmp/x.log',
      PLAYWRIGHT_PORT: '5173',
      BASE_URL: 'https://preview.aspen.example',
    }),
    false
  );
});

/**
 * Teste em processo FILHO: prova que a guarda pré-carregada pelo NODE_OPTIONS
 * montado realmente bloqueia um destino não-loopback, sem expor valores.
 */
test('the preloaded guard blocks a non-loopback fetch in a child process', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safe-e2e-guard-'));
  const log = join(dir, 'egress.log');
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        NETWORK_GUARD_PATH,
        '-e',
        `globalThis.fetch('https://remote.invalid/egress').then(() => process.exit(9), (error) => process.exit(String(error.message).includes('SAFE_E2E_EGRESS_BLOCKED') ? 0 : 8));`,
      ],
      {
        cwd: PROJECT_ROOT,
        env: { PATH: process.env.PATH, [SAFE_E2E_EGRESS_LOG_VAR]: log },
        encoding: 'utf8',
      }
    );
    assert.equal(
      result.status,
      0,
      `guarded child must reject remote egress (stderr: ${result.stderr})`
    );
    const lines = readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(
      lines.some((entry) => entry.event === 'guard_initialized'),
      true,
      'the guard must mark its own initialization'
    );
    assert.equal(lines.filter((entry) => entry.event === 'blocked').length, 1);
    assert.equal(JSON.stringify(lines).includes('remote.invalid'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Teste em processo FILHO do construtor de ambiente: prova, num processo real
 * envenenado com credenciais operacionais, que nenhuma chave/valor proibido
 * sobrevive e que o alvo HTTP efetivo é loopback. O driver só imprime
 * conclusões booleanas e a origem loopback — nunca valores operacionais.
 */
test('a poisoned child process strips forbidden keys and resolves to loopback', () => {
  const driver = `
    const { buildSafeE2eEnvironment } = await import(process.env.SAFE_ENV_MODULE);
    const replaced = new Set(['BASE_URL', 'QUOTE_LEADS_INGEST_TOKEN', 'NODE_OPTIONS']);
    const forbidden = JSON.parse(process.env.POISONED_KEYS);
    const sentinels = JSON.parse(process.env.POISONED_VALUES);
    let built;
    try {
      built = buildSafeE2eEnvironment(process.env, { egressLog: '/tmp/safe-e2e-child.log' });
    } catch (error) {
      console.log(JSON.stringify({ built: false, message: String(error && error.message) }));
      process.exit(0);
    }
    const keysLeaked = forbidden.filter((key) => !replaced.has(key) && key in built.env);
    const valuesLeaked = Object.values(built.env).filter((value) => sentinels.includes(value)).length;
    console.log(JSON.stringify({ built: true, keysLeaked, valuesLeaked, baseUrl: built.baseUrl }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...POISONED,
      // The child itself must start; the poisoned NODE_OPTIONS is only a
      // sentinel the builder has to strip in its output.
      NODE_OPTIONS: '',
      TEST_DATABASE_URL: DISPOSABLE_URL,
      PLAYWRIGHT_PORT: '5207',
      PATH: process.env.PATH || '',
      SAFE_ENV_MODULE,
      POISONED_KEYS: JSON.stringify(Object.keys(POISONED)),
      POISONED_VALUES: JSON.stringify(Object.values(POISONED)),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1) || '{}');
  assert.equal(parsed.built, true, result.stdout);
  assert.deepEqual(parsed.keysLeaked, []);
  assert.equal(parsed.valuesLeaked, 0);
  assert.equal(parsed.baseUrl, 'http://localhost:5207');
});

test('aggregateSafeE2eStatus is fail-closed for green Playwright runs', () => {
  const instrumented = { instrumented: true, blocked: 0, malformed: false, entries: 2 };
  assert.equal(aggregateSafeE2eStatus({ playwrightStatus: 0, audit: instrumented }), 0);
  assert.equal(
    aggregateSafeE2eStatus({ playwrightStatus: 0, audit: { ...instrumented, blocked: 1 } }),
    1,
    'a blocked egress fails even when Playwright passed'
  );
  assert.equal(
    aggregateSafeE2eStatus({ playwrightStatus: 0, audit: { ...instrumented, malformed: true } }),
    1,
    'an unreadable audit log fails closed'
  );
  assert.equal(
    aggregateSafeE2eStatus({
      playwrightStatus: 0,
      audit: { instrumented: false, blocked: 0, malformed: false, entries: 0 },
    }),
    1,
    'a missing guard initialization fails closed'
  );
  assert.equal(aggregateSafeE2eStatus({ playwrightStatus: 0, audit: null }), 1);
  assert.equal(aggregateSafeE2eStatus({ playwrightStatus: 1, audit: instrumented }), 1);
  assert.equal(aggregateSafeE2eStatus({ playwrightStatus: null, audit: instrumented }), 1);
});

test('auditSafeE2eEgressLog requires run-scoped, server-attributed evidence', () => {
  assert.deepEqual(auditSafeE2eEgressLog({ exists: false, content: '' }), {
    initialized: false,
    instrumented: false,
    blocked: 0,
    malformed: false,
    entries: 0,
  });

  const entry = (overrides = {}) =>
    JSON.stringify({
      event: 'guard_initialized',
      runId: 'run-abc',
      entry: '/workspace/scripts/app-server.mjs',
      ...overrides,
    });

  // Sem runId/serverEntry informados, qualquer inicialização conta.
  const anyInit = auditSafeE2eEgressLog({
    exists: true,
    content: `${JSON.stringify({ event: 'guard_initialized' })}\n`,
  });
  assert.equal(anyInit.initialized, true);
  assert.equal(anyInit.instrumented, true);

  const serverInit = auditSafeE2eEgressLog({
    exists: true,
    content: `${entry()}\n`,
    runId: 'run-abc',
    serverEntry: SAFE_E2E_SERVER_ENTRY,
  });
  assert.equal(serverInit.instrumented, true);

  // Marcador antigo: mesmo servidor, execução anterior.
  const stale = auditSafeE2eEgressLog({
    exists: true,
    content: `${entry({ runId: 'previous-run' })}\n`,
    runId: 'run-abc',
    serverEntry: SAFE_E2E_SERVER_ENTRY,
  });
  assert.equal(stale.initialized, true);
  assert.equal(stale.instrumented, false, 'a marker from another run must not satisfy the audit');

  // Marcador de outro processo (npx/Playwright), mesmo run.
  const otherProcess = auditSafeE2eEgressLog({
    exists: true,
    content: `${entry({ entry: '/workspace/node_modules/npx-cli.js' })}\n`,
    runId: 'run-abc',
    serverEntry: SAFE_E2E_SERVER_ENTRY,
  });
  assert.equal(otherProcess.initialized, true);
  assert.equal(otherProcess.instrumented, false, 'only the actual server process counts');

  const blocked = auditSafeE2eEgressLog({
    exists: true,
    content: `${entry()}\n${JSON.stringify({ event: 'blocked', host: 'remote.invalid' })}\n`,
    runId: 'run-abc',
    serverEntry: SAFE_E2E_SERVER_ENTRY,
  });
  assert.equal(blocked.blocked, 1);
  assert.equal(blocked.instrumented, true);

  const malformed = auditSafeE2eEgressLog({
    exists: true,
    content: `${entry()}\nnot-json\n`,
    runId: 'run-abc',
    serverEntry: SAFE_E2E_SERVER_ENTRY,
  });
  assert.equal(malformed.malformed, true);

  assert.equal(existsSync(NETWORK_GUARD_PATH), true);
});
