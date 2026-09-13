import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAnonymousAdminUnauthorized,
  assertDeploymentIdentity,
  assertSafeApiPath,
  assertPreviewConfig,
  bootstrapPreviewProtection,
  getPreviewConfig,
  loginToPreview,
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
    VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-vercel-bypass-secret',
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
    bypassSecret: 'synthetic-vercel-bypass-secret',
    postgresQuotationId: 'ORC-20260001',
    scratchQuotationId: 'ORC-20269999',
  });
});

test('config exige segredo de bypass sem expô-lo na mensagem', () => {
  assert.throws(
    () => getPreviewConfig(without(validEnv(), 'VERCEL_AUTOMATION_BYPASS_SECRET')),
    (error) => {
      assert.match(error.message, /VERCEL_AUTOMATION_BYPASS_SECRET/);
      assert.doesNotMatch(error.message, /synthetic-vercel-bypass-secret/);
      return true;
    }
  );
});

test('config de Preview recusa origem HTTP antes do bootstrap', () => {
  assert.throws(
    () => getPreviewConfig(validEnv({ PREVIEW_BASE_URL: 'http://preview.example.test' })),
    /HTTPS/
  );
});

test('assertPreviewConfig exige a capability do runner', () => {
  assert.throws(() => assertPreviewConfig(validEnv()), /capability do E2E seguro/);
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
  bypassSecret: 'synthetic-vercel-bypass-secret',
  postgresQuotationId: 'ORC-20260001',
  scratchQuotationId: 'ORC-20269999',
};

test('login usa a config validada no carregamento sem revalidar a capability por teste', async () => {
  const previous = {
    APP_ENV: process.env.APP_ENV,
    PREVIEW_BASE_URL: process.env.PREVIEW_BASE_URL,
    BASE_URL: process.env.BASE_URL,
    E2E_PASSWORD: process.env.E2E_PASSWORD,
    PREVIEW_E2E_USERNAME: process.env.PREVIEW_E2E_USERNAME,
  };
  Object.assign(process.env, {
    APP_ENV: 'preview',
    PREVIEW_BASE_URL: proofConfig.baseUrl,
    BASE_URL: proofConfig.baseUrl,
    E2E_PASSWORD: '',
    PREVIEW_E2E_USERNAME: 'different-operator',
  });

  const calls = [];
  const page = {
    request: {
      get: async (url, options) => {
        calls.push({ type: 'get', url, options });
        if (url === proofConfig.baseUrl) return { status: () => 200 };
        if (url.endsWith('/api/operational-status')) {
          return { status: () => 200, json: async () => identityBody() };
        }
        return { status: () => 200, json: async () => ({ revision_id: 'rev-1' }) };
      },
    },
    setExtraHTTPHeaders: async (headers) => calls.push({ type: 'headers', headers }),
    goto: async (url) => calls.push({ type: 'goto', url }),
    getByPlaceholder: () => ({ fill: async (value) => calls.push({ type: 'fill', value }) }),
    waitForResponse: async () => ({ status: () => 200 }),
    getByRole: () => ({ click: async () => calls.push({ type: 'click' }) }),
    waitForURL: async (pattern) => calls.push({ type: 'waitForURL', pattern }),
  };

  try {
    const config = await loginToPreview(page, proofConfig);
    assert.equal(config, proofConfig);
    assert.equal(calls[0].type, 'get');
    assert.equal(calls[0].url, proofConfig.baseUrl);
    assert.equal(calls.at(-1).url, `${proofConfig.baseUrl}/api/quotations?id=ORC-20260001`);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('bootstrap usa headers por request somente na origem exata e sem redirects', async () => {
  const calls = [];
  const request = {
    get: async (url, options) => {
      calls.push({ url, options });
      return { status: () => 200 };
    },
  };

  await bootstrapPreviewProtection(request, proofConfig);

  assert.deepEqual(calls, [
    {
      url: 'https://preview.example.test',
      options: {
        headers: {
          'x-vercel-protection-bypass': 'synthetic-vercel-bypass-secret',
          'x-vercel-set-bypass-cookie': 'true',
        },
        maxRedirects: 0,
        failOnStatusCode: false,
      },
    },
  ]);
});

test('bootstrap rejeita 302 sem imprimir o sentinel nem o segredo', async () => {
  const request = {
    get: async () => ({ status: () => 302 }),
  };

  await assert.rejects(
    () => bootstrapPreviewProtection(request, proofConfig),
    (error) => {
      assert.match(error.message, /HTTP 302/);
      assert.doesNotMatch(error.message, /sentinel|synthetic-vercel-bypass-secret/);
      return true;
    }
  );
});

test('bootstrap sanitiza falha de transporte sem propagar sentinel ou segredo', async () => {
  const sentinel = 'preview-bypass-redaction-sentinel';
  const secret = 'synthetic-vercel-bypass-secret';
  const request = {
    get: async () => {
      throw new Error(`connect ECONNREFUSED ${sentinel} ${secret}`);
    },
  };

  await assert.rejects(
    () => bootstrapPreviewProtection(request, { ...proofConfig, bypassSecret: secret }),
    (error) => {
      assert.equal(error.message, 'Bootstrap da proteção Preview falhou antes da resposta.');
      assert.doesNotMatch(error.message, new RegExp(sentinel));
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.equal(Object.hasOwn(error, 'cause'), false);
      return true;
    }
  );
});

test('contexto anônimo faz bootstrap antes do GET administrativo e preserva 401', async () => {
  const calls = [];
  const anonymousRequest = {
    get: async (url, options) => {
      calls.push({ type: 'get', url, options });
      return { status: () => (url === proofConfig.baseUrl ? 200 : 401) };
    },
  };
  const anonymous = {
    request: anonymousRequest,
    close: async () => calls.push({ type: 'close' }),
  };
  const browser = {
    newContext: async (options) => {
      calls.push({ type: 'newContext', options });
      return anonymous;
    },
  };

  await assertAnonymousAdminUnauthorized(browser, proofConfig);

  assert.equal(calls[0].type, 'newContext');
  assert.deepEqual(calls[0].options, { baseURL: proofConfig.baseUrl });
  assert.equal(calls[1].type, 'get');
  assert.equal(calls[1].url, proofConfig.baseUrl);
  assert.deepEqual(calls[1].options, {
    headers: {
      'x-vercel-protection-bypass': 'synthetic-vercel-bypass-secret',
      'x-vercel-set-bypass-cookie': 'true',
    },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  assert.equal(calls[2].type, 'get');
  assert.match(calls[2].url, /\/api\/view\?q=/);
  assert.deepEqual(calls[3], { type: 'close' });
});

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
