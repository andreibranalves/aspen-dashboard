import assert from 'node:assert/strict';
import test from 'node:test';

import { checkRateLimitAsync } from '../../api/_lib/rate-limit.js';

test('public quotation rate limit fails closed without shared KV', async () => {
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  try {
    assert.equal(
      await checkRateLimitAsync({
        method: 'GET',
        url: '/api/public-quotation?token=opaque-token',
        headers: {},
      }),
      false,
    );
  } finally {
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
});
