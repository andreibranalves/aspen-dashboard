#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const TEST_ROOT = path.join(PROJECT_ROOT, 'tests', 'unit');

const DISPOSABLE_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const OPERATIONAL_DATABASE_URLS = /^(?:STAGING|PRODUCTION|RESTORE)_DATABASE_URL$/;
const TEST_DATABASE_URLS = /^TEST_.*DATABASE_URL$/;
const POSTGRES_CONNECTION_ENVIRONMENT = /^PG[A-Z0-9_]*$/;
// Operational secrets/identifiers that unit tests must never observe, even in
// environments where only TEST_DATABASE_URL was expected to be relevant.
const OPERATIONAL_ENVIRONMENT_KEYS = new Set([
  'RESTORE_PG_SERVICE',
  'STAGING_PG_SERVICE',
  'PRODUCTION_PG_SERVICE',
  'CUTOVER_PG_SERVICE',
  'OPENROUTER_API_KEY',
  'SMTP_PASSWORD',
  'EVOLUTION_BASE_URL',
  'EVOLUTION_API_KEY',
  'EVOLUTION_INSTANCE',
  'BLOB_READ_WRITE_TOKEN',
  'QUOTATION_BLOB_READ_WRITE_TOKEN',
  'QUOTATION_BLOB_STORE_ID',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'LITE_BASELINE_TAG',
  'LITE_BASELINE_BACKUP_FILE',
]);

export function isDisposablePostgresUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      DISPOSABLE_DATABASE_HOSTS.has(url.hostname) &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

export function parseTapSkippedCount(output) {
  const matches = [...String(output || '').matchAll(/^# skipped (\d+)$/gm)];
  if (matches.length === 0)
    throw new Error('Resumo TAP não informa a contagem de testes ignorados.');
  return Number(matches.at(-1)[1]);
}

export function createDisposableTestEnvironment(env, databaseUrl) {
  const isolated = { ...env, TEST_DATABASE_URL: databaseUrl, TZ: 'UTC' };
  for (const key of Object.keys(isolated)) {
    if (TEST_DATABASE_URLS.test(key)) isolated[key] = databaseUrl;
    if (
      key === 'DATABASE_URL' ||
      OPERATIONAL_DATABASE_URLS.test(key) ||
      POSTGRES_CONNECTION_ENVIRONMENT.test(key) ||
      OPERATIONAL_ENVIRONMENT_KEYS.has(key)
    ) {
      delete isolated[key];
    }
  }
  return isolated;
}

export function evaluatePostgresRun({ status, output }) {
  if (status !== 0) return { ok: false, reason: 'test-failure' };

  const skipped = parseTapSkippedCount(output);
  if (skipped > 0) return { ok: false, reason: 'skipped-tests', skipped };

  return { ok: true, skipped };
}

// Run the complete unit corpus so every database-gated test is enabled; the
// strict skipped-count check prevents this lane from silently shrinking.
function testFiles() {
  return readdirSync(TEST_ROOT)
    .filter((file) => /\.test\.(?:js|ts)$/.test(file))
    .sort()
    .map((file) => path.join('tests', 'unit', file));
}

export function runPostgresTests({ env = process.env, execute = spawnSync } = {}) {
  if (!String(env.TEST_DATABASE_URL || '').trim()) {
    process.stderr.write('FAIL testes PostgreSQL: TEST_DATABASE_URL é obrigatória.\n');
    return 1;
  }
  if (!isDisposablePostgresUrl(env.TEST_DATABASE_URL)) {
    process.stderr.write(
      'FAIL testes PostgreSQL: TEST_DATABASE_URL deve apontar para um PostgreSQL local descartável.\n'
    );
    return 1;
  }

  const result = execute(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-reporter=tap', ...testFiles()],
    {
      cwd: PROJECT_ROOT,
      env: createDisposableTestEnvironment(env, env.TEST_DATABASE_URL),
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    }
  );
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  if (result.error) {
    process.stderr.write('FAIL testes PostgreSQL: não foi possível iniciar o runner.\n');
    return 1;
  }

  let evaluation;
  try {
    evaluation = evaluatePostgresRun({ status: result.status, output });
  } catch {
    process.stderr.write('FAIL testes PostgreSQL: resultado sem resumo verificável.\n');
    return 1;
  }

  if (evaluation.reason === 'skipped-tests') {
    process.stderr.write(
      `FAIL testes PostgreSQL: ${evaluation.skipped} teste(s) foram ignorados.\n`
    );
    return 1;
  }

  return evaluation.ok ? 0 : result.status || 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  process.exitCode = runPostgresTests();
}
