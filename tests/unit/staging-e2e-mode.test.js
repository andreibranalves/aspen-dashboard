// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { STAGING_E2E_SPECS } from '../../scripts/lib/staging-e2e-specs.mjs';
import { isStagingMode, resolveE2eBaseUrl } from '../../scripts/lib/e2e-mode.mjs';

test('suíte controlada de staging é explícita e não-vazia', () => {
  assert.ok(Array.isArray(STAGING_E2E_SPECS));
  assert.ok(STAGING_E2E_SPECS.length > 0, 'corpus de staging não pode ficar vazio');
  for (const spec of STAGING_E2E_SPECS) {
    assert.match(spec, /^tests\/.*\.spec\.js$/, `spec de staging deve estar em tests/: ${spec}`);
    assert.equal(spec.includes('staging') || spec.includes('cutover'), true);
  }
});

function stagingEnv(overrides = {}) {
  return {
    APP_ENV: 'preview',
    STAGING_BASE_URL: 'https://preview.example.test',
    ...overrides,
  };
}

test('modo local nunca herda URL de staging implicitamente (AC1)', () => {
  // STAGING_BASE_URL presente no ambiente: o modo local DEVE ignorar.
  const env = { APP_ENV: 'production', STAGING_BASE_URL: 'https://preview.example.test' };
  delete env.BASE_URL;
  assert.equal(resolveE2eBaseUrl(env), 'http://localhost:5173');
});

test('modo local aceita somente alvo local explícito', () => {
  const env = { APP_ENV: '', BASE_URL: 'http://localhost:4173' };
  delete env.STAGING_BASE_URL;
  assert.equal(resolveE2eBaseUrl(env), 'http://localhost:4173');
});

test('BASE_URL apontando para staging fora do Preview falha antes do primeiro request (AC1/AC4)', () => {
  const env = {
    APP_ENV: 'production',
    BASE_URL: 'https://preview.example.test',
    STAGING_BASE_URL: 'https://preview.example.test',
  };
  assert.throws(() => resolveE2eBaseUrl(env), /Configuração contraditória/);
});

test('Preview sem STAGING_BASE_URL falha fechada (AC4)', () => {
  const env = { APP_ENV: 'preview' };
  delete env.STAGING_BASE_URL;
  assert.throws(() => resolveE2eBaseUrl(env), /APP_ENV=preview exige STAGING_BASE_URL/);
});

test('Preview com BASE_URL divergente da origem de staging falha fechada (AC4)', () => {
  const env = stagingEnv({ BASE_URL: 'https://other.example.test' });
  assert.throws(() => resolveE2eBaseUrl(env), /must match STAGING_BASE_URL/);
});

test('Preview resolve a origem atestada do staging (AC2)', () => {
  const env = stagingEnv({ BASE_URL: 'https://preview.example.test/' });
  assert.equal(resolveE2eBaseUrl(env), 'https://preview.example.test');
});

test('modos são mutuamente exclusivos e derivados de uma única variável', () => {
  assert.equal(isStagingMode({ APP_ENV: 'preview' }), true);
  assert.equal(isStagingMode({ APP_ENV: 'PREVIEW' }), true);
  assert.equal(isStagingMode({ APP_ENV: 'production' }), false);
  assert.equal(isStagingMode({}), false);
});
