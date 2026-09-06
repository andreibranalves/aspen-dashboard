import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOfflinePayload,
  GOOGLE_DATA_MANAGER_SCOPE,
  selectOfflineOrder,
  validateOfflinePreflight,
  type OfflineOrderEvidence,
} from '../../api/_modules/ads-offline-core.js';
import { createAdsOfflineService } from '../../api/_modules/ads-offline.js';
import type { OfflineExportRepository } from '../../api/_infrastructure/db/repositories/sales-order-offline-export-repository.js';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const QUOTATION_ID = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-01T12:00:00.000Z');
const DESTINATION = {
  operatingAccountId: '1234567890',
  productDestinationId: '9876543210',
  productDestinationType: 'UPLOAD_CLICKS' as const,
};

function evidence(overrides: Partial<OfflineOrderEvidence> = {}): OfflineOrderEvidence {
  return {
    salesOrderId: ORDER_ID,
    orderNumber: 'PED-2026-0001',
    status: 'To Deliver and Bill',
    quotationId: QUOTATION_ID,
    quotationRevisionId: REVISION_ID,
    quoteLeadId: LEAD_ID,
    originStatus: 'linked',
    originSource: 'site_form',
    revisionQuotationId: QUOTATION_ID,
    quotationStatus: 'aprovado',
    revisionStatus: 'aprovado',
    total: '123.40',
    createdAt: NOW,
    attribution: { gclid: 'opaque-gclid-preserved' },
    raw: {
      siteSubmission: {
        payloadFingerprint: 'a'.repeat(64),
        originalCreatedAt: '2026-08-31T12:00:00.000Z',
        primaryAdIdentifier: 'gclid',
        consent: {
          adUserData: 'CONSENT_GRANTED',
          adPersonalization: 'CONSENT_GRANTED',
          policyVersion: 'ads-policy-v1',
          reviewedAt: '2026-08-31T12:00:00.000Z',
          source: 'site_quote_form',
          evidenceId: 'synthetic-consent-1',
        },
      },
    },
    lineageVerified: true,
    ...overrides,
  };
}

test('offline selection accepts every approved order status only with reviewed UUID and lineage', () => {
  for (const status of ['To Deliver and Bill', 'To Deliver', 'To Bill', 'Completed']) {
    const selected = selectOfflineOrder(evidence({ status }), {
      approvedOrderIds: new Set([ORDER_ID]),
    });
    assert.equal(selected.status, 'eligible');
  }
  assert.equal(selectOfflineOrder(evidence({ status: 'Draft' })).category, 'draft');
  assert.equal(selectOfflineOrder(evidence({ status: 'Cancelled' })).category, 'cancelled');
  const closed = selectOfflineOrder(evidence({ status: 'Closed' }), {
    approvedOrderIds: new Set([ORDER_ID]),
  });
  assert.equal(closed.status, 'needs_review');
  assert.ok(closed.reasons.includes('closed_status'));
  const unreviewed = selectOfflineOrder(evidence());
  assert.ok(unreviewed.reasons.includes('reviewed_uuid_required'));
  assert.equal(unreviewed.status, 'needs_review');
  assert.equal(
    selectOfflineOrder(evidence({ lineageVerified: false }), { approvedOrderIds: new Set([ORDER_ID]) }).status,
    'excluded'
  );
});

test('offline selection never maps generic consent and blocks unproven history', () => {
  const generic = evidence({
    raw: {
      siteSubmission: {
        payloadFingerprint: 'a'.repeat(64),
        originalCreatedAt: '2026-08-31T12:00:00.000Z',
        primaryAdIdentifier: 'gclid',
        consent: { given: true, source: 'site_quote_form' },
      },
    },
  });
  const selected = selectOfflineOrder(generic, { approvedOrderIds: new Set([ORDER_ID]) });
  assert.equal(selected.status, 'needs_review');
  assert.equal(selected.reviewReason, 'consent_review_required');
  assert.equal(selected.consentEvidence, null);
  const historic = selectOfflineOrder(evidence({ raw: null }), {
    approvedOrderIds: new Set([ORDER_ID]),
  });
  assert.equal(historic.status, 'excluded');
  assert.ok(historic.reasons.includes('unverified_submission_history'));
});

