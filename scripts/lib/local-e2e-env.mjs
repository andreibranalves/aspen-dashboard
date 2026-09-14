// O discovery e os filhos do Playwright local nunca carregam configuração operacional.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveE2eBaseUrl } from './e2e-mode.mjs';
import {
  assertDisposableLoopbackDatabaseUrl,
  isAllowedRuntimeKey,
  isOperationalKey,
  safeE2ePort,
} from './safe-e2e-env.mjs';

export function buildLocalE2eEnvironment(env = process.env, { requireDatabase = false } = {}) {
  const port = safeE2ePort(env);
  const baseURL = resolveE2eBaseUrl({ ...env, APP_ENV: 'test' }, { port });
  const target = new globalThis.URL(baseURL);
  if (target.protocol !== 'http:' || Number(target.port || 80) !== port ||
      !['localhost', '127.0.0.1'].includes(target.hostname)) {
    throw new Error('BASE_URL deve usar o servidor HTTP IPv4 local na PLAYWRIGHT_PORT.');
  }
  const testUrl = String(env.TEST_DATABASE_URL || '').trim();
  const databaseUrl = testUrl || requireDatabase
    ? assertDisposableLoopbackDatabaseUrl(testUrl, 'TEST_DATABASE_URL')
    : '';
  if (String(env.DATABASE_URL || '').trim() && env.DATABASE_URL !== databaseUrl) {
    throw new Error('DATABASE_URL deve coincidir com TEST_DATABASE_URL descartável no E2E local.');
  }
  const isolated = Object.fromEntries(Object.entries(env).filter(([key]) =>
    isAllowedRuntimeKey(key) && !isOperationalKey(key) &&
    !key.startsWith('SAFE_E2E_') && key !== 'SAFE_E2E' && key !== 'NODE_PATH'
  ));
  return {
    ...isolated,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    APP_AUTH_BYPASS: 'true',
    EXTERNAL_WRITES_ENABLED: '0',
    DOTENV_CONFIG_PATH: '/dev/null',
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    BASE_URL: baseURL,
    PLAYWRIGHT_PORT: String(port),
    HOST: '127.0.0.1',
    API_PORT: '0',
  };
}

// RELEASE exige o alvo descartável antes de começar a suíte ampla; não abre conexão.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildLocalE2eEnvironment(process.env, { requireDatabase: true });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
