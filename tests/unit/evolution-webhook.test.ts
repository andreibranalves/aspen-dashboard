import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import apiHandler from '../../api/[...path].js';
import {
  handler as webhook,
  MAX_EVOLUTION_WEBHOOK_BODY_BYTES,
} from '../../api/_modules/evolution-webhook.js';

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

function upsertPayload(data: unknown): Record<string, unknown> {
  return { event: 'MESSAGES_UPSERT', instance, data };
}

function upsertItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: {
      id: 'inbound-message-1',
      remoteJid: '5511999990000@s.whatsapp.net',
      fromMe: false,
    },
    messageTimestamp: 1_700_000_000,
    message: { conversation: 'não deve ser persistida' },
    ...overrides,
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
  const activityCalls: unknown[] = [];
  const followUpCalls: unknown[] = [];
  const operationOrder: string[] = [];
  const healthCalls: unknown[] = [];
  return {
    calls,
    activityCalls,
    followUpCalls,
    operationOrder,
    healthCalls,
    deliveryModule: {
      applyEvolutionEvent: async (value: unknown) => {
        calls.push(value);
        return { id: 'delivery-receipt-test' };
      },
    },
    activityRepository: {
      recordActivity: async (value: unknown) => {
        operationOrder.push('activity');
        activityCalls.push(value);
      },
      getHealth: async () => null,
      blockIngestion: async (value: unknown) => {
        healthCalls.push(['block', value]);
      },
      unblockIngestionIfEvent: async (value: unknown) => {
        healthCalls.push(['unblock', value]);
        return false;
      },
      markIngestion: async (value: unknown) => {
        healthCalls.push(['mark', value]);
      },
    },
    followUpRepository: {
      applyConversationToOpenFollowUps: async (value: unknown) => {
        operationOrder.push('follow-up');
        followUpCalls.push(value);
      },
    },
    environment: {
      EVOLUTION_WEBHOOK_SECRET: webhookSecret,
      EVOLUTION_INSTANCE: instance,
    },
  };
}

const authorization = { authorization: `Bearer ${webhookSecret}` };

function responseFixture() {
  return {
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
}

test('webhook projects UPSERT activity after recording it', async () => {
  const deps = dependencies();
  const result = await webhook(event(authorization, upsertPayload(upsertItem())), deps);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(deps.operationOrder, ['activity', 'follow-up']);
  assert.deepEqual(deps.followUpCalls, [
    {
      instance,
      providerConversationId: '5511999990000@s.whatsapp.net',
      providerMessageId: 'inbound-message-1',
      fromMe: false,
      occurredAt: new Date('2023-11-14T22:13:20.000Z'),
      identityStatus: 'derived',
      canonicalPhone: '5511999990000',
    },
  ]);
});
test('webhook forwards an unresolved LID without deriving a phone', async () => {
  const deps = dependencies();
  const result = await webhook(
    event(
      authorization,
      upsertPayload(
        upsertItem({
          key: {
            id: 'lid-message-1',
            remoteJid: '183792384719283741@lid',
            fromMe: false,
          },
        }),
      ),
    ),
    deps,
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(deps.followUpCalls, [
    {
      instance,
      providerConversationId: '183792384719283741@lid',
      providerMessageId: 'lid-message-1',
      fromMe: false,
      occurredAt: new Date('2023-11-14T22:13:20.000Z'),
      identityStatus: 'unresolved',
      canonicalPhone: null,
    },
  ]);
});


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
      remoteJid: '5511999990000@s.whatsapp.net',
    },
    {
      instance,
      providerMessageId: 'provider-message-1',
      fromMe: true,
      status: 'DELIVERY_ACK',
      remoteJid: '5511999990000@s.whatsapp.net',
    },
  ]);
});

test('webhook acknowledges a receipt whose step is not correlated yet', async () => {
  // The durable inbox already stored the receipt, so a 200 is safe even though
  // the response carries no aggregate: it will be folded when the provider id
  // is persisted by `markAccepted`, without any provider replay.
  const deps = dependencies();
  deps.deliveryModule.applyEvolutionEvent = async (value: unknown) => {
    deps.calls.push(value);
    return null;
  };
  const result = await webhook(event(authorization), deps);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '{}'), { received: true });
  assert.equal((deps.calls as unknown[]).length, 1);
  assert.doesNotMatch(String(result.body), /provider-message-1/);
});

test('webhook fails closed when the durable receipt store rejects the receipt', async () => {
  const deps = dependencies();
  deps.deliveryModule.applyEvolutionEvent = async () => {
    throw new Error('database unavailable');
  };
  const result = await webhook(event(authorization), deps);
  assert.equal(result.statusCode, 503);
  assert.doesNotMatch(String(result.body), /provider-message-1/);
  assert.doesNotMatch(String(result.body), /database unavailable/);
});

