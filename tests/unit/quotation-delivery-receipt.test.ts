import assert from 'node:assert/strict';
import test from 'node:test';

import { createQuotationDeliveryModule } from '../../api/_modules/quotation-delivery-outbox.js';
import type { DeliveryAggregate, QuotationDeliveryOutboxRepository } from '../../api/_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';

test('receipt hook upserts only delivery receipts and records the real step activity', async () => {
  const followUpReceipts: unknown[] = [];
  const activities: unknown[] = [];
  let receiptCount = 0;
  const module = createQuotationDeliveryModule({
    repository: {
      applyReceipt: async () => {
        receiptCount += 1;
        return {
          id: 'delivery-1',
          revisionId: 'revision-1',
          phone: '5511999990000',
          state: receiptCount === 1 ? 'provider_accepted' : 'delivered',
        } as unknown as DeliveryAggregate;
      },
    } as unknown as QuotationDeliveryOutboxRepository,
    followUpRepository: {
      upsertFromDeliveryReceipt: async (input: unknown) => followUpReceipts.push(input),
    },
    activityRepository: {
      recordActivity: async (input: unknown) => activities.push(input),
    },
    now: () => new Date('2026-08-31T12:00:00.000Z'),
    instance: 'instance-test',
  });

  await module.applyEvolutionEvent({
    instance: 'instance-test',
    providerMessageId: 'step-provider-1',
    fromMe: true,
    status: 'DELIVERY_ACK',
    remoteJid: '5511999990000@s.whatsapp.net',
  });
  await module.applyEvolutionEvent({
    instance: 'instance-test',
    providerMessageId: 'step-provider-2',
    fromMe: true,
    status: 'READ',
    remoteJid: '5511999990000@s.whatsapp.net',
  });

  assert.deepEqual(followUpReceipts, [
    {
      deliveryId: 'delivery-1',
      revisionId: 'revision-1',
      phone: '5511999990000',
      providerConversationId: '5511999990000@s.whatsapp.net',
      allStepsDelivered: false,
      receivedAt: new Date('2026-08-31T12:00:00.000Z'),
    },
    {
      deliveryId: 'delivery-1',
      revisionId: 'revision-1',
      phone: '5511999990000',
      providerConversationId: '5511999990000@s.whatsapp.net',
      allStepsDelivered: true,
      receivedAt: new Date('2026-08-31T12:00:00.000Z'),
    },
  ]);
  assert.deepEqual(activities, [
    {
      instance: 'instance-test',
      providerConversationId: '5511999990000@s.whatsapp.net',
      providerMessageId: 'step-provider-1',
      fromMe: true,
      occurredAt: new Date('2026-08-31T12:00:00.000Z'),
      identityStatus: 'derived',
      canonicalPhone: '5511999990000',
    },
    {
      instance: 'instance-test',
      providerConversationId: '5511999990000@s.whatsapp.net',
      providerMessageId: 'step-provider-2',
      fromMe: true,
      occurredAt: new Date('2026-08-31T12:00:00.000Z'),
      identityStatus: 'derived',
      canonicalPhone: '5511999990000',
    },
  ]);
});

test('receipt activity for a LID never promotes the LID to a canonical phone', async () => {
  const activities: unknown[] = [];
  const module = createQuotationDeliveryModule({
    repository: {
      applyReceipt: async () => ({
        id: 'delivery-1',
        revisionId: 'revision-1',
        phone: '5511999990000',
        state: 'delivered',
      } as unknown as DeliveryAggregate),
    } as unknown as QuotationDeliveryOutboxRepository,
    followUpRepository: {
      upsertFromDeliveryReceipt: async () => {},
    },
    activityRepository: {
      recordActivity: async (input: unknown) => activities.push(input),
    },
    now: () => new Date('2026-08-31T12:00:00.000Z'),
    instance: 'instance-test',
  });

  await module.applyEvolutionEvent({
    instance: 'instance-test',
    providerMessageId: 'step-provider-1',
    fromMe: true,
    status: 'READ',
    remoteJid: 'abc123@lid',
  });

  assert.deepEqual(activities[0], {
    instance: 'instance-test',
    providerConversationId: 'abc123@lid',
    providerMessageId: 'step-provider-1',
    fromMe: true,
    occurredAt: new Date('2026-08-31T12:00:00.000Z'),
    identityStatus: 'unresolved',
    canonicalPhone: null,
  });
});

test('group receipt updates delivery state without writing a follow-up candidate or activity', async () => {
  const followUpReceipts: unknown[] = [];
  const activities: unknown[] = [];
  const module = createQuotationDeliveryModule({
    repository: {
      applyReceipt: async () => ({
        id: 'delivery-1',
        revisionId: 'revision-1',
        phone: '5511999990000',
        state: 'delivered',
      } as unknown as DeliveryAggregate),
    } as unknown as QuotationDeliveryOutboxRepository,
    followUpRepository: {
      upsertFromDeliveryReceipt: async (input: unknown) => followUpReceipts.push(input),
    },
    activityRepository: {
      recordActivity: async (input: unknown) => activities.push(input),
    },
    now: () => new Date('2026-08-31T12:00:00.000Z'),
    instance: 'instance-test',
  });

  const aggregate = await module.applyEvolutionEvent({
    instance: 'instance-test',
    providerMessageId: 'step-provider-1',
    fromMe: true,
    status: 'DELIVERY_ACK',
    remoteJid: '120363@g.us',
  });

  assert.equal(aggregate?.state, 'delivered');
  assert.deepEqual(followUpReceipts, []);
  assert.deepEqual(activities, []);
});
