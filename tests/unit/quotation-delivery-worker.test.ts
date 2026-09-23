import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handler as rawWorker,
  QUOTATION_DELIVERY_WORKER_BATCH_SIZE,
  type QuotationDeliveryWorkerDependencies,
} from '../../api/_modules/quotation-delivery-worker.js';
import type {
  QuotationDeliveryWorkerRunResult,
} from '../../api/_infrastructure/db/repositories/quotation-delivery-diagnostics-repository.js';

const cronSecret = 'c'.repeat(32);

// The webhook-effects drain is DB work; tests that do not exercise it stub it.
function worker(
  input: Parameters<typeof rawWorker>[0],
  dependencies: QuotationDeliveryWorkerDependencies = {},
) {
  return rawWorker(input, { drainEffects: async () => ({ applied: 0, failed: 0 }), ...dependencies });
}

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

test('worker records a successful invocation without changing its body', async () => {
  const heartbeats: QuotationDeliveryWorkerRunResult[] = [];
  const result = await worker(event({ authorization: `Bearer ${cronSecret}` }), {
    processDue: async () => ({ processed: 2, remaining: false }),
    recordRun: async (value) => {
      heartbeats.push(value);
    },
    environment: { CRON_SECRET: cronSecret },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '{}'), { processed: 2, remaining: false });
  assert.deepEqual(heartbeats, [{ result: 'success', processed: 2, remaining: false }]);
});

test('worker records a failed invocation when processing throws', async () => {
  const heartbeats: QuotationDeliveryWorkerRunResult[] = [];
  const result = await worker(event({ authorization: `Bearer ${cronSecret}` }), {
    processDue: async () => {
      throw new Error('worker failure');
    },
    recordRun: async (value) => {
      heartbeats.push(value);
    },
    environment: { CRON_SECRET: cronSecret },
  });
  assert.equal(result.statusCode, 503);
  assert.deepEqual(heartbeats, [{ result: 'failure' }]);
});

test('worker keeps reporting the run when the diagnostics heartbeat fails', async () => {
  const result = await worker(event({ authorization: `Bearer ${cronSecret}` }), {
    processDue: async () => ({ processed: 1, remaining: true }),
    recordRun: async () => {
      throw new Error('diagnostics unavailable');
    },
    environment: { CRON_SECRET: cronSecret },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '{}'), { processed: 1, remaining: true });
});

test('worker returns safe service error for invalid module counts', async () => {
  const heartbeats: QuotationDeliveryWorkerRunResult[] = [];
  const result = await worker(event({ authorization: `Bearer ${cronSecret}` }), {
    processDue: async () => ({ processed: QUOTATION_DELIVERY_WORKER_BATCH_SIZE + 1, remaining: true }),
    recordRun: async (value) => {
      heartbeats.push(value);
    },
    environment: { CRON_SECRET: cronSecret },
  });
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.parse(result.body || '{}').processed, undefined);
  assert.deepEqual(heartbeats, [{ result: 'failure' }]);
});

test('worker drains pending webhook effects only after the quotation batch and within budget', async () => {
  const order: string[] = [];
  let now = 1_000_000;
  const deps: QuotationDeliveryWorkerDependencies = {
    processDue: async (limit: number) => {
      order.push(`batch:${limit}`);
      return { processed: 1, remaining: false };
    },
    recordRun: async () => {},
    drainEffects: async (deadlineAt: number) => {
      order.push(`drain:${deadlineAt - 1_000_000}`);
      return { applied: 2, failed: 0 };
    },
    clock: () => now,
    environment: { CRON_SECRET: cronSecret },
  };

  const result = await rawWorker(event({ authorization: `Bearer ${cronSecret}` }), deps);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '{}'), { processed: 1, remaining: false });
  assert.deepEqual(order, [`batch:${QUOTATION_DELIVERY_WORKER_BATCH_SIZE}`, 'drain:50000']);

  order.length = 0;
  deps.processDue = async (limit: number) => {
    order.push(`batch:${limit}`);
    now += 46_000;
    return { processed: 3, remaining: true };
  };
  await rawWorker(event({ authorization: `Bearer ${cronSecret}` }), deps);
  assert.deepEqual(order, [`batch:${QUOTATION_DELIVERY_WORKER_BATCH_SIZE}`], 'no drain without room left');
});

test('a failing webhook-effects drain never changes the batch result', async () => {
  const heartbeats: QuotationDeliveryWorkerRunResult[] = [];
  const result = await rawWorker(event({ authorization: `Bearer ${cronSecret}` }), {
    processDue: async () => ({ processed: 2, remaining: false }),
    recordRun: async (value) => {
      heartbeats.push(value);
    },
    drainEffects: async () => {
      throw new Error('database unavailable');
    },
    environment: { CRON_SECRET: cronSecret },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(heartbeats, [{ result: 'success', processed: 2, remaining: false }]);
});
