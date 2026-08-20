import assert from 'node:assert/strict';
import test from 'node:test';
import { getOpenRouterConfig } from '../../api/_infrastructure/integrations/openrouter/config.js';
import { getOpenRouterClient } from '../../api/_infrastructure/integrations/openrouter/client.js';

test('resolves key, model, and referer without caching env', () => {
  const env: NodeJS.ProcessEnv = {
    OPENROUTER_API_KEY: ' key ',
    OPENROUTER_MODEL: ' model ',
    URL: ' https://app.example ',
  };
  assert.deepEqual(getOpenRouterConfig(env), {
    apiKey: 'key',
    model: 'model',
    siteUrl: 'https://app.example',
  });
  env.OPENROUTER_SITE_URL = ' https://preview.example ';
  assert.equal(getOpenRouterConfig(env).siteUrl, 'https://preview.example');
});

test('posts chat completions with caller title and signal', async () => {
  let captured: { input?: string; init?: RequestInit } = {};
  const controller = new AbortController();
  const client = getOpenRouterClient({
    getConfig: () => ({ apiKey: 'key', model: 'model', siteUrl: 'https://app.example' }),
    fetchImpl: async (input, init) => {
      captured = { input: String(input), init };
      return new Response('{}', { status: 200 });
    },
  });
  await client.request(
    { model: 'model', messages: [] },
    {
      title: 'Aspen Test',
      signal: controller.signal,
    }
  );
  assert.equal(captured.input, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(new Headers(captured.init?.headers).get('Authorization'), 'Bearer key');
  assert.equal(new Headers(captured.init?.headers).get('X-OpenRouter-Title'), 'Aspen Test');
  assert.equal(new Headers(captured.init?.headers).get('HTTP-Referer'), 'https://app.example');
  assert.equal(captured.init?.signal, controller.signal);
});
