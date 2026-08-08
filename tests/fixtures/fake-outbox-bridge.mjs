/* global Buffer, console, process, setTimeout */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export async function createFakeOutboxBridge(options = {}) {
  const mode = options.mode || process.env.FAKE_OUTBOX_MODE || 'accepted';
  const delayMs = Number(options.delayMs ?? process.env.FAKE_OUTBOX_DELAY_MS ?? 0);
  const requests = [];
  const seenKeys = new Set();
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/events') {
      json(response, 404, { error: 'not_found' });
      return;
    }

    let body;
    try {
      body = await readBody(request);
    } catch {
      json(response, 400, { error: 'invalid_json' });
      return;
    }
    requests.push(body);
    const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
    const duplicate = idempotencyKey && seenKeys.has(idempotencyKey);
    if (idempotencyKey) seenKeys.add(idempotencyKey);

    if (mode === 'error') {
      json(response, 500, { accepted: false, error: 'fake_failure' });
      return;
    }
    if (mode === 'timeout') {
      await delay(delayMs || 60_000);
    }
    json(response, 202, {
      accepted: true,
      message_id: duplicate ? 'fake-1' : 'fake-1',
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port || 0, options.host || '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Fake outbox bridge não abriu uma porta TCP.');
  }
  return {
    url: `http://${address.address}:${address.port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

const invokedPath = process.argv[1] && pathToFileURL(process.argv[1]).href;
if (invokedPath && import.meta.url === invokedPath) {
  const bridge = await createFakeOutboxBridge();
  console.log(JSON.stringify({ health: `${bridge.url}/health`, events: `${bridge.url}/events` }));
}
