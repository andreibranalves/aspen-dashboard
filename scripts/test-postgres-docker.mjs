#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = path.join(PROJECT_ROOT, 'docker-compose.test.yml');

export function npmInvocation({
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
} = {}) {
  const npmExecPath = String(env.npm_execpath || '').trim();
  if (npmExecPath) {
    return {
      command: execPath,
      args: [npmExecPath, 'run', 'test:postgres'],
    };
  }
  return {
    command: platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'test:postgres'],
  };
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : 'erro desconhecido';
}

export function runDockerPostgres({
  env = process.env,
  argv = process.argv.slice(2),
  execute = spawnSync,
  execPath = process.execPath,
  platform = process.platform,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const projectName = env.TEST_POSTGRES_PROJECT || 'aspen-test-db';
  const port = String(env.TEST_POSTGRES_PORT || '55432');
  const databaseUrl = `postgresql://aspen_test:aspen_test@127.0.0.1:${port}/aspen_test`;
  const keep = argv.includes('--keep');
  const composeEnvironment = { ...env, TEST_POSTGRES_PORT: port };

  function compose(args) {
    const result = execute(
      'docker',
      ['compose', '--project-name', projectName, '--file', COMPOSE_FILE, ...args],
      {
        cwd: PROJECT_ROOT,
        env: composeEnvironment,
        stdio: 'inherit',
      },
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
  }

  function runTests() {
    const invocation = npmInvocation({ env, execPath, platform });
    const result = execute(invocation.command, invocation.args, {
      cwd: PROJECT_ROOT,
      env: {
        ...env,
        TEST_DATABASE_URL: databaseUrl,
        TEST_QUOTE_DATABASE_URL: databaseUrl,
        TEST_POSTGRES_PORT: port,
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
    stderr.write(`FAIL banco PostgreSQL de testes: ${errorMessage(error)}\n`);
  } finally {
    if (!keep) {
      try {
        const cleanupCode = compose(['down', '--volumes', '--remove-orphans']);
        if (cleanupCode !== 0) {
          stderr.write('FAIL cleanup do PostgreSQL de testes.\n');
          if (exitCode === 0) exitCode = cleanupCode;
        }
      } catch (error) {
        stderr.write(`FAIL cleanup do PostgreSQL de testes: ${errorMessage(error)}\n`);
        if (exitCode === 0) exitCode = 1;
      }
    } else {
      stdout.write(`PostgreSQL mantido em ${databaseUrl}\n`);
    }
  }

  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  process.exitCode = runDockerPostgres();
}
