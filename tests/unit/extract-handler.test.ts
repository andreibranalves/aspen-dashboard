import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handler } from '../../api/_functions/extract.js';

function event(method: string, body: unknown) {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
    headers: {},
    queryStringParameters: {},
  };
}

test('extract rejects unsupported methods with a Portuguese JSON error', async () => {
  const result = await handler(event('GET', {}));

  assert.equal(result.statusCode, 405);
  assert.equal(result.headers?.['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(result.body || ''), { error: 'Método não permitido.' });
});

test('extract validates the OpenRouter request and normalizes its JSON response', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousModel = process.env.OPENROUTER_MODEL;
  const previousFetch = globalThis.fetch;
  let requestUrl = '';
  let requestInit: RequestInit | undefined;

  process.env.OPENROUTER_API_KEY = 'unit-test-key';
  process.env.OPENROUTER_MODEL = 'unit-test/model';
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '[{"nome":"Cliente","items":[{"item_code":"SKU-1","qty":30}]}]' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const result = await handler(
      event('POST', { text: 'Cliente precisa de 30 unidades do SKU-1.' }),
    );
    const requestBody = JSON.parse(String(requestInit?.body));

    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body || ''), {
      orders: [{ nome: 'Cliente', items: [{ item_code: 'SKU-1', qty: 30 }] }],
    });
    assert.equal(requestUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal((requestInit?.headers as Record<string, string>).Authorization, 'Bearer unit-test-key');
    assert.equal(requestBody.model, 'unit-test/model');
    assert.equal(requestBody.messages[0].role, 'system');
    assert.equal(requestBody.messages[1].content, 'Cliente precisa de 30 unidades do SKU-1.');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = previousModel;
  }
});
