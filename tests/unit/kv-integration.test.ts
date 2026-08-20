import assert from 'node:assert/strict';
import test from 'node:test';
import { getKvClient } from '../../api/_infrastructure/integrations/kv/client.js';
import { isKvConfigured } from '../../api/_infrastructure/integrations/kv/config.js';

test('checks KV env on every call without exposing values', () => {
  const env: NodeJS.ProcessEnv = {};
  assert.equal(isKvConfigured(env), false);
  env.KV_REST_API_URL = ' https://kv.example ';
  env.KV_REST_API_TOKEN = ' token ';
  assert.equal(isKvConfigured(env), true);
  env.KV_REST_API_TOKEN = '   ';
  assert.equal(isKvConfigured(env), false);
});

test('returns the installed KV client', () => {
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  try {
    process.env.KV_REST_API_URL = 'https://kv.example';
    process.env.KV_REST_API_TOKEN = 'token';
    const client = getKvClient();
    assert.equal(typeof client.get, 'function');
    assert.equal(typeof client.set, 'function');
  } finally {
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
});