test('webhook validates instance, event, fromMe, keyId, and status before module access', async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['instance', { instance: 'other-instance' }],
    ['event', { event: 'SOMETHING_ELSE' }],
    ['fromMe', { data: { fromMe: false } }],
    ['keyId', { data: { keyId: '' } }],
    ['status', { data: { status: 'UNKNOWN_STATUS' } }],
  ];

  for (const [, overrides] of cases) {
    const deps = dependencies();
    const result = await webhook(event(authorization, payload(overrides)), deps);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body || '{}'), { received: true, ignored: true });
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

  const response = responseFixture();
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

test('deployed catch-all rejects an unbounded readable webhook without content length', async () => {
  const body = JSON.stringify({ ...payload(), padding: 'x'.repeat(MAX_EVOLUTION_WEBHOOK_BODY_BYTES) });
  const request = Readable.from([body]);
  Object.assign(request, {
    method: 'POST',
    url: '/api/evolution-webhook',
    headers: { authorization: `Bearer ${webhookSecret}` },
  });
  const response = responseFixture();

  await apiHandler(request as any, response as any);

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

test('webhook records every supported message kind without persisting content', async () => {
  const deps = dependencies();
  const types = ['conversation', 'audioMessage', 'imageMessage', 'documentMessage', 'reactionMessage'];
  const items = types.map((type, index) =>
    upsertItem({
      key: {
        id: `message-${index}`,
        remoteJid: '5511999990000@s.whatsapp.net',
        fromMe: false,
      },
      message: { [type]: { caption: 'sensitive content', mimetype: 'text/plain' } },
    }),
  );

  const result = await webhook(event(authorization, upsertPayload(items)), deps);
  assert.equal(result.statusCode, 200);
  assert.equal(deps.activityCalls.length, types.length);
  assert.equal((deps.activityCalls[0] as Record<string, unknown>).providerMessageId, 'message-0');
  assert.equal((deps.activityCalls[0] as Record<string, unknown>).canonicalPhone, '5511999990000');
  assert.equal('message' in (deps.activityCalls[0] as Record<string, unknown>), false);
  assert.equal(
    deps.healthCalls.filter(([kind]) => kind === 'mark').length,
    1,
  );
});

test('webhook accepts flat and nested UPSERT keys and fromMe fields', async () => {
  const deps = dependencies();
  const result = await webhook(
    event(
      authorization,
      upsertPayload([
        {
          keyId: 'flat-id',
          remoteJid: '5511888887777@s.whatsapp.net',
          fromMe: true,
          messageTimestamp: '2026-01-02T03:04:05.000Z',
          message: { conversation: 'outbound' },
        },
        upsertItem({
          key: { id: 'nested-id', remoteJid: 'abc123@lid', fromMe: false },
          messageTimestamp: 1_700_000_001_000,
        }),
      ]),
    ),
    deps,
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    deps.activityCalls.map((value) => {
      const item = value as Record<string, unknown>;
      return [item.providerMessageId, item.providerConversationId, item.fromMe, item.identityStatus];
    }),
    [
      ['flat-id', '5511888887777@s.whatsapp.net', true, 'derived'],
      ['nested-id', 'abc123@lid', false, 'unresolved'],
    ],
  );
});

test('webhook blocks an unparseable recognized UPSERT and unblocks only its exact retry', async () => {
  const deps = dependencies();
  const malformed = await webhook(
    event(
      authorization,
      upsertPayload([
        upsertItem(),
        { key: { id: 'retry-id', remoteJid: '5511999990000@s.whatsapp.net' } },
      ]),
    ),
    deps,
  );
  assert.equal(malformed.statusCode, 503);
  assert.deepEqual(deps.activityCalls, []);
  assert.equal(deps.healthCalls[0]?.[0], 'block');
  assert.equal(
    (deps.healthCalls[0]?.[1] as Record<string, unknown>).eventKey,
    `${instance}:upsert:1:retry-id`,
  );

  const retry = await webhook(
    event(
      authorization,
      upsertPayload([
        upsertItem(),
        {
          key: {
            id: 'retry-id',
            remoteJid: '5511999990000@s.whatsapp.net',
            fromMe: false,
          },
          message: { conversation: 'now parseable' },
        },
      ]),
    ),
    deps,
  );
  assert.equal(retry.statusCode, 200);
  assert.equal(
    deps.healthCalls.some(
      ([kind, value]) =>
        kind === 'unblock' &&
        (value as Record<string, unknown>).eventKey === `${instance}:upsert:1:retry-id`,
    ),
    true,
  );
});

test('webhook ignores groups and MESSAGES_SET', async () => {
  const deps = dependencies();
  const group = await webhook(
    event(
      authorization,
      upsertPayload({
        key: { id: 'group-id', remoteJid: '12345@g.us', fromMe: false },
        message: { conversation: 'group' },
      }),
    ),
    deps,
  );
  const set = await webhook(
    event(authorization, { event: 'MESSAGES_SET', instance, data: [] }),
    deps,
  );
  assert.equal(group.statusCode, 200);
  assert.equal(set.statusCode, 200);
  assert.deepEqual(deps.activityCalls, []);
});
