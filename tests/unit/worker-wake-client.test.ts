import assert from 'node:assert/strict';
import test from 'node:test';
import { wakeWorker } from '../../api/_infrastructure/integrations/worker/client.js';

const SECRET = 's'.repeat(32);
const production = {
  APP_ENV: 'production',
  EXTERNAL_WRITES_ENABLED: '1',
  WORKER_WAKE_URL: 'https://aspen-worker.example.test/wake',
  WORKER_WAKE_SECRET: SECRET,
};

function recordingFetch(status: number) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init || {} });
    return new Response(null, { status });
  }) as typeof fetch;
  return { requests, fetchFn };
}

test('wake posts an empty request with the bearer secret', async () => {
  const { requests, fetchFn } = recordingFetch(202);
  assert.equal(await wakeWorker({ env: production, fetchFn }), 'sent');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://aspen-worker.example.test/wake');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.body, undefined);
  assert.deepEqual(requests[0].init.headers, { Authorization: `Bearer ${SECRET}` });
  assert.ok(requests[0].init.signal);
});

test('wake stays off outside production writes', async () => {
  const { requests, fetchFn } = recordingFetch(202);
  assert.equal(await wakeWorker({ env: { ...production, VERCEL_ENV: 'preview' }, fetchFn }), 'disabled');
  assert.equal(await wakeWorker({ env: { ...production, EXTERNAL_WRITES_ENABLED: '0' }, fetchFn }), 'disabled');
  assert.equal(requests.length, 0);
});

test('wake fails without a usable URL or secret, on refusal and on network errors', async () => {
  const { requests, fetchFn } = recordingFetch(401);
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args.join(' '));
  try {
    assert.equal(await wakeWorker({ env: { ...production, WORKER_WAKE_URL: 'http://plain.test/wake' }, fetchFn }), 'failed');
    assert.equal(await wakeWorker({ env: { ...production, WORKER_WAKE_SECRET: 'short' }, fetchFn }), 'failed');
    assert.equal(requests.length, 0);
    assert.equal(await wakeWorker({ env: production, fetchFn }), 'failed');
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    assert.equal(await wakeWorker({ env: production, fetchFn: offline }), 'failed');
  } finally {
    console.error = original;
  }
  // O log não carrega o segredo.
  assert.ok(logged.every((line) => !String(line).includes(SECRET)));
});
