import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHandler } from '../../api/_functions/leads-clients.js';

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

function setFlags(clients: string | undefined, quotes: string | undefined): void {
  if (clients === undefined) delete process.env.CRM_CORE_CLIENTS_ENABLED;
  else process.env.CRM_CORE_CLIENTS_ENABLED = clients;
  if (quotes === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
  else process.env.CRM_CORE_QUOTES_ENABLED = quotes;
}

test('quote core rollout routes GET client searches to PostgreSQL with exact true flag', async () => {
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
  const previousClients = process.env.CRM_CORE_CLIENTS_ENABLED;
  const previousQuotes = process.env.CRM_CORE_QUOTES_ENABLED;
  try {
    setFlags('false', 'true');
    assert.equal((await handler(event('GET'))).statusCode, 200);
    assert.deepEqual(calls, ['core:GET']);
  } finally {
    setFlags(previousClients, previousQuotes);
  }
});

test('quote core rollout leaves client writes and non-GET methods on legacy', async () => {
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
  const previousClients = process.env.CRM_CORE_CLIENTS_ENABLED;
  const previousQuotes = process.env.CRM_CORE_QUOTES_ENABLED;
  try {
    setFlags('false', 'true');
    assert.equal((await handler(event('POST'))).statusCode, 201);
    assert.equal((await handler(event('DELETE'))).statusCode, 201);
    assert.equal((await handler(event('PATCH'))).statusCode, 201);
    assert.deepEqual(calls, ['legacy:POST', 'legacy:DELETE', 'legacy:PATCH']);
  } finally {
    setFlags(previousClients, previousQuotes);
  }
});

test('clients flag still promotes every method and both flags disabled stay legacy', async () => {
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
  const previousClients = process.env.CRM_CORE_CLIENTS_ENABLED;
  const previousQuotes = process.env.CRM_CORE_QUOTES_ENABLED;
  try {
    setFlags('true', 'false');
    assert.equal((await handler(event('POST'))).statusCode, 200);
    assert.equal((await handler(event('DELETE'))).statusCode, 200);
    setFlags('false', 'false');
    assert.equal((await handler(event('GET'))).statusCode, 201);
    assert.deepEqual(calls, ['core:POST', 'core:DELETE', 'legacy:GET']);
  } finally {
    setFlags(previousClients, previousQuotes);
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
  const previousClients = process.env.CRM_CORE_CLIENTS_ENABLED;
  const previousQuotes = process.env.CRM_CORE_QUOTES_ENABLED;
  try {
    setFlags('1', 'TRUE');
    assert.equal((await handler(event('GET'))).statusCode, 201);
    assert.deepEqual(calls, ['legacy']);
  } finally {
    setFlags(previousClients, previousQuotes);
  }
});
