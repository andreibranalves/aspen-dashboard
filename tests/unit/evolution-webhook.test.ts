import assert from 'node:assert/strict';
import test from 'node:test';

import apiHandler from '../../api/[...path].js';
import {
  handler as webhook,
  MAX_EVOLUTION_WEBHOOK_BODY_BYTES,
} from '../../api/_functions/evolution-webhook.js';

const webhookSecret = 'w'.repeat(32);
const instance = 'instance-test';

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { data: dataOverrides, ...topLevelOverrides } = overrides;
  return {
    event: 'MESSAGES_UPDATE',
    instance,
    ...topLevelOverrides,
    data: {
      keyId: 'provider-message-1',
      remoteJid: '5511999990000@s.whatsapp.net',
      fromMe: true,
      status: 'DELIVERY_ACK',
      ...(dataOverrides as Record<string, unknown> | undefined),
    },
  };
}

function event(
  headers: Record<string, string> = {},
  body: Record<string, unknown> | string = payload(),
  httpMethod = 'POST',
) {
  return {
    httpMethod,
    headers,
    queryStringParameters: {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  } as const;
}

function dependencies() {
  const calls: unknown[] = [];
  return {
    calls,
    deliveryModule: {
      applyEvolutionEvent: async (value: unknown) => {
        calls.push(value);
        return null;
      },
    },
    environment: {
      EVOLUTION_WEBHOOK_SECRET: webhookSecret,
      EVOLUTION_INSTANCE: instance,
    },
  };
}

const authorization = { authorization: `Bearer ${webhookSecret}` };

test('webhook rejects missing secret and accepts duplicate known event neutrally', async () => {
  const deps = dependencies();
  assert.equal((await webhook(event({}), deps)).statusCode, 401);

  const first = await webhook(event(authorization), deps);
  const second = await webhook(event(authorization), deps);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(JSON.parse(first.body || '{}'), { received: true });
  assert.deepEqual(JSON.parse(second.body || '{}'), { received: true });
  assert.deepEqual(deps.calls, [
    {
      instance,
      providerMessageId: 'provider-message-1',
      fromMe: true,
      status: 'DELIVERY_ACK',
    },
    {
      instance,
      providerMessageId: 'provider-message-1',
      fromMe: true,
      status: 'DELIVERY_ACK',
    },
  ]);
});

test('webhook validates instance, event, fromMe, keyId, and status before module access', async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['instance', { instance: 'other-instance' }],
    ['event', { event: 'MESSAGES_UPSERT' }],
    ['fromMe', { data: { fromMe: false } }],
    ['keyId', { data: { keyId: '' } }],
    ['status', { data: { status: 'UNKNOWN_STATUS' } }],
  ];

  for (const [, overrides] of cases) {
    const deps = dependencies();
    const result = await webhook(event(authorization, payload(overrides)), deps);
    assert.equal(result.statusCode, 400);
    assert.deepEqual(deps.calls, []);
  }
});

test('webhook rejects oversized and malformed bodies before applying a receipt', async () => {
  const deps = dependencies();
  const oversized = await webhook(
    event(authorization, 'x'.repeat(MAX_EVOLUTION_WEBHOOK_BODY_BYTES + 1)),
    deps,
  );
  assert.equal(oversized.statusCode, 413);
  assert.deepEqual(deps.calls, []);

  const malformed = await webhook(event(authorization, '{'), deps);
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(deps.calls, []);
});

test('webhook fails closed when machine secret is absent or shorter than 32 UTF-8 bytes', async () => {
  const base = { EVOLUTION_INSTANCE: instance };
  const noSecret = await webhook(event(authorization), { deliveryModule: dependencies().deliveryModule, environment: base });
  assert.equal(noSecret.statusCode, 401);

  const shortSecret = await webhook(event({ authorization: 'Bearer ' + 's'.repeat(31) }), {
    deliveryModule: dependencies().deliveryModule,
    environment: { ...base, EVOLUTION_WEBHOOK_SECRET: 's'.repeat(31) },
  });
  assert.equal(shortSecret.statusCode, 401);
});

test('deployed catch-all rejects oversized valid webhook JSON before dispatch', async () => {
  const body = JSON.stringify({ ...payload(), padding: 'x'.repeat(MAX_EVOLUTION_WEBHOOK_BODY_BYTES) });
  assert.ok(Buffer.byteLength(body, 'utf8') > MAX_EVOLUTION_WEBHOOK_BODY_BYTES);

  const response = {
    statusCode: 0,
    value: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      this.value = value;
    },
    send(value: unknown) {
      this.value = value;
    },
  };
  await apiHandler(
    {
      method: 'POST',
      url: '/api/evolution-webhook',
      headers: {
        authorization: `Bearer ${webhookSecret}`,
        'content-length': String(Buffer.byteLength(body, 'utf8')),
      },
      body,
    } as any,
    response as any,
  );

  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.value, { error: 'Corpo da requisição excede o limite permitido.' });
});

test('webhook normalizes the event name while preserving recognized receipt statuses', async () => {
  const deps = dependencies();
  const result = await webhook(
    event(authorization, payload({ event: 'messages_update', data: { status: 'READ' } })),
    deps,
  );
  assert.equal(result.statusCode, 200);
  assert.equal((deps.calls[0] as { status: string }).status, 'READ');
});
