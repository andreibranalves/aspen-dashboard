#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = path.join(PROJECT_ROOT, 'docker-compose.test.yml');
const PROJECT_NAME = process.env.TEST_POSTGRES_PROJECT || 'aspen-test-db';
const PORT = String(process.env.TEST_POSTGRES_PORT || '55432');
const DATABASE_URL = `postgresql://aspen_test:aspen_test@127.0.0.1:${PORT}/aspen_test`;
const KEEP = process.argv.includes('--keep');
const composeEnvironment = { ...process.env, TEST_POSTGRES_PORT: PORT };

function compose(args, options = {}) {
  const result = spawnSync(
    'docker',
    ['compose', '--project-name', PROJECT_NAME, '--file', COMPOSE_FILE, ...args],
    {
      cwd: PROJECT_ROOT,
      env: composeEnvironment,
      stdio: options.stdio || 'inherit',
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function runTests() {
  const result = spawnSync('npm', ['run', 'test:postgres'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      TEST_DATABASE_URL: DATABASE_URL,
      TEST_QUOTE_DATABASE_URL: DATABASE_URL,
      TEST_POSTGRES_PORT: PORT,
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

let exitCode = 1;
try {
  if (compose(['up', '--detach', '--wait']) !== 0) {
    throw new Error('Não foi possível iniciar o PostgreSQL de testes.');
  }
  exitCode = runTests();
} catch (error) {
  process.stderr.write(`FAIL banco PostgreSQL de testes: ${error.message}\n`);
} finally {
  if (!KEEP) {
    const cleanupCode = compose(['down', '--volumes', '--remove-orphans']);
    if (cleanupCode !== 0 && exitCode === 0) exitCode = cleanupCode;
  } else {
    process.stdout.write(`PostgreSQL mantido em ${DATABASE_URL}\n`);
  }
}

process.exitCode = exitCode;
