/* global Buffer, console, process, setTimeout */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const EVENT_TYPES = new Set(['quotation.created', 'quotation.updated', 'quotation.issued', 'quotation.sent']);
const PROVIDERS = new Set(['n8n', 'evolution', 'crm']);
const CANONICAL_FIELDS = ['event_type', 'provider', 'quotation_id', 'revision_id', 'business_number', 'idempotency_key'];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function json(response, status, body) {
  if (response.destroyed) return;
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function canonicalEvent(body) {
  if (
    typeof body !== 'object' || body === null ||
    typeof body.event_type !== 'string' || !EVENT_TYPES.has(body.event_type) ||
    typeof body.provider !== 'string' || !PROVIDERS.has(body.provider) ||
    CANONICAL_FIELDS.slice(2).some((field) => typeof body[field] !== 'string' || !body[field].trim())
  ) return null;
  return Object.fromEntries(CANONICAL_FIELDS.map((field) => [field, body[field].trim()]));
}

export async function createFakeOutboxBridge(options = {}) {
  const mode = options.mode || process.env.FAKE_OUTBOX_MODE || 'accepted';
  const delayMs = Number(options.delayMs ?? process.env.FAKE_OUTBOX_DELAY_MS ?? 0);
  const requests = [];
  const duplicates = [];
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
    const event = canonicalEvent(body);
    if (!event) {
      json(response, 400, { error: 'canonical_event_required' });
      return;
    }
    requests.push(event);
    const duplicate = seenKeys.has(event.idempotency_key);
    seenKeys.add(event.idempotency_key);
    if (duplicate) duplicates.push(event.idempotency_key);

    if (mode === 'error') {
      json(response, 500, { accepted: false, error: 'fake_failure' });
      return;
    }
    if (mode === 'timeout') await delay(delayMs || 60_000);
    json(response, 202, {
      accepted: true,
      duplicate,
      message_id: 'fake-1',
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
    duplicates,
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
