import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createWorkerServer } from '../../api/_worker/server.js';

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
