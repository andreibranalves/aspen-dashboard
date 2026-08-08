import assert from 'node:assert/strict';

const REQUIRED_STAGING_VARS = [
  'STAGING_BASE_URL',
  'E2E_USERNAME',
  'E2E_PASSWORD',
  'KNOWN_POSTGRES_QUOTATION_ID',
  'KNOWN_LEGACY_QUOTATION_ID',
];

export function getStagingConfig(env = process.env) {
  const missing = REQUIRED_STAGING_VARS.filter((name) => !String(env[name] || '').trim());
  if (env.STAGING_E2E !== '1') missing.unshift('STAGING_E2E=1');
  if (missing.length) {
    throw new Error(`Staging E2E precondition missing: ${missing.join(', ')}`);
  }
  return {
    baseUrl: String(env.STAGING_BASE_URL).trim().replace(/\/$/, ''),
    username: String(env.E2E_USERNAME).trim(),
    password: String(env.E2E_PASSWORD),
    postgresQuotationId: String(env.KNOWN_POSTGRES_QUOTATION_ID).trim(),
    legacyQuotationId: String(env.KNOWN_LEGACY_QUOTATION_ID).trim(),
  };
}

export function assertStagingConfig(env = process.env) {
  const config = getStagingConfig(env);
  assert.match(config.baseUrl, /^https?:\/\//, 'STAGING_BASE_URL must be an HTTP(S) URL');
  return config;
}

export async function loginToStaging(page) {
  const config = assertStagingConfig();
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
