import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

import {
  buildSafeE2eEnvironment,
  SAFE_E2E_CONFIG_FILE,
  SAFE_E2E_RUN_ID_VAR,
  SAFE_E2E_SPECS,
} from '../../scripts/lib/safe-e2e-env.mjs';
import {
  createSafeE2eCapability,
  deleteSafeE2eCapability,
  SAFE_E2E_CAPABILITY_PATH_VAR,
  SAFE_E2E_CAPABILITY_PROOF_VAR,
} from '../../scripts/lib/safe-e2e-capability.mjs';

const configUrl = new URL('../../playwright.config.js', import.meta.url);
const missingEnvPath = fileURLToPath(new URL('./missing-playwright.env', import.meta.url));
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const playwrightCli = fileURLToPath(
  new URL('../../node_modules/@playwright/test/cli.js', import.meta.url)
);
const disposableDatabaseUrl = 'postgresql://review:review@127.0.0.1:55432/aspen_safe_e2e';
const probe = `
  const { default: config } = await import(${JSON.stringify(configUrl.href)});
  process.stdout.write(JSON.stringify({
    workers: config.workers,
    webServer: Boolean(config.webServer),
    testMatch: config.testMatch || null,
    testIgnore: config.testIgnore || null,
    baseURL: config.use.baseURL,
    environmentBaseURL: process.env.BASE_URL,
  }));
`;

function loadConfig(env) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: projectRoot,
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

/**
 * Real Playwright discovery against the ORDINARY config (the one used by
 * `test:e2e` and `--grep @smoke`). It imports every spec file it discovers, so
 * it is the seam where a forged marker previously loaded the integrated spec.
 */
function discover(args, env) {
  return spawnSync(process.execPath, [playwrightCli, 'test', '--list', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: missingEnvPath,
      ...env,
    },
  });
}

/** Real Playwright discovery/load against the DEDICATED safe config. */
function discoverSafe(args, env) {
  return spawnSync(
    process.execPath,
    [playwrightCli, 'test', '--config', SAFE_E2E_CONFIG_FILE, '--list', ...args],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DOTENV_CONFIG_PATH: missingEnvPath,
        ...env,
      },
    }
  );
}

/** Ambiente seguro completo + capability viva, como o runner entrega ao filho. */
function safeEnvWithCapability({
  env: envOverrides,
  capability: capabilityOverrides,
  mutator,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'safe-e2e-config-'));
  const { env, runId } = buildSafeE2eEnvironment(
    { PATH: process.env.PATH, HOME: process.env.HOME, TEST_DATABASE_URL: disposableDatabaseUrl },
    { egressLog: join(dir, 'egress.log') }
  );
  const capability = createSafeE2eCapability({ runId, ...capabilityOverrides });
  let fullEnv = {
    ...env,
    ...envOverrides,
    [SAFE_E2E_CAPABILITY_PATH_VAR]: capability.path,
    [SAFE_E2E_CAPABILITY_PROOF_VAR]: capability.proof,
  };
  if (mutator) fullEnv = mutator(fullEnv, capability) || fullEnv;
  return { dir, capability, baseEnv: env, env: fullEnv };
}

test('APP_ENV=development mantém servidor local e ignora specs Preview e integrada', () => {
  const config = loadConfig({ APP_ENV: 'development', BASE_URL: 'http://127.0.0.1:5173' });
  assert.equal(config.workers, 2);
  assert.equal(config.webServer, true);
  assert.deepEqual(config.testIgnore, [
    'tests/postgres-only-cutover.spec.js',
    'tests/quotation-cutover-preview.spec.js',
    ...SAFE_E2E_SPECS,
  ]);
  assert.equal(config.baseURL, 'http://127.0.0.1:5173');
});

test('o marcador SAFE_E2E isolado não libera a suíte integrada no modo local', () => {
  const config = loadConfig({
    APP_ENV: 'development',
    BASE_URL: 'http://127.0.0.1:5173',
    SAFE_E2E: '1',
  });
  assert.deepEqual(
    config.testIgnore,
    [
      'tests/postgres-only-cutover.spec.js',
      'tests/quotation-cutover-preview.spec.js',
      ...SAFE_E2E_SPECS,
    ],
    'um marcador herdado do shell não comprova o ambiente seguro completo'
  );
});

