import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeApiPath, getStagingConfig } from '../support/staging-auth.js';

function validEnv(overrides = {}) {
  return {
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    STAGING_BASE_URL: 'https://preview.example.test',
    BASE_URL: 'https://preview.example.test',
    E2E_USERNAME: 'preview-operator',
    E2E_PASSWORD: 'test-password',
    STAGING_E2E_USERNAME: 'preview-operator',
    KNOWN_POSTGRES_QUOTATION_ID: 'ORC-20260001',
    KNOWN_POSTGRES_SCRATCH_QUOTATION_ID: 'ORC-20269999',
    STAGING_EGRESS_BLOCKED: '1',
    STAGING_FIXTURE_RESET: '1',
    ...overrides,
  };
}

function without(env, key) {
  const copy = { ...env };
  delete copy[key];
  return copy;
}

test('aceita Preview com writes desativados e guardrails staging', () => {
  assert.deepEqual(getStagingConfig(validEnv()), {
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
    assert.throws(() => getStagingConfig(env), /APP_ENV=preview is required/);
  }
});

test('rejeita writes externos ausentes ou habilitados', () => {
  for (const env of [
    without(validEnv(), 'EXTERNAL_WRITES_ENABLED'),
    validEnv({ EXTERNAL_WRITES_ENABLED: '1' }),
  ]) {
    assert.throws(() => getStagingConfig(env), /EXTERNAL_WRITES_ENABLED=0 is required/);
  }
});

test('mantém egress e reset como atestações independentes', () => {
  assert.throws(
    () => getStagingConfig(without(validEnv(), 'STAGING_EGRESS_BLOCKED')),
    /STAGING_EGRESS_BLOCKED=1 is required/
  );
  assert.throws(
    () => getStagingConfig(validEnv({ STAGING_FIXTURE_RESET: '0' })),
    /STAGING_FIXTURE_RESET=1 is required for disposable fixture cleanup/
  );
});

test('restringe requests à origem Preview', () => {
  const previous = {
    APP_ENV: process.env.APP_ENV,
    STAGING_BASE_URL: process.env.STAGING_BASE_URL,
    BASE_URL: process.env.BASE_URL,
  };
  Object.assign(process.env, {
    APP_ENV: 'preview',
    STAGING_BASE_URL: 'https://preview.example.test',
    BASE_URL: 'https://preview.example.test',
  });
  try {
    assert.equal(assertSafeApiPath('/api/products'), 'https://preview.example.test/api/products');
    assert.throws(
      () => assertSafeApiPath('https://outside.example.test/api/products'),
      /outside the staging origin/
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
