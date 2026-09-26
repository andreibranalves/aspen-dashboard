import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { FunctionEvent } from '../../api/_http/types.js';
import type { EvolutionWebhookOutcome } from '../../api/_modules/evolution-webhook.js';
import { MAX_EVOLUTION_WEBHOOK_BODY_BYTES } from '../../api/_modules/evolution-webhook.js';
import { createWorkerServer, type WorkerServerOptions } from '../../api/_worker/server.js';
import { createWorkerEvolutionWebhook } from '../../api/_worker/webhook.js';

const WAKE_SECRET = 'w'.repeat(32);

async function withWorker(sha: string, onWake?: () => void) {
  const server = createWorkerServer({ sha, wakeSecret: WAKE_SECRET, onWake });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

test('worker: /health answers with the deployed commit', async () => {
  const worker = await withWorker('0123abcd');
  try {
    const response = await fetch(`${worker.baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', sha: '0123abcd' });
  } finally {
    await worker.close();
  }
});

test('worker: /health stays up without a reachable database', async () => {
  const saved = process.env.DATABASE_URL;
  // Porta fechada: se o healthcheck tocasse o banco, a resposta demoraria ou falharia.
  process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:9/none';
  const worker = await withWorker('sha');
  try {
    const response = await fetch(`${worker.baseUrl}/health`);
    assert.equal(response.status, 200);
  } finally {
    await worker.close();
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

test('worker: other paths and methods are refused', async () => {
  const worker = await withWorker('sha');
  try {
    const unknown = await fetch(`${worker.baseUrl}/api/quotations`);
    assert.equal(unknown.status, 404);
    const post = await fetch(`${worker.baseUrl}/health`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');
  } finally {
    await worker.close();
  }
});

test('worker: /wake accepts only the bearer secret and triggers a cycle', async () => {
  let wakes = 0;
  const worker = await withWorker('sha', () => {
    wakes += 1;
  });
  try {
    const missing = await fetch(`${worker.baseUrl}/wake`, { method: 'POST' });
    assert.equal(missing.status, 401);
    const wrong = await fetch(`${worker.baseUrl}/wake`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'x'.repeat(32)}` },
    });
    assert.equal(wrong.status, 401);
    const get = await fetch(`${worker.baseUrl}/wake`, { headers: { Authorization: `Bearer ${WAKE_SECRET}` } });
    assert.equal(get.status, 405);
    assert.equal(wakes, 0);
    const accepted = await fetch(`${worker.baseUrl}/wake`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WAKE_SECRET}` },
    });
    assert.equal(accepted.status, 202);
    assert.equal(wakes, 1);
  } finally {
    await worker.close();
  }
});

test('worker: /wake refuses everything when the secret is not configured', async () => {
  const server = createWorkerServer({ sha: 'sha', onWake: () => assert.fail('must not wake') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/wake`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' },
    });
    assert.equal(response.status, 401);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

async function listen(options: WorkerServerOptions) {
  const server = createWorkerServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}/webhook/evolution`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

const accepted = (): EvolutionWebhookOutcome => ({ response: { statusCode: 200, body: '{"received":true}' } });

test('worker: the Evolution webhook answers before the work it leaves for later', async () => {
  const events: FunctionEvent[] = [];
  const order: string[] = [];
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished!: () => void;
  const afterDone = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const worker = await listen({
    sha: 'sha',
    evolutionWebhook: async (event) => {
      events.push(event);
      return {
        response: { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"received":true}' },
        afterResponse: async () => {
          await released;
          order.push('after');
          finished();
          return true;
        },
      };
    },
  });
  try {
    const response = await fetch(worker.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{"event":"messages.upsert"}',
    });
    order.push('response');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
    assert.equal(events[0].body, '{"event":"messages.upsert"}');
    assert.equal(events[0].headers.authorization, 'Bearer token');
    release();
    await afterDone;
    assert.deepEqual(order, ['response', 'after']);
  } finally {
    await worker.close();
  }
});

test('worker: the Evolution webhook refuses oversized bodies, other methods and handler errors', async () => {
  const reported: string[] = [];
  let calls = 0;
  const worker = await listen({
    sha: 'sha',
    evolutionWebhook: async () => {
      calls += 1;
      throw new Error('database unavailable');
    },
    reportError: (task) => reported.push(task),
  });
  try {
    const oversized = await fetch(worker.url, { method: 'POST', body: 'x'.repeat(MAX_EVOLUTION_WEBHOOK_BODY_BYTES + 1) });
    assert.equal(oversized.status, 413);
    assert.equal(calls, 0);
    const get = await fetch(worker.url);
    assert.equal(get.status, 405);
    const failing = await fetch(worker.url, { method: 'POST', body: '{}' });
    assert.equal(failing.status, 500);
    assert.deepEqual(await failing.json(), { error: 'Erro interno. Tente novamente.' });
    assert.deepEqual(reported, ['webhook do Evolution']);
  } finally {
    await worker.close();
  }
});

test('worker: without a webhook handler the route does not exist', async () => {
  const worker = await listen({ sha: 'sha' });
  try {
    const response = await fetch(worker.url, { method: 'POST', body: '{}' });
    assert.equal(response.status, 404);
  } finally {
    await worker.close();
  }
});

test('worker webhook: wakes the cycle after the deferred work, and shutdown waits for it', async () => {
  let wakes = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const webhook = createWorkerEvolutionWebhook({
    wake: () => {
      wakes += 1;
    },
    receive: async (event) =>
      event.body === 'ignored'
        ? accepted()
        : {
            ...accepted(),
            afterResponse: async () => {
              await released;
              return false;
            },
          },
  });
  const event = { httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '' };

  const ignored = await webhook.handle({ ...event, body: 'ignored' });
  assert.equal(ignored.afterResponse, undefined);

  const recorded = await webhook.handle(event);
  const work = recorded.afterResponse?.();
  let settled = false;
  const settling = webhook.settle().then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'shutdown waits for effects still being applied');
  assert.equal(wakes, 0);
  release();
  assert.equal(await work, false);
  await settling;
  assert.equal(wakes, 1, 'a pending effect goes to the cycle');
});
