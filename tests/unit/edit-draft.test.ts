import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../api/_modules/edit-draft.js';

function event(body: unknown) {
  return {
    httpMethod: 'POST',
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify(body),
  };
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('edit-draft rejects an empty OpenRouter key without fetching', async () => {
  const previousEnv = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
  const previousFetch = globalThis.fetch;
  let calls = 0;
  process.env.OPENROUTER_API_KEY = '';
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('fetch should not run');
  }) as typeof fetch;

  try {
    const result = await handler(event({ prompt: 'Altere o nome', currentDraft: {} }));

    assert.equal(result.statusCode, 500);
    assert.deepEqual(JSON.parse(result.body || ''), {
      error: 'Serviço de edição indisponível.',
    });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previousEnv);
  }
});

test('edit-draft preserves the OpenRouter payload and proposed draft', async () => {
  const previousEnv = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    OPENROUTER_SITE_URL: process.env.OPENROUTER_SITE_URL,
    URL: process.env.URL,
    DEPLOY_PRIME_URL: process.env.DEPLOY_PRIME_URL,
  };
  const previousFetch = globalThis.fetch;
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const currentDraft = {
    nome: 'Ana',
    email: 'ana@example.com',
    telefone: '5511999999999',
    urgente: false,
    items: [{ item_code: 'SKU-1', qty: 30 }],
  };
  const prompt = 'Marque como urgente';
  const proposed = {
    ...currentDraft,
    urgente: true,
  };

  process.env.OPENROUTER_API_KEY = ' key ';
  process.env.OPENROUTER_MODEL = ' edit/model ';
  process.env.OPENROUTER_SITE_URL = ' https://app.example ';
  delete process.env.URL;
  delete process.env.DEPLOY_PRIME_URL;
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(proposed) } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const result = await handler(event({ prompt, currentDraft }));
    const requestBody = JSON.parse(String(requestInit?.body));
    const userText = `Rascunho atual:\n${JSON.stringify(currentDraft, null, 2)}\n\nComando do operador:\n${prompt}`;

    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body || ''), { proposed });
    assert.equal(requestUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(new Headers(requestInit?.headers).get('Authorization'), 'Bearer key');
    assert.equal(new Headers(requestInit?.headers).get('Content-Type'), 'application/json');
    assert.equal(
      new Headers(requestInit?.headers).get('X-OpenRouter-Title'),
      'Aspen Orcamento App'
    );
    assert.equal(new Headers(requestInit?.headers).get('HTTP-Referer'), 'https://app.example');
    assert.equal(requestBody.model, 'edit/model');
    assert.equal(requestBody.temperature, 0.1);
    assert.deepEqual(requestBody.messages[1], {
      role: 'user',
      content: [{ type: 'text', text: userText }],
    });
    assert.equal(requestBody.messages[0].role, 'system');
    assert.match(requestBody.messages[0].content, /assistente de edição de cotação/);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previousEnv);
  }
});
