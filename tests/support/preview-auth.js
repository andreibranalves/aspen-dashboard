import assert from 'node:assert/strict';

const REQUIRED_PREVIEW_VARS = [
  'PREVIEW_BASE_URL',
  'E2E_USERNAME',
  'E2E_PASSWORD',
  'PREVIEW_E2E_USERNAME',
  'KNOWN_POSTGRES_QUOTATION_ID',
  'KNOWN_POSTGRES_SCRATCH_QUOTATION_ID',
];

function safePreviewOrigin(value) {
  let parsed;
  try {
    parsed = new globalThis.URL(String(value || '').trim());
  } catch {
    throw new Error('PREVIEW_BASE_URL must be a valid HTTP(S) origin without credentials');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('PREVIEW_BASE_URL must be a valid HTTP(S) origin without credentials');
  }
  return parsed.origin;
}

export function getPreviewConfig(env = process.env) {
  const missing = REQUIRED_PREVIEW_VARS.filter((name) => !String(env[name] || '').trim());
  if (missing.length) {
    throw new Error(`Preview E2E precondition missing: ${missing.join(', ')}`);
  }
  if (
    String(env.APP_ENV || '')
      .trim()
      .toLowerCase() !== 'preview'
  ) {
    throw new Error('APP_ENV=preview is required');
  }
  if (String(env.EXTERNAL_WRITES_ENABLED || '').trim() !== '0') {
    throw new Error('EXTERNAL_WRITES_ENABLED=0 is required');
  }
  if (String(env.PREVIEW_E2E_USERNAME).trim() !== String(env.E2E_USERNAME).trim()) {
    throw new Error('Preview E2E username attestation does not match E2E_USERNAME');
  }
  if (env.PREVIEW_EGRESS_BLOCKED !== '1') {
    throw new Error('PREVIEW_EGRESS_BLOCKED=1 is required');
  }
  if (env.PREVIEW_FIXTURE_RESET !== '1') {
    throw new Error('PREVIEW_FIXTURE_RESET=1 is required for disposable fixture cleanup');
  }
  return {
    baseUrl: safePreviewOrigin(env.PREVIEW_BASE_URL),
    username: String(env.E2E_USERNAME).trim(),
    password: String(env.E2E_PASSWORD),
    postgresQuotationId: String(env.KNOWN_POSTGRES_QUOTATION_ID).trim(),
    scratchQuotationId: String(env.KNOWN_POSTGRES_SCRATCH_QUOTATION_ID).trim(),
  };
}

export function assertPreviewConfig(env = process.env) {
  return getPreviewConfig(env);
}

/**
 * Prova read-only do DEPLOYMENT remoto (ticket #118), exigida antes da primeira
 * mutação. Executada logo após o login, antes de qualquer outro request:
 * - ambiente: deployment se declara preview;
 * - writes-off: deployment reporta escritas externas desativadas;
 * - identidade de persistência aprovada: a cotação atestada pelo operador
 *   (KNOWN_POSTGRES_QUOTATION_ID) existe na persistência servida por este
 *   deployment — prova de ambiente, conectividade e fixture, não de identidade
 *   única da branch nem apenas de flags locais.
 * Falha fechada: qualquer divergência lança antes dos cenários mutáveis.
 */
export async function assertDeploymentIdentity(page, config = getPreviewConfig()) {
  const statusResponse = await apiRequest(page, 'GET', '/api/operational-status');
  if (statusResponse.status() !== 200) {
    throw new Error(
      `Prova do deployment falhou: operational-status HTTP ${statusResponse.status()}`
    );
  }
  const body = await statusResponse.json();
  const identity = body?.deployment_identity;
  if (identity?.app_env !== 'preview') {
    throw new Error('Deployment não está no ambiente de Preview esperado (app_env != preview).');
  }
  if (identity?.external_writes_enabled !== false) {
    throw new Error(
      'Deployment remoto reports external writes enabled; mutable scenarios are blocked.'
    );
  }
  if (identity?.persistence !== 'postgres' || body?.checks?.database_connected !== true) {
    throw new Error('Deployment não comprova persistência PostgreSQL conectada.');
  }

  // Identidade de persistência aprovada: linha atestada existe neste backend.
  const quotationResponse = await apiRequest(
    page,
    'GET',
    `/api/quotations?id=${encodeURIComponent(config.postgresQuotationId)}`
  );
  if (quotationResponse.status() !== 200) {
    throw new Error(
      `Deployment não serve a cotação atestada (HTTP ${quotationResponse.status()}): persistência não aprovada.`
    );
  }
  return identity;
}

