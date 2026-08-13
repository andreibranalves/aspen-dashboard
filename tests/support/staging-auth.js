import assert from 'node:assert/strict';

const REQUIRED_STAGING_VARS = [
  'STAGING_BASE_URL',
  'E2E_USERNAME',
  'E2E_PASSWORD',
  'STAGING_E2E_USERNAME',
  'KNOWN_POSTGRES_QUOTATION_ID',
  'KNOWN_POSTGRES_SCRATCH_QUOTATION_ID',
  'STAGING_EXTERNAL_PROVIDERS_DISABLED',
  'STAGING_EGRESS_BLOCKED',
  'STAGING_FIXTURE_RESET',
];

function safeStagingOrigin(value) {
  let parsed;
  try {
    parsed = new globalThis.URL(String(value || '').trim());
  } catch {
    throw new Error('STAGING_BASE_URL must be a valid HTTP(S) origin without credentials');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('STAGING_BASE_URL must be a valid HTTP(S) origin without credentials');
  }
  return parsed.origin;
}

export function getStagingConfig(env = process.env) {
  const missing = REQUIRED_STAGING_VARS.filter((name) => !String(env[name] || '').trim());
  if (env.STAGING_E2E !== '1') missing.unshift('STAGING_E2E=1');
  if (missing.length) {
    throw new Error(`Staging E2E precondition missing: ${missing.join(', ')}`);
  }
  if (String(env.STAGING_E2E_USERNAME).trim() !== String(env.E2E_USERNAME).trim()) {
    throw new Error('Staging E2E username attestation does not match E2E_USERNAME');
  }
  if (env.STAGING_EXTERNAL_PROVIDERS_DISABLED !== '1') {
    throw new Error('STAGING_EXTERNAL_PROVIDERS_DISABLED=1 is required');
  }
  if (env.STAGING_EGRESS_BLOCKED !== '1') {
    throw new Error('STAGING_EGRESS_BLOCKED=1 is required');
  }
  if (env.STAGING_FIXTURE_RESET !== '1') {
    throw new Error('STAGING_FIXTURE_RESET=1 is required for disposable fixture cleanup');
  }
  return {
    baseUrl: safeStagingOrigin(env.STAGING_BASE_URL),
    username: String(env.E2E_USERNAME).trim(),
    password: String(env.E2E_PASSWORD),
    postgresQuotationId: String(env.KNOWN_POSTGRES_QUOTATION_ID).trim(),
    scratchQuotationId: String(env.KNOWN_POSTGRES_SCRATCH_QUOTATION_ID).trim(),
  };
}

export function assertStagingConfig(env = process.env) {
  return getStagingConfig(env);
}

function effectiveStagingOrigin(env = process.env) {
  if (env.STAGING_E2E !== '1') return null;
  const stagingOrigin = safeStagingOrigin(env.STAGING_BASE_URL);
  const configuredBaseOrigin = safeStagingOrigin(env.BASE_URL || stagingOrigin);
  if (configuredBaseOrigin !== stagingOrigin) {
    throw new Error('BASE_URL must match STAGING_BASE_URL during staging E2E');
  }
  return stagingOrigin;
}

export function assertSafeApiPath(path) {
  const value = String(path || '');
  const expectedOrigin = effectiveStagingOrigin();
  let parsed;
  try {
    parsed = new globalThis.URL(value, expectedOrigin || process.env.BASE_URL || 'http://staging.invalid');
  } catch {
    throw new Error('Staging test attempted an invalid API URL');
  }
  if (parsed.username || parsed.password || (expectedOrigin && parsed.origin !== expectedOrigin)) {
    throw new Error('Staging test attempted an API request outside the staging origin');
  }
  if (
    /\/api\/send-whatsapp(?:-flow)?(?:[/?]|$)|(?:hubspot|salesforce|external-crm|external-erp)/i.test(
      `${parsed.hostname}${parsed.pathname}`,
    )
  ) {
    throw new Error('Staging test attempted a forbidden external/send request');
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

export async function loginToStaging(page) {
  const config = assertStagingConfig();
  // The application intentionally has password-only auth and no username input.
  // The designated account is attested through x-e2e-username; the server rejects
  // a mismatched account.
  await page.setExtraHTTPHeaders({ 'x-e2e-username': config.username });
  await page.goto('/#/login');
  await page.getByPlaceholder('Senha de acesso').fill(config.password);
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Entrar' }).click();
  const response = await loginResponse;
  assert.equal(response.status(), 200, 'staging login must return HTTP 200');
  await page.waitForURL(/#\/quotations(?:$|\/)/);
  return config;
}
