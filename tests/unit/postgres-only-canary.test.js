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
    calls.push({ url: String(url), method: options.method || 'GET' });
    return fake(url, options);
  };
  await runCanary({ env: validCanaryEnv(), fetchImpl });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls.slice(1).every((call) => call.method === 'GET'), true);
  assert.equal(calls.some((call) => /send-whatsapp|typebot-lead-capture/i.test(call.url)), false);
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
