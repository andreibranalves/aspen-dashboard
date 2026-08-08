import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { checkRateLimitAsync, rateLimitKv } from '../../api/_lib/rate-limit.js';

function publicRequest(socketAddress = '10.0.0.1', forwardedAddress = '198.51.100.8') {
  return {
    method: 'GET',
    url: '/api/public-quotation?token=opaque-token',
    headers: { 'x-forwarded-for': forwardedAddress },
    socket: { remoteAddress: socketAddress },
  };
}

test('public quotation rate limit fails closed without shared KV', async () => {
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  try {
    assert.equal(await checkRateLimitAsync(publicRequest()), false);
  } finally {
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
});

test('public quotation rate limit uses atomic increment and TTL with socket identity', async () => {
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  const previousEval = rateLimitKv.eval;
  process.env.KV_REST_API_URL = 'https://kv.test';
  process.env.KV_REST_API_TOKEN = 'test-token';

  const calls: Array<{ script: string; keys: string[]; args: unknown[] }> = [];
  const counts = new Map<string, number>();
  rateLimitKv.eval = async (script, keys, args) => {
    calls.push({ script, keys, args });
    assert.match(script, /redis\.call\('INCR', KEYS\[1\]\)/);
    assert.match(script, /redis\.call\('EXPIRE', KEYS\[1\], ARGV\[1\]\)/);
    const key = keys[0];
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    return count;
  };

  try {
    const results = await Promise.all(
      Array.from({ length: 21 }, () => checkRateLimitAsync(publicRequest())),
    );
    assert.equal(results.filter(Boolean).length, 20);
    assert.equal(results.filter((allowed) => !allowed).length, 1);
    assert.equal(calls.length, 21);
    assert.deepEqual(calls[0].args, [60]);
    assert.equal(calls.every(({ keys }) => keys.length === 1), true);

    const socketHash = createHash('sha256').update('10.0.0.1').digest('hex');
    assert.equal(calls.every(({ keys }) => keys[0].includes('public-token:')), true);
    assert.equal(calls.every(({ keys }) => !keys[0].includes('198.51.100.8')), true);

    const socketCalls: typeof calls = [];
    rateLimitKv.eval = async (script, keys, args) => {
      socketCalls.push({ script, keys, args });
      return 1;
    };
    await checkRateLimitAsync({
      method: 'GET',
      url: '/api/public-quotation',
      headers: { 'x-forwarded-for': '198.51.100.8' },
      socket: { remoteAddress: '10.0.0.1' },
    });
    assert.equal(socketCalls[0].keys[0].includes(`public-ip:${socketHash}`), true);
    assert.equal(socketCalls[0].keys[0].includes('10.0.0.1'), false);
    assert.equal(socketCalls[0].keys[0].includes('198.51.100.8'), false);
  } finally {
    rateLimitKv.eval = previousEval;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
});
