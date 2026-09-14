// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { PREVIEW_E2E_SPECS } from '../../scripts/lib/preview-e2e-specs.mjs';
import { isPreviewMode, resolveE2eBaseUrl } from '../../scripts/lib/e2e-mode.mjs';

test('suíte controlada de Preview é explícita e não-vazia', () => {
  assert.ok(Array.isArray(PREVIEW_E2E_SPECS));
  assert.ok(PREVIEW_E2E_SPECS.length > 0, 'corpus de Preview não pode ficar vazio');
  for (const spec of PREVIEW_E2E_SPECS) {
    assert.match(spec, /^tests\/.*\.spec\.js$/, `spec de Preview deve estar em tests/: ${spec}`);
    assert.equal(spec.includes('cutover'), true);
  }
});

function previewEnv(overrides = {}) {
  return {
    APP_ENV: 'preview',
    PREVIEW_BASE_URL: 'https://preview.example.test',
    ...overrides,
  };
}

test('modo local nunca herda URL de Preview implicitamente', () => {
  const env = { APP_ENV: 'production', PREVIEW_BASE_URL: 'https://preview.example.test' };
  delete env.BASE_URL;
  assert.equal(resolveE2eBaseUrl(env), 'http://localhost:5173');
});

test('modo local aceita somente alvo local explícito', () => {
  const env = { APP_ENV: '', BASE_URL: 'http://localhost:4173' };
  delete env.PREVIEW_BASE_URL;
  assert.equal(resolveE2eBaseUrl(env), 'http://localhost:4173');
});

test('BASE_URL apontando para Preview fora do modo Preview falha antes do primeiro request', () => {
  const env = {
    APP_ENV: 'production',
    BASE_URL: 'https://preview.example.test',
    PREVIEW_BASE_URL: 'https://preview.example.test',
  };
  assert.throws(() => resolveE2eBaseUrl(env), /Configuração contraditória/);
});

test('Preview sem PREVIEW_BASE_URL falha fechada', () => {
  const env = { APP_ENV: 'preview' };
  delete env.PREVIEW_BASE_URL;
  assert.throws(() => resolveE2eBaseUrl(env), /APP_ENV=preview exige PREVIEW_BASE_URL/);
});

test('Preview com BASE_URL divergente da origem do deployment falha fechada', () => {
  const env = previewEnv({ BASE_URL: 'https://other.example.test' });
  assert.throws(() => resolveE2eBaseUrl(env), /must match PREVIEW_BASE_URL/);
});

test('Preview exige HTTPS na origem do deployment antes de retornar o baseURL', () => {
  const env = previewEnv({ PREVIEW_BASE_URL: 'http://preview.example.test' });
  assert.throws(() => resolveE2eBaseUrl(env), /HTTPS/);
});

test('Preview resolve somente a origem atestada em PREVIEW_BASE_URL', () => {
  const env = previewEnv({ BASE_URL: 'https://preview.example.test/' });
  assert.equal(resolveE2eBaseUrl(env), 'https://preview.example.test');
});

test('modos são mutuamente exclusivos e derivados de APP_ENV', () => {
  assert.equal(isPreviewMode({ APP_ENV: 'preview' }), true);
  assert.equal(isPreviewMode({ APP_ENV: 'PREVIEW' }), true);
  assert.equal(isPreviewMode({ APP_ENV: 'production' }), false);
  assert.equal(isPreviewMode({}), false);
});
