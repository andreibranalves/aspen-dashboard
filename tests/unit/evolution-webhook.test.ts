import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import apiHandler from '../../api/[...path].js';
import {
  handler as webhook,
  MAX_EVOLUTION_WEBHOOK_BODY_BYTES,
} from '../../api/_modules/evolution-webhook.js';
import type { IngestWhatsappConversationInput } from '../../api/_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import type {
  WebhookEffect,
  WebhookEffectInput,
  WebhookEffectRecord,
} from '../../api/_infrastructure/db/repositories/whatsapp-webhook-effects-repository.js';

function memoryEffects() {
  const rows = new Map<string, WebhookEffectRecord>();
  const failures: Array<[string, WebhookEffect]> = [];
  return {
    rows,
    failures,
    register: async (inputs: WebhookEffectInput[]) =>
      inputs.map((input) => {
        const key = `${input.providerConversationId}|${input.providerMessageId}`;
        const existing = rows.get(key);
        if (existing) return { ...existing };
        const record: WebhookEffectRecord = { ...input, id: key, activityDone: false, followUpDone: false, attempts: 0 };
        rows.set(key, record);
        return { ...record };
      }),
    markDone: async (id: string, effect: WebhookEffect) => {
      const row = rows.get(id)!;
      if (effect === 'activity') row.activityDone = true;
      else row.followUpDone = true;
    },
    markFailed: async (id: string, effect: WebhookEffect) => {
      rows.get(id)!.attempts += 1;
      failures.push([id, effect]);
    },
  };
}

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
    message: { conversation: 'Olá' },
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
  const historyCalls: IngestWhatsappConversationInput[] = [];
  const receiptCalls: string[] = [];
  return {
    historyCalls,
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
    effectsRepository: memoryEffects(),
    receiptCalls,
    outboxRepository: {
      applyReceipts: async (providerMessageId: string) => {
        operationOrder.push('receipt-projection');
        receiptCalls.push(providerMessageId);
        return 1;
      },
    },
    attendanceRepository: {
      ingestConversation: async (value: IngestWhatsappConversationInput) => {
        operationOrder.push('history');
        historyCalls.push(value);
        return { conversationId: 'conversation-test', inserted: value.messages.length, duplicates: 0 };
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
  assert.deepEqual(deps.operationOrder, ['history', 'activity', 'follow-up']);
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

test('webhook stores the message body verbatim as live history before other effects', async () => {
  const deps = dependencies();
  const body = 'Olá!\n\nPreciso de 200 canecas\n  - azul';
  const result = await webhook(
    event(authorization, upsertPayload(upsertItem({ pushName: 'Maria  Souza', message: { conversation: body } }))),
    deps,
  );

  assert.equal(result.statusCode, 200);
  assert.equal(deps.historyCalls.length, 1);
  const [call] = deps.historyCalls;
  assert.equal(call.origin, 'live');
  assert.equal(call.providerConversationId, '5511999990000@s.whatsapp.net');
  assert.equal(call.contactName, 'Maria Souza');
  assert.deepEqual(
    call.messages.map(({ providerMessageId, direction, messageType, body: text }) => ({
      providerMessageId,
      direction,
      messageType,
      body: text,
    })),
    [{ providerMessageId: 'inbound-message-1', direction: 'inbound', messageType: 'text', body }],
  );
  assert.equal(call.resolveIdentity(null).canonicalPhone, '5511999990000');
});

test('webhook stores an outgoing message from another device without a contact name', async () => {
  const deps = dependencies();
  await webhook(
    event(
      authorization,
      upsertPayload(
        upsertItem({
          key: { id: 'outbound-1', remoteJid: '5511999990000@s.whatsapp.net', fromMe: true },
          pushName: 'Operador',
          message: { extendedTextMessage: { text: 'Bom dia' } },
        }),
      ),
    ),
    deps,
  );

  const [call] = deps.historyCalls;
  assert.equal(call.contactName, null);
  assert.equal(call.messages[0].direction, 'outbound');
  assert.equal(call.origin, 'live');
});

test('webhook keeps protocol events out of the history but still records activity', async () => {
  const deps = dependencies();
  const result = await webhook(
    event(authorization, upsertPayload(upsertItem({ message: { reactionMessage: { text: '👍' } } }))),
    deps,
  );

  assert.equal(result.statusCode, 200);
  assert.equal(deps.historyCalls.length, 0);
  assert.equal(deps.activityCalls.length, 1);
});

test('webhook runs existing effects but withholds the acknowledgement when history fails', async () => {
  const deps = dependencies();
  deps.attendanceRepository.ingestConversation = async () => {
    throw new Error('database unavailable');
  };
  const result = await webhook(event(authorization, upsertPayload(upsertItem())), deps);

  assert.equal(result.statusCode, 503);
  assert.equal(deps.activityCalls.length, 1);
  assert.equal(deps.followUpCalls.length, 1);
});

test('webhook keeps a failed follow-up pending and resumes it without repeating the activity', async () => {
  const deps = dependencies();
  let failFollowUp = true;
  deps.followUpRepository.applyConversationToOpenFollowUps = async (value: unknown) => {
    if (failFollowUp) throw new Error('follow-up unavailable');
    deps.followUpCalls.push(value);
  };

  const first = await webhook(event(authorization, upsertPayload(upsertItem())), deps);
  assert.equal(first.statusCode, 503);
  assert.equal(deps.activityCalls.length, 1);
  assert.deepEqual(deps.effectsRepository.failures, [['5511999990000@s.whatsapp.net|inbound-message-1', 'follow_up']]);
  assert.equal(deps.healthCalls.filter(([kind]) => kind === 'mark').length, 0, 'no ingestion watermark on failure');

  failFollowUp = false;
  const retry = await webhook(event(authorization, upsertPayload(upsertItem())), deps);
  assert.equal(retry.statusCode, 200);
  assert.equal(deps.activityCalls.length, 1, 'the finished activity is not repeated');
  assert.equal(deps.followUpCalls.length, 1);
  const [row] = deps.effectsRepository.rows.values();
  assert.equal(row.activityDone && row.followUpDone, true);
});

test('webhook stops at the first failed effect and leaves later events pending in order', async () => {
  const deps = dependencies();
  deps.activityRepository.recordActivity = async (value: unknown) => {
    if ((value as { providerMessageId: string }).providerMessageId === 'first') throw new Error('activity down');
    deps.activityCalls.push(value);
  };
  const result = await webhook(
    event(
      authorization,
      upsertPayload([
        upsertItem({ key: { id: 'first', remoteJid: '5511999990000@s.whatsapp.net', fromMe: false } }),
        upsertItem({ key: { id: 'second', remoteJid: '5511999990000@s.whatsapp.net', fromMe: false } }),
      ]),
    ),
    deps,
  );
  assert.equal(result.statusCode, 503);
  assert.equal(deps.activityCalls.length, 0);
  assert.equal(deps.followUpCalls.length, 0);
  assert.equal([...deps.effectsRepository.rows.values()].every((row) => !row.activityDone), true);
});

test('webhook still applies effects directly when they cannot be registered, but withholds the acknowledgement', async () => {
  const deps = dependencies();
  deps.effectsRepository.register = async () => {
    throw new Error('database unavailable');
  };
  const result = await webhook(event(authorization, upsertPayload(upsertItem())), deps);
  assert.equal(result.statusCode, 503);
  assert.equal(deps.activityCalls.length, 1);
  assert.equal(deps.followUpCalls.length, 1);
});

test('webhook history resolves a LID chat phone from remoteJidAlt while follow-ups keep the unresolved LID', async () => {
  const deps = dependencies();
  await webhook(
    event(
      authorization,
      upsertPayload(
        upsertItem({
          key: {
            id: 'lid-1',
            remoteJid: '183792384719283741@lid',
            remoteJidAlt: '5511999990000@s.whatsapp.net',
            fromMe: false,
          },
        }),
      ),
    ),
    deps,
  );
  assert.equal(deps.historyCalls[0].resolveIdentity(null).canonicalPhone, '5511999990000');
  assert.equal((deps.followUpCalls[0] as { identityStatus: string }).identityStatus, 'unresolved');
});

test('webhook folds a stored receipt into the attendance message after the durable inbox', async () => {
  const deps = dependencies();
  const originalApply = deps.deliveryModule.applyEvolutionEvent;
  deps.deliveryModule.applyEvolutionEvent = async (value: unknown) => {
    deps.operationOrder.push('inbox');
    return originalApply(value);
  };
  const result = await webhook(event(authorization), deps);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(deps.receiptCalls, ['provider-message-1']);
  assert.deepEqual(deps.operationOrder, ['inbox', 'receipt-projection']);
});

test('a failed receipt projection never withholds the receipt acknowledgement', async () => {
  const deps = dependencies();
  deps.outboxRepository.applyReceipts = async () => {
    throw new Error('database unavailable');
  };
  const result = await webhook(event(authorization), deps);
  assert.equal(result.statusCode, 200);
  assert.equal(deps.calls.length, 1);
});