test('offline selection preserves opaque identifiers and deterministic money/timestamp payload', () => {
  const selected = selectOfflineOrder(
    evidence({
      raw: {
        siteSubmission: {
          payloadFingerprint: 'a'.repeat(64),
          originalCreatedAt: '2026-08-31T12:00:00.000Z',
          primaryAdIdentifier: 'wbraid',
          consent: {
            adUserData: 'CONSENT_GRANTED',
            adPersonalization: 'CONSENT_GRANTED',
            policyVersion: 'ads-policy-v1',
            reviewedAt: '2026-08-31T12:00:00.000Z',
            source: 'site_quote_form',
          },
        },
      },
      attribution: { gclid: 'wrong-priority', wbraid: 'opaque-wbraid-exact' },
    }),
    { approvedOrderIds: new Set([ORDER_ID]) }
  );
  assert.equal(selected.status, 'eligible');
  assert.equal(selected.adIdentifierType, 'wbraid');
  assert.equal(selected.adIdentifier, 'opaque-wbraid-exact');
  const snapshot = buildOfflinePayload(
    {
      salesOrderId: ORDER_ID,
      quoteLeadId: LEAD_ID,
      originSource: 'site_form',
      eventTimestamp: selected.eventTimestamp!,
      conversionValue: selected.conversionValue!,
      adIdentifierType: selected.adIdentifierType!,
      adIdentifier: selected.adIdentifier!,
      consentEvidence: selected.consentEvidence!,
    },
    DESTINATION
  );
  assert.equal(snapshot.payload.events[0].transactionId, `aspen-pedido-iniciado:${ORDER_ID}`);
  assert.equal(snapshot.payload.events[0].eventTimestamp, NOW.toISOString());
  assert.equal(snapshot.payload.events[0].conversionValue, 123.4);
  assert.equal(snapshot.payload.events[0].currency, 'BRL');
  assert.equal(snapshot.payload.events[0].eventSource, 'OTHER');
  assert.equal(snapshot.payload.events[0].adIdentifiers.wbraid, 'opaque-wbraid-exact');
  assert.equal(snapshot.payload.destinations[0].productDestinationId, DESTINATION.productDestinationId);
  assert.equal(snapshot.payload.destinations[0].operatingAccount.accountType, 'GOOGLE_ADS');
  assert.equal(snapshot.payloadJson.includes('order_id'), false);
  assert.equal(snapshot.payloadJson.includes('conversion_date_time'), false);
  assert.equal(snapshot.payloadJson.includes('opaque-wbraid-exact'), true);
  assert.equal(snapshot.payloadJson.includes('nome'), false);
  assert.equal(snapshot.payloadFingerprint, buildOfflinePayload(
    {
      salesOrderId: ORDER_ID,
      quoteLeadId: LEAD_ID,
      originSource: 'site_form',
      eventTimestamp: NOW,
      conversionValue: '123.40',
      adIdentifierType: 'wbraid',
      adIdentifier: 'opaque-wbraid-exact',
      consentEvidence: selected.consentEvidence!,
    },
    DESTINATION
  ).payloadFingerprint);
});

test('preflight is fail-closed and binds target metadata to Data Manager destination', () => {
  const proof = {
    target: 'synthetic-disposable',
    owner: 'reviewer',
    databaseFingerprint: 'b'.repeat(64),
    deploymentRef: 'local-test',
    operatingAccountId: DESTINATION.operatingAccountId,
    productDestinationId: DESTINATION.productDestinationId,
    productDestinationType: 'UPLOAD_CLICKS',
    oauthScope: GOOGLE_DATA_MANAGER_SCOPE,
    verifiedAt: NOW.toISOString(),
  };
  assert.deepEqual(validateOfflinePreflight(proof, DESTINATION), { ok: true });
  assert.equal(validateOfflinePreflight(null, DESTINATION).ok, false);
  assert.equal(
    validateOfflinePreflight({ ...proof, productDestinationType: 'UPLOAD_CONVERSIONS' }, DESTINATION).ok,
    false
  );
  assert.equal(
    validateOfflinePreflight({ ...proof, productDestinationId: '0000000000' }, DESTINATION).ok,
    false
  );
  assert.equal(
    validateOfflinePreflight({ ...proof, verifiedAt: '2026-09-01T12:00:00Z' }, DESTINATION).ok,
    false
  );
});

