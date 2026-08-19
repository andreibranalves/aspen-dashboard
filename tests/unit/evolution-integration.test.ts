import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getEvolutionClient,
  type EvolutionConfig,
} from '../../api/_infrastructure/integrations/evolution/client.js';
import { getEvolutionConfig } from '../../api/_infrastructure/integrations/evolution/config.js';

test('reads and normalizes Evolution config on every call', () => {
  const env: NodeJS.ProcessEnv = {
    EVOLUTION_BASE_URL: ' https://evolution.example/// ',
    EVOLUTION_API_KEY: ' secret ',
    EVOLUTION_INSTANCE: ' aspen ',
  };
  assert.deepEqual(getEvolutionConfig(env), {
    baseUrl: 'https://evolution.example',
    apiKey: 'secret',
    instance: 'aspen',
  });
  env.EVOLUTION_INSTANCE = ' second ';
  assert.equal(getEvolutionConfig(env).instance, 'second');
});

test('builds authenticated requests and guards writes only', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  let guards = 0;
  const config: EvolutionConfig = {
    baseUrl: 'https://evolution.example',
    apiKey: 'secret',
    instance: 'aspen',
  };
  const client = getEvolutionClient({
    getConfig: () => config,
    assertWriteAllowed: () => {
      guards += 1;
    },
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response('{}', { status: 200 });
    },
  });

  await client.request('/chat/findChats/aspen', { limit: 10 }, { externalWrite: false });
  await client.request('/message/sendText/aspen', { number: '5511', text: 'Oi' });

  assert.equal(guards, 1);
  assert.equal(calls[0].input, 'https://evolution.example/chat/findChats/aspen');
  assert.equal(new Headers(calls[0].init?.headers).get('apikey'), 'secret');
  assert.equal(calls[0].init?.body, JSON.stringify({ limit: 10 }));
});
