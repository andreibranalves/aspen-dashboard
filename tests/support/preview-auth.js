import assert from 'node:assert/strict';
import { PREVIEW_E2E_SPECS } from '../../scripts/lib/preview-e2e-specs.mjs';
import { assertSafeE2eCapability } from '../../scripts/lib/safe-e2e-capability.mjs';

const REQUIRED_PREVIEW_VARS = [
  'PREVIEW_BASE_URL',
  'E2E_USERNAME',
  'E2E_PASSWORD',
  'PREVIEW_E2E_USERNAME',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'KNOWN_POSTGRES_QUOTATION_ID',
  'KNOWN_POSTGRES_SCRATCH_QUOTATION_ID',
];

function safePreviewOrigin(value) {
  let parsed;
  try {
    parsed = new globalThis.URL(String(value || '').trim());
  } catch {
    throw new Error('PREVIEW_BASE_URL must be a valid HTTPS origin without credentials');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('PREVIEW_BASE_URL must be a valid HTTPS origin without credentials');
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
    bypassSecret: String(env.VERCEL_AUTOMATION_BYPASS_SECRET).trim(),
    postgresQuotationId: String(env.KNOWN_POSTGRES_QUOTATION_ID).trim(),
    scratchQuotationId: String(env.KNOWN_POSTGRES_SCRATCH_QUOTATION_ID).trim(),
  };
}

export function assertPreviewConfig(env = process.env) {
  const config = getPreviewConfig(env);
  // A capability interna SAFE_E2E_* é reutilizada para vincular os specs ao
  // runner de Preview; seus nomes não são configuração operacional do usuário.
  assertSafeE2eCapability(env, {
    config: 'playwright.config.js',
    specs: PREVIEW_E2E_SPECS,
  });
  return config;
}

/**
 * Libera a proteção da origem Preview apenas no request de bootstrap. O
 * contexto armazena o cookie de bypass recebido, sem contaminar requests a
 * outras origens com um header global.
 */
export async function bootstrapPreviewProtection(request, config) {
  const baseUrl = safePreviewOrigin(config.baseUrl);
  let response;
  try {
    response = await request.get(baseUrl, {
      headers: {
        'x-vercel-protection-bypass': config.bypassSecret,
        'x-vercel-set-bypass-cookie': 'true',
      },
      maxRedirects: 0,
      failOnStatusCode: false,
    });
  } catch {
    throw new Error('Bootstrap da proteção Preview falhou antes da resposta.');
  }
  const status = response.status();
  if (status === 200) return response;
  if (status === 307 && (await isValidPreviewHandshake(response, baseUrl))) return response;
  const classification = status === 307 ? 'handshake inválido' : 'status inesperado';
  throw new Error(`Bootstrap da proteção Preview falhou: HTTP ${status} (${classification}).`);
}

async function isValidPreviewHandshake(response, baseUrl) {
  const headers = await getResponseHeaders(response);
  const locations = headers
    .filter(({ name }) => name.toLowerCase() === 'location')
    .map(({ value }) => value);
  if (locations.length !== 1) return false;

  let location;
  try {
    location = new globalThis.URL(locations[0], baseUrl);
  } catch {
    return false;
  }
  if (
    location.origin !== baseUrl ||
    location.pathname !== '/' ||
    location.search !== '' ||
    location.hash !== ''
  ) {
    return false;
  }

  return headers.some(({ name, value }) => {
    if (name.toLowerCase() !== 'set-cookie') return false;
    const cookiePair = value.split(';', 1)[0].trim();
    const separator = cookiePair.indexOf('=');
    return separator > 0 && cookiePair.slice(0, separator) === '_vercel_jwt';
  });
}

async function getResponseHeaders(response) {
  if (typeof response.headersArray === 'function') {
    try {
      const headers = normalizeResponseHeaders(await response.headersArray());
      if (headers.length) return headers;
    } catch {
      // Fall through to the lower-fidelity headers object when available.
    }
  }
  if (typeof response.headers === 'function') {
    try {
      return normalizeResponseHeaders(await response.headers());
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeResponseHeaders(headers) {
  if (Array.isArray(headers)) {
    return headers
      .filter((header) => header && typeof header === 'object')
      .map(({ name, value }) => ({ name: String(name), value: String(value) }));
  }
  if (!headers || typeof headers !== 'object') return [];
  return Object.entries(headers).flatMap(([name, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return values
      .filter((entry) => entry !== undefined && entry !== null)
      .map((entry) => ({ name, value: String(entry) }));
  });
}

/** Cria um contexto sem sessão Aspen e comprova o 401 da aplicação. */
export async function assertAnonymousAdminUnauthorized(browser, config) {
  const anonymous = await browser.newContext({ baseURL: config.baseUrl });
  try {
    await bootstrapPreviewProtection(anonymous.request, config);
    const adminPath = `/api/view?q=${encodeURIComponent(config.postgresQuotationId)}`;
    assertSafeApiPath(adminPath);
    const adminResponse = await anonymous.request.get(adminPath);
    assert.equal(adminResponse.status(), 401);
  } finally {
    await anonymous.close();
  }
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

export async function loginToPreview(page, config) {
  await bootstrapPreviewProtection(page.request, config);
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
  await assertDeploymentIdentity(page, config);
  return config;
}
