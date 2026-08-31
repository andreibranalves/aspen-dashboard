import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FOLLOW_UP_IMMEDIATE_PUBLISH_DAILY_CAP,
  FOLLOW_UP_LEASE_MS,
  FOLLOW_UP_WAIT_MS,
  buildDefaultFollowUpMessage,
  canTransitionFollowUp,
  evaluateFollowUp,
  followUpDueAt,
  followUpListView,
  isDismissReason,
  isFollowUpReady,
  normalizeWhatsappOutboundText,
  followUpExternalWritesEnabled,
  parseFollowUpTrackingStartedAt,
  recoverExpiredFollowUpLease,
  shouldPublishFollowUpImmediately,
  type FollowUpCandidateFacts,
} from '../../api/_modules/quotation-follow-up-state.js';

const trackingStartedAt = new Date('2026-08-31T00:00:00.000Z');
const receiptAt = new Date('2026-08-31T12:00:00.000Z');

function facts(overrides: Partial<FollowUpCandidateFacts> = {}): FollowUpCandidateFacts {
  return {
    now: new Date(receiptAt.getTime() + FOLLOW_UP_WAIT_MS),
    trackingStartedAt,
    persistedState: null,
    latestDelivery: {
      id: 'delivery-1',
      state: 'delivered',
      completionSource: 'provider_receipt',
      createdAt: new Date('2026-08-31T11:00:00.000Z'),
      firstProviderReceiptAt: receiptAt,
    },
    quotationStatus: 'emitido',
    crmStatus: 'Orcamento Enviado',
    clientArchived: false,
    identityResolved: true,
    contactBlocked: false,
    ingestionBlocked: false,
    unresolvedIdentityBarrier: false,
    inboundAfterAnchor: false,
    outboundAfterAnchor: false,
    ...overrides,
  };
}

test('due date is exactly 24 hours and becomes ready at the boundary', () => {
  const dueAt = followUpDueAt(receiptAt);
  assert.equal(dueAt.toISOString(), '2026-09-01T12:00:00.000Z');
  assert.equal(isFollowUpReady(receiptAt, new Date(dueAt.getTime() - 1)), false);
  assert.equal(isFollowUpReady(receiptAt, dueAt), true);

  const waiting = evaluateFollowUp(facts({ now: new Date(dueAt.getTime() - 1) }));
  assert.equal(waiting.kind, 'waiting');
  if (waiting.kind === 'waiting') assert.equal(waiting.dueAt.toISOString(), dueAt.toISOString());

  const ready = evaluateFollowUp(facts({ now: dueAt }));
  assert.equal(ready.kind, 'ready');
});

test('each cancellation reason hides an unapproved candidate', () => {
  const cases: Array<[Partial<FollowUpCandidateFacts>, string]> = [
    [{ latestDelivery: null }, 'before_tracking_start'],
    [{
      latestDelivery: {
        id: 'delivery-old',
        state: 'delivered',
        completionSource: 'provider_receipt',
        createdAt: new Date('2026-08-30T00:00:00.000Z'),
        firstProviderReceiptAt: receiptAt,
      },
    }, 'before_tracking_start'],
    [{
      latestDelivery: {
        id: 'delivery-fly',
        state: 'processing',
        completionSource: null,
        createdAt: new Date('2026-08-31T13:00:00.000Z'),
        firstProviderReceiptAt: null,
      },
    }, 'newer_delivery_in_flight'],
    [{
      latestDelivery: {
        id: 'delivery-op',
        state: 'delivered',
        completionSource: 'operator',
        createdAt: new Date('2026-08-31T11:00:00.000Z'),
        firstProviderReceiptAt: receiptAt,
      },
    }, 'delivery_incomplete'],
    [{
      latestDelivery: {
        id: 'delivery-none',
        state: 'delivered',
        completionSource: 'provider_receipt',
        createdAt: new Date('2026-08-31T11:00:00.000Z'),
        firstProviderReceiptAt: null,
      },
    }, 'missing_provider_receipt'],
    [{ quotationStatus: 'aprovado' }, 'quotation_not_issued'],
    [{ crmStatus: 'Em Negociacao' }, 'crm_not_eligible'],
    [{ clientArchived: true }, 'client_archived'],
    [{ identityResolved: false }, 'identity_unresolved'],
    [{ contactBlocked: true }, 'contact_blocked'],
    [{ inboundAfterAnchor: true }, 'inbound_after_anchor'],
    [{ outboundAfterAnchor: true }, 'outbound_after_anchor'],
  ];

  for (const [override, reason] of cases) {
    const result = evaluateFollowUp(facts(override));
    assert.deepEqual(result, { kind: 'absent', reason });
  }
});

test('approved attempts cancel on definitive changes and hold on temporary barriers', () => {
  const inbound = evaluateFollowUp(facts({ persistedState: 'approved', inboundAfterAnchor: true }));
  assert.deepEqual(inbound, { kind: 'cancel', reason: 'inbound_after_anchor' });

  const crm = evaluateFollowUp(facts({ persistedState: 'processing', crmStatus: 'Pedido Fechado' }));
  assert.deepEqual(crm, { kind: 'cancel', reason: 'crm_not_eligible' });

  const health = evaluateFollowUp(facts({ persistedState: 'approved', ingestionBlocked: true }));
  assert.deepEqual(health, { kind: 'hold', reason: 'ingestion_blocked' });

  const lid = evaluateFollowUp(facts({ persistedState: 'approved', unresolvedIdentityBarrier: true }));
  assert.deepEqual(lid, { kind: 'hold', reason: 'unresolved_identity_barrier' });

  const still = evaluateFollowUp(facts({ persistedState: 'approved' }));
  assert.equal(still.kind, 'eligible_to_send');
});

