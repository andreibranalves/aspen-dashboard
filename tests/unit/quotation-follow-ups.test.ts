import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQuotationFollowUpModule, ConflictError, InputError } from '../../api/_modules/quotation-follow-ups.js';
import type { QuotationFollowUpRepository } from '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.js';

const row = { quotationId: '00000000-0000-4000-8000-000000000001', revisionId: '00000000-0000-4000-8000-000000000002', deliveryId: '00000000-0000-4000-8000-000000000003', businessNumber: 'ORC-12345678', clientName: 'Cliente', amount: '10.00', instance: 'instance', providerConversationId: '5511999999999@s.whatsapp.net', canonicalPhone: '5511999999999', deliveryCreatedAt: new Date(), firstProviderReceiptAt: new Date(), dueAt: new Date(), eligibilityVersion: 'a'.repeat(64), state: 'ready' as const, followUpId: null, messageSnapshot: null, closedReason: null, approvedAt: null, sentAt: null, updatedAt: new Date() };

function fake(overrides: Partial<QuotationFollowUpRepository> = {}): QuotationFollowUpRepository {
  return {
    list: async () => ({ data: [], total: 0, page: 1, pageSize: 25 }),
    get: async () => null,
    approve: async () => ({ ...row, state: 'approved' as const, followUpId: '00000000-0000-4000-8000-000000000004' }),
    dismiss: async () => ({ ...row, state: 'dismissed' as const, followUpId: '00000000-0000-4000-8000-000000000005' }),
    claimApproved: async () => null,
    markTransportStarted: async () => true,
    completeSent: async () => null,
    completeFailed: async () => null,
    completeNeedsReview: async () => null,
    reapExpiredLeases: async () => 0,
    countApprovalsTodayUtc: async () => 0,
    ...overrides,
  };
}

test('approve is blocked when external follow-up writes are disabled', async () => {
  const module = createQuotationFollowUpModule({ repository: fake(), env: { APP_ENV: 'test', EXTERNAL_WRITES_ENABLED: '1', QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '1' } });
  let blocked: unknown;
  try { await module.approve({ quotationId: row.quotationId, eligibilityVersion: row.eligibilityVersion, message: 'Olá' }); } catch (error) { blocked = error; }
  assert.ok(blocked && typeof blocked === 'object' && 'statusCode' in blocked && blocked.statusCode === 409);
});

test('dismiss remains available with kill switch off and validates reason', async () => {
  let called = false;
  const module = createQuotationFollowUpModule({ repository: fake({ dismiss: async () => { called = true; return { ...row, state: 'dismissed', followUpId: 'x' }; } }), env: {} });
  await module.dismiss({ quotationId: row.quotationId, eligibilityVersion: row.eligibilityVersion, reason: 'do_not_contact' });
  assert.equal(called, true);
  let invalid: unknown;
  try { await module.dismiss({ quotationId: row.quotationId, eligibilityVersion: row.eligibilityVersion, reason: 'not-a-reason' as never }); } catch (error) { invalid = error; }
  assert.ok(invalid && typeof invalid === 'object' && 'statusCode' in invalid && invalid.statusCode === 400);
});

test('module delegates claim and CAS completion methods', async () => {
  let claimed = false;
  const module = createQuotationFollowUpModule({ repository: fake({ claimApproved: async (id) => { claimed = id === row.quotationId; return null; }, markTransportStarted: async (id, token) => id === row.quotationId && token === 'token' }) });
  assert.equal(await module.claimApproved(row.quotationId), null);
  assert.equal(claimed, true);
  assert.equal(await module.markTransportStarted(row.quotationId, 'token'), true);
});
