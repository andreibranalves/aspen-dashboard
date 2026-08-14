import assert from 'node:assert/strict';
import test from 'node:test';
import { readCanaryConfig, runCanary } from '../../scripts/postgres-only-canary.mjs';

test('requires a same-origin read-only Production canary configuration', () => {
  assert.throws(() => readCanaryConfig({}), /CANARY_BASE_URL/);
  assert.throws(
    () => readCanaryConfig({
      CANARY_BASE_URL: 'https://user:secret@example.com',
      CANARY_PASSWORD: 'secret',
      CANARY_QUOTATION_ID: 'ORC-1',
      CANARY_PUBLIC_QUOTATION_URL: 'https://example.com/api/public-quotation?token=x',
    }),
    /without credentials/,
  );
  assert.throws(
    () => readCanaryConfig({
      ...validCanaryEnv(),
      CANARY_PUBLIC_QUOTATION_URL: 'https://other.example/api/public-quotation?token=x',
    }),
    /same origin/,
  );
});

function validCanaryEnv() {
  return {
    CANARY_BASE_URL: 'https://aspen.example',
    CANARY_PASSWORD: 'secret',
    CANARY_QUOTATION_ID: 'ORC-1',
    CANARY_PUBLIC_QUOTATION_URL: 'https://aspen.example/api/public-quotation?token=test',
  };
}

function canaryFetch(overrides = {}) {
  return async (rawUrl, options = {}) => {
    const url = new globalThis.URL(String(rawUrl));
    const key = `${options.method || 'GET'} ${url.pathname}${url.search}`;
    if (overrides[key]) return overrides[key];
    if (key === 'POST /api/login') {
      return new globalThis.Response('{"success":true}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'session=test; HttpOnly' },
      });
    }
    if (key === 'GET /api/quotations?id=ORC-1') {
      return globalThis.Response.json({ id: 'ORC-1', revision_id: 'revision-1' });
    }
    if (key === 'GET /api/quotation-preview?id=ORC-1&format=pdf') {
      return new globalThis.Response('%PDF-1.4\n%%EOF', {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'x-document-revision': 'revision-1',
        },
      });
    }
    if (url.pathname === '/api/public-quotation') {
      return new globalThis.Response('<!doctype html><title>ORC-1</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return globalThis.Response.json({ ok: true });
  };
}

test('uses POST only for login and keeps every business check read-only', async () => {
  const calls = [];
  const fake = canaryFetch();
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers });
    return fake(url, options);
  };
  await runCanary({ env: validCanaryEnv(), fetchImpl });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls.slice(1).every((call) => call.method === 'GET'), true);
  assert.equal(calls.some((call) => /send-whatsapp|typebot-lead-capture/i.test(call.url)), false);
  const publicCall = calls.find((call) => new globalThis.URL(call.url).pathname === '/api/public-quotation');
  assert.ok(publicCall);
  assert.equal(publicCall.headers?.cookie, undefined);
  assert.equal(publicCall.headers?.Cookie, undefined);
});

test('fails on every forbidden provider marker', async () => {
  const markers = [
    ['fra', 'ppe'],
    ['erp', 'next'],
    ['CRM', '_CORE_'],
    ['CRM', '_OPERATIONAL_MODE'],
    ['CRM', '_QUOTES_ROLLOUT_STATE'],
  ].map((parts) => parts.slice(0, 2).join(''));
  for (const marker of markers) {
    await assert.rejects(
      runCanary({
        env: validCanaryEnv(),
        fetchImpl: canaryFetch({
          'GET /api/products?limit=1': globalThis.Response.json({ provider: marker }),
        }),
      }),
      /forbidden provider metadata/,
    );
  }
});

test('fails on provider metadata, wrong revision, invalid PDF and non-2xx responses', async () => {
  const cases = [
    [
      { 'GET /api/products?limit=1': globalThis.Response.json({ provider: ['fra', 'ppe'].slice(0, 2).join('') }) },
      /forbidden provider metadata/,
    ],
    [
      {
        'GET /api/quotation-preview?id=ORC-1&format=pdf': new globalThis.Response('%PDF-1.4\n%%EOF', {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'x-document-revision': 'wrong' },
        }),
      },
      /revision/,
    ],
    [
      {
        'GET /api/quotation-preview?id=ORC-1&format=pdf': new globalThis.Response('not a pdf', {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'x-document-revision': 'revision-1' },
        }),
      },
      /PDF/,
    ],
    [{ 'GET /api/operational-status': globalThis.Response.json({ error: 'down' }, { status: 503 }) }, /503/],
  ];
  for (const [overrides, pattern] of cases) {
    await assert.rejects(
      runCanary({ env: validCanaryEnv(), fetchImpl: canaryFetch(overrides) }),
      pattern,
    );
  }
});

test('requires redirect errors for every request', async () => {
  const fake = canaryFetch();
  const fetchImpl = async (url, options = {}) => {
    assert.equal(options.redirect, 'error');
    return fake(url, options);
  };
  await runCanary({ env: validCanaryEnv(), fetchImpl });
});

test('rejects a response URL that crosses origin', async () => {
  const response = globalThis.Response.json({ ok: true });
  Object.defineProperty(response, 'url', { value: 'https://other.example/api/operational-status' });
  await assert.rejects(
    runCanary({
      env: validCanaryEnv(),
      fetchImpl: canaryFetch({ 'GET /api/operational-status': response }),
    }),
    /cross-origin/,
  );
});
