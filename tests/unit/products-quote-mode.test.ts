import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHandler } from '../../api/_functions/products.js';

function event(httpMethod: string) {
  return {
    httpMethod,
    headers: {},
    queryStringParameters: {},
    body: '',
  } as const;
}

function result(statusCode: number) {
  return { statusCode, body: JSON.stringify({ ok: true }) };
}

function setFlags(products: string | undefined, quotes: string | undefined): void {
  if (products === undefined) delete process.env.CRM_CORE_PRODUCTS_ENABLED;
  else process.env.CRM_CORE_PRODUCTS_ENABLED = products;
  if (quotes === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
  else process.env.CRM_CORE_QUOTES_ENABLED = quotes;
}

test('quote core rollout routes product GET searches to PostgreSQL with exact true flag', async () => {
  const calls: string[] = [];
  const handler = createHandler({
    core: async (request) => {
      calls.push(`core:${request.httpMethod}`);
      return result(200);
    },
    legacy: async (request) => {
      calls.push(`legacy:${request.httpMethod}`);
      return result(201);
    },
  });
  const previousProducts = process.env.CRM_CORE_PRODUCTS_ENABLED;
  const previousQuotes = process.env.CRM_CORE_QUOTES_ENABLED;
  try {
    setFlags('false', 'true');
    assert.equal((await handler(event('GET'))).statusCode, 200);
    assert.deepEqual(calls, ['core:GET']);
  } finally {
    setFlags(previousProducts, previousQuotes);
  }
});

test('quote core rollout leaves product writes and non-GET methods on legacy', async () => {
  const calls: string[] = [];
  const handler = createHandler({
    core: async (request) => {
      calls.push(`core:${request.httpMethod}`);
      return result(200);
    },
    legacy: async (request) => {
      calls.push(`legacy:${request.httpMethod}`);
      return result(201);
    },
  });
  const previousProducts = process.env.CRM_CORE_PRODUCTS_ENABLED;
  const previousQuotes = process.env.CRM_CORE_QUOTES_ENABLED;
  try {
    setFlags('false', 'true');
    assert.equal((await handler(event('POST'))).statusCode, 201);
    assert.equal((await handler(event('PUT'))).statusCode, 201);
    assert.equal((await handler(event('PATCH'))).statusCode, 201);
    assert.equal((await handler(event('DELETE'))).statusCode, 201);
    assert.deepEqual(calls, ['legacy:POST', 'legacy:PUT', 'legacy:PATCH', 'legacy:DELETE']);
  } finally {
    setFlags(previousProducts, previousQuotes);
  }
});

test('both flags disabled keep GET legacy while products flag promotes every method', async () => {
  const calls: string[] = [];
  const handler = createHandler({
    core: async (request) => {
      calls.push(`core:${request.httpMethod}`);
      return result(200);
    },
    legacy: async (request) => {
      calls.push(`legacy:${request.httpMethod}`);
      return result(201);
    },
  });
  const previousProducts = process.env.CRM_CORE_PRODUCTS_ENABLED;
  const previousQuotes = process.env.CRM_CORE_QUOTES_ENABLED;
  try {
    setFlags('false', 'false');
    assert.equal((await handler(event('GET'))).statusCode, 201);
    setFlags('true', 'false');
    assert.equal((await handler(event('GET'))).statusCode, 200);
    assert.equal((await handler(event('POST'))).statusCode, 200);
    assert.deepEqual(calls, ['legacy:GET', 'core:GET', 'core:POST']);
  } finally {
    setFlags(previousProducts, previousQuotes);
  }
});

test('quote rollout does not activate for non-exact flag values', async () => {
  const calls: string[] = [];
  const handler = createHandler({
    core: async () => {
      calls.push('core');
      return result(200);
    },
    legacy: async () => {
      calls.push('legacy');
      return result(201);
    },
  });
  const previousProducts = process.env.CRM_CORE_PRODUCTS_ENABLED;
  const previousQuotes = process.env.CRM_CORE_QUOTES_ENABLED;
  try {
    setFlags('1', 'TRUE');
    assert.equal((await handler(event('GET'))).statusCode, 201);
    assert.deepEqual(calls, ['legacy']);
  } finally {
    setFlags(previousProducts, previousQuotes);
  }
});