test('a config comum nunca libera a suíte integrada, nem com o ambiente seguro completo', () => {
  const { dir, capability, env } = safeEnvWithCapability();
  try {
    const config = loadConfig(env);
    assert.deepEqual(
      config.testIgnore,
      [
        'tests/postgres-only-cutover.spec.js',
        'tests/quotation-cutover-preview.spec.js',
        ...SAFE_E2E_SPECS,
      ],
      'a suíte integrada só existe na config dedicada, nunca na comum'
    );
  } finally {
    deleteSafeE2eCapability(capability);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('APP_ENV=preview usa origem remota, um worker e nenhum servidor local', () => {
  const config = loadConfig({
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    PREVIEW_BASE_URL: 'https://preview.example.test',
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

test('Preview rejeita BASE_URL fora da origem do deployment', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOTENV_CONFIG_PATH: missingEnvPath,
      APP_ENV: 'preview',
      EXTERNAL_WRITES_ENABLED: '0',
      PREVIEW_BASE_URL: 'https://preview.example.test',
      BASE_URL: 'https://outside.example.test',
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BASE_URL must match PREVIEW_BASE_URL during Preview E2E/);
});

const FORGED_PUBLIC_ENV = {
  SAFE_E2E: '1',
  APP_ENV: 'test',
  EXTERNAL_WRITES_ENABLED: '0',
  DOTENV_CONFIG_PATH: '/dev/null',
  SAFE_E2E_EGRESS_LOG: '/tmp/forged-safe-e2e.log',
  SAFE_E2E_RUN_ID: 'forged',
  PLAYWRIGHT_PORT: '5173',
  BASE_URL: 'http://localhost:5173',
};

// O bug original do CI: o discovery do Playwright importa TODOS os specs antes
// de aplicar `--grep`, então o guard de topo do spec integrado derrubava
// `test:e2e:smoke`. Estes testes usam o `--list` real (que importa arquivos e
// respeita testMatch/testIgnore) sem subir servidor nem browser.
test('a descoberta comum de @smoke não importa a suíte integrada', () => {
  const result = discover(['--grep', '@smoke'], {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /@smoke/);
  assert.equal(
    result.stdout.includes('commercial-queue-integrated.spec.js'),
    false,
    'o spec integrado só pode ser descoberto pela config dedicada'
  );
});

test('o marcador herdado do shell não faz a descoberta comum importar a suíte integrada', () => {
  const result = discover(['--grep', '@smoke'], { SAFE_E2E: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /ponto de entrada seguro/);
  assert.equal(result.stdout.includes('commercial-queue-integrated.spec.js'), false);
});

// Regressão do finding bloqueante: um conjunto público e barato de variáveis
// "seguras" satisfazia a validação antiga e liberava o spec na config comum.
test('um ambiente público SAFE_E2E completo não faz a descoberta comum importar a suíte integrada', () => {
  for (const args of [[], ['--grep', '@smoke']]) {
    const result = discover(args, FORGED_PUBLIC_ENV);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /ponto de entrada seguro/);
    assert.equal(
      result.stdout.includes('commercial-queue-integrated.spec.js'),
      false,
      `discovery ${JSON.stringify(args)} não pode importar o spec integrado`
    );
  }
});

test('um environment file com o conjunto público completo não faz a descoberta comum importar a suíte integrada', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safe-e2e-envfile-'));
  const envFile = join(dir, 'forged.env');
  try {
    writeFileSync(
      envFile,
      Object.entries(FORGED_PUBLIC_ENV)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n'
    );
    const result = discover([], { DOTENV_CONFIG_PATH: envFile });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /ponto de entrada seguro/);
    assert.equal(result.stdout.includes('commercial-queue-integrated.spec.js'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a invocação direta e insegura do spec integrado falha sem importá-lo', () => {
  const result = discover([...SAFE_E2E_SPECS], {});
  assert.notEqual(result.status, 0, 'a execução direta não pode passar em silêncio');
  assert.match(result.stderr, /No tests found/);
  assert.equal(result.stdout.includes('commercial-queue-integrated.spec.js'), false);
});

test('a config dedicada sem capability falha antes de qualquer servidor', () => {
  const result = discoverSafe([...SAFE_E2E_SPECS], FORGED_PUBLIC_ENV);
  assert.notEqual(result.status, 0, 'sem capability a config dedicada não pode carregar');
  assert.match(result.stderr, /capability do E2E seguro/);
});

test('a config dedicada com capability viva descobre exatamente a suíte integrada', () => {
  const { dir, capability, env } = safeEnvWithCapability();
  try {
    const result = discoverSafe([...SAFE_E2E_SPECS], env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /commercial-queue-integrated\.spec\.js/);
    assert.match(result.stdout, /Total: 4 tests in 1 file/);
  } finally {
    deleteSafeE2eCapability(capability);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('capability ausente, prova errada e runId divergente falham fechado', () => {
  const removed = safeEnvWithCapability();
  try {
    delete removed.env[SAFE_E2E_CAPABILITY_PATH_VAR];
    delete removed.env[SAFE_E2E_CAPABILITY_PROOF_VAR];
    const noCapability = discoverSafe([...SAFE_E2E_SPECS], removed.env);
    assert.notEqual(noCapability.status, 0);
    assert.match(noCapability.stderr, /capability do E2E seguro/);
  } finally {
    deleteSafeE2eCapability(removed.capability);
    rmSync(removed.dir, { recursive: true, force: true });
  }

  const wrongProof = safeEnvWithCapability({
    mutator: (env) => ({ ...env, [SAFE_E2E_CAPABILITY_PROOF_VAR]: 'a'.repeat(64) }),
  });
  try {
    const result = discoverSafe([...SAFE_E2E_SPECS], wrongProof.env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /prova inválida/);
  } finally {
    deleteSafeE2eCapability(wrongProof.capability);
    rmSync(wrongProof.dir, { recursive: true, force: true });
  }

  const wrongRun = safeEnvWithCapability({
    mutator: (env) => ({ ...env, [SAFE_E2E_RUN_ID_VAR]: 'another-run' }),
  });
  try {
    const result = discoverSafe([...SAFE_E2E_SPECS], wrongRun.env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /runId divergente/);
  } finally {
    deleteSafeE2eCapability(wrongRun.capability);
    rmSync(wrongRun.dir, { recursive: true, force: true });
  }
});

test('capability expirada, malformada, pública, de outra config ou de outra suíte falha fechado', () => {
  const cases = [
    {
      name: 'expirada',
      mutator: (_env, capability) => {
        const payload = JSON.parse(readFileSync(capability.path, 'utf8'));
        payload.createdAt = Date.now() - 1000;
        payload.expiresAt = Date.now() - 1;
        writeFileSync(capability.path, JSON.stringify(payload), { mode: 0o600 });
      },
      pattern: /expirada/,
    },
    {
      name: 'malformada',
      mutator: (_env, capability) => {
        writeFileSync(capability.path, 'not-json', { mode: 0o600 });
      },
      pattern: /malformada/,
    },
    {
      name: 'pública',
      mutator: (_env, capability) => {
        chmodSync(capability.path, 0o644);
      },
      pattern: /permissões não privadas/,
    },
    {
      name: 'outra config',
      capability: { config: 'some-other.config.js' },
      pattern: /não pertence a esta configuração/,
    },
    {
      name: 'outra suíte',
      capability: { specs: ['tests/other.spec.js'] },
      pattern: /não pertence a esta suíte/,
    },
  ];

  for (const scenario of cases) {
    const { dir, capability, env } = safeEnvWithCapability({
      capability: scenario.capability,
      mutator: scenario.mutator,
    });
    try {
      const result = discoverSafe([...SAFE_E2E_SPECS], env);
      assert.notEqual(result.status, 0, `${scenario.name} deveria falhar`);
      assert.match(result.stderr, scenario.pattern, `${scenario.name}: ${result.stderr}`);
    } finally {
      deleteSafeE2eCapability(capability);
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('uma capability já consumida/removida não pode ser reutilizada', () => {
  const { dir, capability, env } = safeEnvWithCapability();
  try {
    const first = discoverSafe([...SAFE_E2E_SPECS], env);
    assert.equal(first.status, 0, first.stderr);
    deleteSafeE2eCapability(capability);
    const second = discoverSafe([...SAFE_E2E_SPECS], env);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /ausente ou ilegível/);
  } finally {
    deleteSafeE2eCapability(capability);
    rmSync(dir, { recursive: true, force: true });
  }
});