test('unapproved temporary barriers hide the candidate instead of cancelling', () => {
  assert.deepEqual(evaluateFollowUp(facts({ ingestionBlocked: true })), {
    kind: 'absent',
    reason: 'ingestion_blocked',
  });
  assert.deepEqual(evaluateFollowUp(facts({ unresolvedIdentityBarrier: true })), {
    kind: 'absent',
    reason: 'unresolved_identity_barrier',
  });
});

test('terminal attempts stay terminal and cannot return to sendable states', () => {
  assert.deepEqual(evaluateFollowUp(facts({ persistedState: 'sent' })), {
    kind: 'absent',
    reason: 'already_attempted',
  });
  assert.equal(canTransitionFollowUp('approved', 'processing'), true);
  assert.equal(canTransitionFollowUp('processing', 'sent'), true);
  assert.equal(canTransitionFollowUp('processing', 'approved'), true);
  assert.equal(canTransitionFollowUp('processing', 'needs_review'), true);
  assert.equal(canTransitionFollowUp('sent', 'approved'), false);
  assert.equal(canTransitionFollowUp('failed', 'processing'), false);
  assert.equal(canTransitionFollowUp('needs_review', 'approved'), false);
  assert.equal(canTransitionFollowUp('dismissed', 'approved'), false);
  assert.equal(followUpListView('ready'), 'ready');
  assert.equal(followUpListView('approved'), 'attention');
  assert.equal(followUpListView('needs_review'), 'attention');
  assert.equal(isDismissReason('do_not_contact'), true);
  assert.equal(isDismissReason('spam'), false);
});

test('expired lease without transport returns to approved after 90s; started transport becomes needs_review', () => {
  const claimedAt = new Date('2026-08-31T12:00:00.000Z');
  const leaseUntil = new Date(claimedAt.getTime() + FOLLOW_UP_LEASE_MS);
  assert.equal(
    recoverExpiredFollowUpLease({
      state: 'processing',
      transportStartedAt: null,
      leaseUntil,
      now: new Date(leaseUntil.getTime() - 1),
    }),
    null,
  );
  assert.equal(
    recoverExpiredFollowUpLease({
      state: 'processing',
      transportStartedAt: null,
      leaseUntil,
      now: leaseUntil,
    }),
    'approved',
  );
  assert.equal(
    recoverExpiredFollowUpLease({
      state: 'processing',
      transportStartedAt: claimedAt,
      leaseUntil,
      now: leaseUntil,
    }),
    'needs_review',
  );
});

test('whatsapp text allows newline and tab, rejects other controls and empty/oversized snapshots', () => {
  assert.equal(normalizeWhatsappOutboundText('  Olá\nCliente\t1  '), 'Olá\nCliente\t1');
  assert.equal(normalizeWhatsappOutboundText('Olá\rCliente'), null);
  assert.equal(normalizeWhatsappOutboundText('Olá\u0001Cliente'), null);
  assert.equal(normalizeWhatsappOutboundText('   '), null);
  assert.equal(normalizeWhatsappOutboundText('x'.repeat(4_001)), null);
  assert.equal(normalizeWhatsappOutboundText('x'.repeat(4_000))?.length, 4_000);
});

test('default message includes client and quotation without tutorial copy', () => {
  const message = buildDefaultFollowUpMessage({
    clientName: ' Maria ',
    businessNumber: 'ORC-20260001',
  });
  assert.match(message, /Maria/);
  assert.match(message, /ORC-20260001/);
  assert.equal(normalizeWhatsappOutboundText(message), message);
  assert.equal(
    buildDefaultFollowUpMessage({ clientName: '  ', businessNumber: 'ORC-20260002' }).startsWith('Olá.'),
    true,
  );
});

test('immediate QStash publish stops after the daily cap', () => {
  assert.equal(shouldPublishFollowUpImmediately(0), true);
  assert.equal(shouldPublishFollowUpImmediately(FOLLOW_UP_IMMEDIATE_PUBLISH_DAILY_CAP - 1), true);
  assert.equal(shouldPublishFollowUpImmediately(FOLLOW_UP_IMMEDIATE_PUBLISH_DAILY_CAP), false);
});

test('follow-up external writes require production and both kill switches', () => {
  assert.equal(followUpExternalWritesEnabled({}), false);
  assert.equal(
    followUpExternalWritesEnabled({
      QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '1',
      APP_ENV: 'production',
      EXTERNAL_WRITES_ENABLED: '0',
    }),
    false,
  );
  assert.equal(
    followUpExternalWritesEnabled({
      QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '1',
      APP_ENV: 'preview',
      EXTERNAL_WRITES_ENABLED: '1',
    }),
    false,
  );
  assert.equal(
    followUpExternalWritesEnabled({
      QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '1',
      APP_ENV: 'production',
      EXTERNAL_WRITES_ENABLED: '1',
    }),
    true,
  );
  assert.equal(parseFollowUpTrackingStartedAt(undefined), null);
  assert.equal(parseFollowUpTrackingStartedAt('nope'), null);
  assert.equal(
    parseFollowUpTrackingStartedAt('2026-08-31T00:00:00.000Z')?.toISOString(),
    '2026-08-31T00:00:00.000Z',
  );
});
