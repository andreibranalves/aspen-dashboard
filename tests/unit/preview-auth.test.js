import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDeploymentIdentity,
  assertSafeApiPath,
  getPreviewConfig,
} from '../support/preview-auth.js';

function validEnv(overrides = {}) {
  return {
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    PREVIEW_BASE_URL: 'https://preview.example.test',
    BASE_URL: 'https://preview.example.test',
    E2E_USERNAME: 'preview-operator',
    E2E_PASSWORD: 'test-password',
    PREVIEW_E2E_USERNAME: 'preview-operator',
    KNOWN_POSTGRES_QUOTATION_ID: 'ORC-20260001',
    KNOWN_POSTGRES_SCRATCH_QUOTATION_ID: 'ORC-20269999',
    PREVIEW_EGRESS_BLOCKED: '1',
    PREVIEW_FIXTURE_RESET: '1',
    ...overrides,
  };
}

function without(env, key) {
  const copy = { ...env };
  delete copy[key];
  return copy;
}

test('aceita Preview com writes desativados e atestações independentes', () => {
  assert.deepEqual(getPreviewConfig(validEnv()), {
    baseUrl: 'https://preview.example.test',
    username: 'preview-operator',
    password: 'test-password',
    postgresQuotationId: 'ORC-20260001',
    scratchQuotationId: 'ORC-20269999',
  });
});

test('rejeita ambiente diferente de Preview', () => {
  for (const env of [
    without(validEnv(), 'APP_ENV'),
    validEnv({ APP_ENV: 'development' }),
    validEnv({ APP_ENV: 'production' }),
  ]) {
    assert.throws(() => getPreviewConfig(env), /APP_ENV=preview is required/);
  }
});

test('rejeita writes externos ausentes ou habilitados', () => {
  for (const env of [
    without(validEnv(), 'EXTERNAL_WRITES_ENABLED'),
    validEnv({ EXTERNAL_WRITES_ENABLED: '1' }),
  ]) {
    assert.throws(() => getPreviewConfig(env), /EXTERNAL_WRITES_ENABLED=0 is required/);
  }
});

test('mantém egress e reset como atestações independentes', () => {
  assert.throws(
    () => getPreviewConfig(without(validEnv(), 'PREVIEW_EGRESS_BLOCKED')),
    /PREVIEW_EGRESS_BLOCKED=1 is required/
  );
  assert.throws(
    () => getPreviewConfig(validEnv({ PREVIEW_FIXTURE_RESET: '0' })),
    /PREVIEW_FIXTURE_RESET=1 is required for disposable fixture cleanup/
  );
});

test('restringe requests à origem Preview', () => {
  const previous = {
    APP_ENV: process.env.APP_ENV,
    PREVIEW_BASE_URL: process.env.PREVIEW_BASE_URL,
    BASE_URL: process.env.BASE_URL,
  };
  Object.assign(process.env, {
    APP_ENV: 'preview',
    PREVIEW_BASE_URL: 'https://preview.example.test',
    BASE_URL: 'https://preview.example.test',
  });
  try {
    assert.equal(assertSafeApiPath('/api/products'), 'https://preview.example.test/api/products');
    assert.throws(
      () => assertSafeApiPath('https://outside.example.test/api/products'),
      /outside the Preview origin/
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// ── Prova de identidade do deployment (#118) ──────────────────────────────

function fakePage(responses) {
  const calls = [];
  return {
    calls,
    request: {
      get: async (url) => {
        calls.push(String(url));
        const [status, body] = responses[Math.min(calls.length - 1, responses.length - 1)];
        return { status: () => status, json: () => Promise.resolve(body) };
      },
    },
  };
}

const proofConfig = {
  baseUrl: 'https://preview.example.test',
  username: 'preview-operator',
  password: 'test-password',
  postgresQuotationId: 'ORC-20260001',
  scratchQuotationId: 'ORC-20269999',
};

function identityBody(overrides = {}) {
  return {
    ready: true,
    checks: { database_connected: true, mandatory_settings: true },
    details: { settings_missing: [] },
    deployment_identity: {
      app_env: 'preview',
      external_writes_enabled: false,
      persistence: 'postgres',
    },
    ...overrides,
  };
}

async function withPreviewEnv(run) {
  const previous = {
    APP_ENV: process.env.APP_ENV,
    PREVIEW_BASE_URL: process.env.PREVIEW_BASE_URL,
    BASE_URL: process.env.BASE_URL,
  };
  Object.assign(process.env, {
    APP_ENV: 'preview',
    PREVIEW_BASE_URL: 'https://preview.example.test',
    BASE_URL: 'https://preview.example.test',
  });
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('prova do deployment passa com ambiente, writes-off e persistência aprovada', async () => {
  await withPreviewEnv(async () => {
    const page = fakePage([
      [200, identityBody()],
      [200, { revision_id: 'rev-1' }],
    ]);
    const identity = await assertDeploymentIdentity(page, proofConfig);
    assert.equal(identity.app_env, 'preview');
    assert.deepEqual(page.calls, [
      'https://preview.example.test/api/operational-status',
      'https://preview.example.test/api/quotations?id=ORC-20260001',
    ]);
  });
});

test('falha fechada quando o deployment não é Preview', async () => {
  await withPreviewEnv(async () => {
    const page = fakePage([
      [
        200,
        identityBody({
          deployment_identity: {
            app_env: 'production',
            external_writes_enabled: false,
            persistence: 'postgres',
          },
        }),
      ],
    ]);
    await assert.rejects(
      () => assertDeploymentIdentity(page, proofConfig),
      /não está no ambiente de Preview esperado/
    );
    assert.equal(page.calls.length, 1);
  });
});

test('falha fechada quando o deployment reporta escritas externas habilitadas', async () => {
  await withPreviewEnv(async () => {
    const page = fakePage([
      [
        200,
        identityBody({
          deployment_identity: {
            app_env: 'preview',
            external_writes_enabled: true,
            persistence: 'postgres',
          },
        }),
      ],
    ]);
    await assert.rejects(
      () => assertDeploymentIdentity(page, proofConfig),
      /external writes enabled/
    );
  });
});

test('falha fechada sem persistência PostgreSQL conectada', async () => {
  await withPreviewEnv(async () => {
    const page = fakePage([
      [200, identityBody({ checks: { database_connected: false, mandatory_settings: false } })],
    ]);
    await assert.rejects(
      () => assertDeploymentIdentity(page, proofConfig),
      /persistência PostgreSQL/
    );
  });
});

test('falha fechada sem HTTP 200 na prova', async () => {
  await withPreviewEnv(async () => {
    const page = fakePage([[503, {}]]);
    await assert.rejects(() => assertDeploymentIdentity(page, proofConfig), /HTTP 503/);
  });
});

test('falha fechada se o deployment não serve a cotação atestada (persistência não aprovada)', async () => {
  await withPreviewEnv(async () => {
    const page = fakePage([
      [200, identityBody()],
      [404, {}],
    ]);
    await assert.rejects(
      () => assertDeploymentIdentity(page, proofConfig),
      /persistência não aprovada/
    );
    assert.equal(page.calls.length, 2);
  });
});