function effectivePreviewOrigin(env = process.env) {
  if (
    String(env.APP_ENV || '')
      .trim()
      .toLowerCase() !== 'preview'
  )
    return null;
  const previewOrigin = safePreviewOrigin(env.PREVIEW_BASE_URL);
  const configuredBaseOrigin = safePreviewOrigin(env.BASE_URL || previewOrigin);
  if (configuredBaseOrigin !== previewOrigin) {
    throw new Error('BASE_URL must match PREVIEW_BASE_URL during Preview E2E');
  }
  return previewOrigin;
}

export function assertSafeApiPath(path) {
  const value = String(path || '');
  const expectedOrigin = effectivePreviewOrigin();
  let parsed;
  try {
    parsed = new globalThis.URL(
      value,
      expectedOrigin || process.env.BASE_URL || 'http://preview.invalid'
    );
  } catch {
    throw new Error('Preview test attempted an invalid API URL');
  }
  if (parsed.username || parsed.password || (expectedOrigin && parsed.origin !== expectedOrigin)) {
    throw new Error('Preview test attempted an API request outside the Preview origin');
  }
  if (
    /\/api\/send-whatsapp(?:-flow)?(?:[/?]|$)|(?:hubspot|salesforce|external-crm|external-erp)/i.test(
      `${parsed.hostname}${parsed.pathname}`
    )
  ) {
    throw new Error('Preview test attempted a forbidden external/send request');
  }
  return expectedOrigin ? parsed.href : value;
}

export async function apiRequest(page, method, path, options = {}) {
  const safePath = assertSafeApiPath(path);
  const request = page.request;
  const fn = request?.[method.toLowerCase()];
  if (typeof fn !== 'function') throw new Error('Playwright API request method unavailable');
  return fn.call(request, safePath, options);
}

export function assertNoForbiddenEgress(requests) {
  const forbidden = requests.filter((rawUrl) => {
    let parsed;
    try {
      parsed = new globalThis.URL(rawUrl);
    } catch {
      return true;
    }
    const target = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    const forbiddenPattern = new RegExp(
      [
        ['fra', 'ppe'],
        ['erp', 'next'],
        ['n', '8n'],
        ['evo', 'lution'],
        ['external', '-crm'],
        ['external', '-erp'],
        ['/api/', 'send-whatsapp'],
      ]
        .map((parts) => parts.slice(0, 2).join(''))
        .join('|')
    );
    return forbiddenPattern.test(target);
  });
  assert.equal(forbidden.length, 0, 'Preview browser made a forbidden external request');
}

export async function loginToPreview(page) {
  const config = assertPreviewConfig();
  // The application intentionally has password-only auth and no username input.
  // The designated account is attested through x-e2e-username; the server rejects
  // a mismatched account.
  await page.setExtraHTTPHeaders({ 'x-e2e-username': config.username });
  await page.goto('/#/login');
  await page.getByPlaceholder('Senha de acesso').fill(config.password);
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/login') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Entrar' }).click();
  const response = await loginResponse;
  assert.equal(response.status(), 200, 'Preview login must return HTTP 200');
  await page.waitForURL(/#\/quotations(?:$|\/)/);
  // Prova do deployment ANTES de qualquer cenário mutável rodar.
  await assertDeploymentIdentity(page);
  return config;
}
