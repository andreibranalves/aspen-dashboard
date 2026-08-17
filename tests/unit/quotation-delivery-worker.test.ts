import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handler as worker,
  QUOTATION_DELIVERY_WORKER_BATCH_SIZE,
} from '../../api/_functions/quotation-delivery-worker.js';

const cronSecret = 'c'.repeat(32);

function event(
  headers: Record<string, string> = {},
  httpMethod = 'POST',
) {
  return {
    httpMethod,
    headers,
    queryStringParameters: {},
    body: '',
  } as const;
}

test('worker requires CRON_SECRET and bounds the batch', async () => {
  const processDueCalls: number[] = [];
  const deps = {
    processDue: async (limit: number) => {
      processDueCalls.push(limit);
      return { processed: limit, remaining: true };
    },
    environment: { CRON_SECRET: cronSecret },
  };

  assert.equal(
    (await worker(event({ authorization: 'Bearer ' + 'x'.repeat(32) }), deps)).statusCode,
    401,
  );
  assert.deepEqual(processDueCalls, []);

  const result = await worker(event({ authorization: `Bearer ${cronSecret}` }), deps);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '{}'), {
    processed: QUOTATION_DELIVERY_WORKER_BATCH_SIZE,
    remaining: true,
  });
  assert.deepEqual(processDueCalls, [QUOTATION_DELIVERY_WORKER_BATCH_SIZE]);
});

test('worker supports GET and fails closed without a sufficiently long secret', async () => {
  let calls = 0;
  const processDue = async () => {
    calls += 1;
    return { processed: 0, remaining: false };
  };

  const result = await worker(
    event({ authorization: `Bearer ${cronSecret}` }, 'GET'),
    { processDue, environment: { CRON_SECRET: cronSecret } },
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '{}'), { processed: 0, remaining: false });
  assert.equal(calls, 1);

  const noSecret = await worker(
    event({ authorization: `Bearer ${cronSecret}` }),
    { processDue, environment: {} },
  );
  assert.equal(noSecret.statusCode, 401);
  assert.equal(calls, 1);

  const shortSecret = await worker(
    event({ authorization: 'Bearer ' + 's'.repeat(31) }),
    { processDue, environment: { CRON_SECRET: 's'.repeat(31) } },
  );
  assert.equal(shortSecret.statusCode, 401);
  assert.equal(calls, 1);
});

test('worker returns safe service error for invalid module counts', async () => {
  const result = await worker(event({ authorization: `Bearer ${cronSecret}` }), {
    processDue: async () => ({ processed: QUOTATION_DELIVERY_WORKER_BATCH_SIZE + 1, remaining: true }),
    environment: { CRON_SECRET: cronSecret },
  });
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.parse(result.body || '{}').processed, undefined);
});