test('dry-run only reads and never calls transport or repository writes', async () => {
  let transportCalls = 0;
  let writeCalls = 0;
  const repository = {
    listOrderEvidence: async () => [evidence()],
    getByIdentity: async () => null,
    prepare: async () => {
      writeCalls += 1;
      throw new Error('dry-run write');
    },
  } as unknown as OfflineExportRepository;
  const service = createAdsOfflineService({
    repository,
    destination: DESTINATION,
    transport: {
      ingest: async () => {
        transportCalls += 1;
        throw new Error('dry-run transport');
      },
      retrieveStatus: async () => {
        transportCalls += 1;
        throw new Error('dry-run diagnostic');
      },
    },
  });
  const report = await service.preview({ from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-02T00:00:00Z') });
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].category, 'reviewed_uuid_required');
  assert.equal(transportCalls, 0);
  assert.equal(writeCalls, 0);
});

test('apply requires preflight and reviewed UUIDs before one fake transport call', async () => {
  const writes: string[] = [];
  let sentPayload: unknown = null;
  const ledger = {
    id: '55555555-5555-4555-8555-555555555555',
    state: 'prepared',
    nextAttemptAt: null,
  } as never;
  const repository = {
    recoverExpiredSending: async () => 0,
    listOrderEvidence: async () => [evidence()],
    getByIdentity: async () => null,
    prepare: async (input: { payloadFingerprint: string }) => {
      writes.push(`prepare:${input.payloadFingerprint}`);
      return ledger;
    },
    reconcileSnapshot: async () => 'unchanged',
    claim: async () => ({
      export: ledger,
      attempt: { id: '66666666-6666-4666-8666-666666666666' },
      leaseToken: '77777777-7777-4777-8777-777777777777',
    }),
    recordTransportOutcome: async () => {
      writes.push('record');
      return true;
    },
    get: async () => ledger,
  } as unknown as OfflineExportRepository;
  const service = createAdsOfflineService({
    repository,
    destination: DESTINATION,
    transport: {
      ingest: async (payload) => {
        sentPayload = payload;
        return { kind: 'accepted' as const, requestId: 'request-fake', httpStatus: 200 as const, fieldWarnings: [] };
      },
      retrieveStatus: async () => ({ status: 'processing' as const }),
    },
    now: () => NOW,
  });
  const proof = {
    target: 'synthetic-disposable',
    owner: 'reviewer',
    databaseFingerprint: 'c'.repeat(64),
    deploymentRef: 'test',
    operatingAccountId: DESTINATION.operatingAccountId,
    productDestinationId: DESTINATION.productDestinationId,
    productDestinationType: 'UPLOAD_CLICKS',
    oauthScope: GOOGLE_DATA_MANAGER_SCOPE,
    verifiedAt: NOW.toISOString(),
  };
  const report = await service.apply({
    from: new Date('2026-09-01T00:00:00Z'),
    to: new Date('2026-09-02T00:00:00Z'),
    approvedOrderIds: new Set([ORDER_ID]),
    preflightProof: proof,
  });
  assert.equal(report.preflightVerified, true);
  assert.equal(report.rows[0].category, 'accepted_pending_diagnostic');
  assert.equal((sentPayload as { events: unknown[] }).events.length, 1);
  assert.deepEqual(writes.map((entry) => entry.startsWith('prepare:') ? 'prepare' : entry), ['prepare', 'record']);
  await assert.rejects(
    () => service.apply({
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-02T00:00:00Z'),
      approvedOrderIds: new Set([ORDER_ID]),
      preflightProof: null,
    }),
    /Preflight recusado/,
  );
});
