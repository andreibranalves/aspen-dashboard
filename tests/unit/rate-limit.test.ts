import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { checkRateLimitAsync, rateLimitKv } from '../../api/_lib/rate-limit.js';

const KV_URL = 'https://kv.test';
const KV_TOKEN = 'test-token';

function publicRequest(
  socketAddress = '10.0.0.1',
  forwardedHeaders: Record<string, string> = {},
  token = 'opaque-token',
) {
  return {
    method: 'GET',
    url: token ? `/api/public-quotation?token=${token}` : '/api/public-quotation',
    headers: forwardedHeaders,
    socket: { remoteAddress: socketAddress },
  };
}

function setSharedKvEnvironment(): { restore: () => void } {
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  process.env.KV_REST_API_URL = KV_URL;
  process.env.KV_REST_API_TOKEN = KV_TOKEN;
  return {
    restore: () => {
      if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = previousUrl;
      if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = previousToken;
    },
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

test('public quotation rate limit models atomic increment and conditional TTL under interleaving', async () => {
  const environment = setSharedKvEnvironment();
  const previousEval = rateLimitKv.eval;
  const buckets = new Map<string, { count: number; ttlSeconds: number | null; expireWrites: number }>();
  const calls: Array<{ script: string; keys: string[]; args: unknown[] }> = [];
  let activeEvaluations = 0;
  let maxActiveEvaluations = 0;

  rateLimitKv.eval = async (script, keys, args) => {
    calls.push({ script, keys, args });
    assert.equal(keys.length, 1);
    assert.deepEqual(args, [60]);
    activeEvaluations += 1;
    maxActiveEvaluations = Math.max(maxActiveEvaluations, activeEvaluations);
    await new Promise<void>((resolve) => setImmediate(resolve));
    activeEvaluations -= 1;

    const key = keys[0];
    const bucket = buckets.get(key) || { count: 0, ttlSeconds: null, expireWrites: 0 };
    bucket.count += 1;
    const conditionalFirstExpire = /if\s+count\s*==\s*1\s+then\s+redis\.call\('EXPIRE',\s*KEYS\[1\],\s*ARGV\[1\]\)\s*end/s.test(
      script,
    );
    const unconditionalExpire = /redis\.call\('EXPIRE',\s*KEYS\[1\],\s*ARGV\[1\]\)/s.test(script) && !conditionalFirstExpire;
    if ((conditionalFirstExpire && bucket.count === 1) || unconditionalExpire) {
      bucket.ttlSeconds = Number(args[0]);
      bucket.expireWrites += 1;
    }
    buckets.set(key, bucket);
    return bucket.count;
  };

  try {
    const results = await Promise.all(
      Array.from({ length: 21 }, () => checkRateLimitAsync(publicRequest())),
    );
    assert.equal(maxActiveEvaluations > 1, true);
    assert.equal(results.filter(Boolean).length, 20);
    assert.equal(results.filter((allowed) => !allowed).length, 1);
    assert.equal(calls.length, 21);

    const tokenDigest = createHash('sha256').update('opaque-token').digest('hex');
    const tokenKey = `aspen:rate-limit:public-quotation:public-token:${tokenDigest}`;
    assert.equal(calls.every(({ keys }) => keys[0] === tokenKey), true);
    assert.equal(calls.every(({ keys }) => !keys[0].includes('opaque-token')), true);
    const tokenBucket = buckets.get(tokenKey);
    assert.deepEqual(tokenBucket, { count: 21, ttlSeconds: 60, expireWrites: 1 });

    const forwardedHeaders = {
      'x-forwarded-for': '198.51.100.8',
      'x-real-ip': '198.51.100.9',
      'cf-connecting-ip': '198.51.100.10',
      forwarded: 'for=198.51.100.11',
      'true-client-ip': '198.51.100.12',
      'fly-client-ip': '198.51.100.13',
    };
    await checkRateLimitAsync(publicRequest('10.0.0.1', forwardedHeaders, ''));
    await checkRateLimitAsync(publicRequest('10.0.0.2', forwardedHeaders, ''));
    await checkRateLimitAsync(publicRequest('10.0.0.1', { 'x-forwarded-for': '203.0.113.1' }, ''));

    const firstSocketDigest = createHash('sha256').update('10.0.0.1').digest('hex');
    const secondSocketDigest = createHash('sha256').update('10.0.0.2').digest('hex');
    const firstSocketKey = `aspen:rate-limit:public-quotation:public-ip:${firstSocketDigest}`;
    const secondSocketKey = `aspen:rate-limit:public-quotation:public-ip:${secondSocketDigest}`;
    assert.notEqual(firstSocketKey, secondSocketKey);
    assert.equal(buckets.get(firstSocketKey)?.count, 2);
    assert.equal(buckets.get(firstSocketKey)?.expireWrites, 1);
    assert.equal(buckets.get(secondSocketKey)?.count, 1);
    assert.equal(buckets.get(secondSocketKey)?.expireWrites, 1);
    for (const headerValue of Object.values(forwardedHeaders)) {
      assert.equal(firstSocketKey.includes(headerValue), false);
      assert.equal(secondSocketKey.includes(headerValue), false);
    }
  } finally {
    rateLimitKv.eval = previousEval;
    environment.restore();
  }
});

test('public quotation rate limit fails closed for provider errors and invalid counts', async () => {
  const environment = setSharedKvEnvironment();
  const previousEval = rateLimitKv.eval;
  try {
    rateLimitKv.eval = async () => {
      throw new Error('provider unavailable');
    };
    assert.equal(await checkRateLimitAsync(publicRequest()), false);

    for (const invalidCount of [true, '1', {}, Number.NaN, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
      rateLimitKv.eval = (async () => invalidCount) as typeof rateLimitKv.eval;
      assert.equal(await checkRateLimitAsync(publicRequest()), false, `invalid count: ${String(invalidCount)}`);
    }
  } finally {
    rateLimitKv.eval = previousEval;
    environment.restore();
  }
});

test('public quotation rate limit fails closed when key derivation cannot parse the request URL', async () => {
  const environment = setSharedKvEnvironment();
  const previousEval = rateLimitKv.eval;
  try {
    rateLimitKv.eval = async () => {
      throw new Error('eval must not run for malformed URL');
    };
    assert.equal(
      await checkRateLimitAsync({
        method: 'GET',
        url: '%%%invalid-url%%%',
        query: { path: 'public-quotation' },
        headers: {},
      }),
      false,
    );
  } finally {
    rateLimitKv.eval = previousEval;
    environment.restore();
  }
});
