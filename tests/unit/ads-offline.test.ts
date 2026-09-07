import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOfflinePayload,
  GOOGLE_DATA_MANAGER_SCOPE,
  isRetryableDiagnosticCode,
  selectOfflineOrder,
  sanitizeDiagnosticCounts,
  sanitizeTransportDetail,
  sanitizeTransportWarnings,
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
const RUNTIME_TARGET = {
  target: 'synthetic-disposable',
  owner: 'synthetic-operator',
  databaseFingerprint: 'b'.repeat(64),
  deploymentRef: 'synthetic-deployment',
};

function preflightProof(overrides: Record<string, unknown> = {}) {
  return {
    ...RUNTIME_TARGET,
    ...DESTINATION,
    oauthScope: GOOGLE_DATA_MANAGER_SCOPE,
    verifiedAt: NOW.toISOString(),
    ...overrides,
  };
}

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
          policyVersion: '2026-08-18',
          reviewedAt: '2026-08-31T12:00:00.000Z',
          source: 'site_cookie_preferences',
          evidenceId: 'synthetic-consent-1',
        },
      },
    },
    lineageVerified: true,
    ...overrides,
  };
}

test('offline selection rejects legacy snake_case consent aliases', () => {
  const legacy = evidence();
  const siteSubmission = (legacy.raw as { siteSubmission: Record<string, unknown> }).siteSubmission;
  siteSubmission.consent = {
    adUserData: 'CONSENT_GRANTED',
    adPersonalization: 'CONSENT_GRANTED',
    policy_version: '2026-08-18',
    reviewed_at: '2026-08-31T12:00:00.000Z',
    source: 'site_cookie_preferences',
    evidence_id: 'legacy-synthetic',
  };
  const selected = selectOfflineOrder(legacy, {
    approvedOrderIds: new Set([ORDER_ID]),
  });
  assert.notEqual(selected.status, 'eligible');
  assert.ok(selected.reasons.includes('consent_review_required'));
});

test('offline selection rejects mixed consent aliases and multiple click IDs', () => {
  const mixed = evidence();
  const mixedConsent = (
    (mixed.raw as { siteSubmission: { consent: Record<string, unknown> } }).siteSubmission.consent
  );
  mixedConsent.reviewed_at = '2025-01-01T00:00:00.000Z';
  const mixedSelection = selectOfflineOrder(mixed, {
    approvedOrderIds: new Set([ORDER_ID]),
  });
  assert.notEqual(mixedSelection.status, 'eligible');
  assert.ok(mixedSelection.reasons.includes('consent_review_required'));

  const ambiguousSelection = selectOfflineOrder(
    evidence({ attribution: { gclid: 'synthetic-gclid', wbraid: 'synthetic-wbraid' } }),
    { approvedOrderIds: new Set([ORDER_ID]) }
  );
  assert.notEqual(ambiguousSelection.status, 'eligible');
  assert.ok(ambiguousSelection.reasons.includes('ambiguous_ad_identifiers'));
});

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
    selectOfflineOrder(evidence({ lineageVerified: false }), {
      approvedOrderIds: new Set([ORDER_ID]),
    }).status,
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
            policyVersion: '2026-08-18',
            reviewedAt: '2026-08-31T12:00:00.000Z',
            source: 'site_cookie_preferences',
          },
        },
      },
      attribution: { wbraid: 'opaque-wbraid-exact' },
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
  assert.equal(
    snapshot.payload.destinations[0].productDestinationId,
    DESTINATION.productDestinationId
  );
  assert.equal(snapshot.payload.destinations[0].operatingAccount.accountType, 'GOOGLE_ADS');
  assert.equal(snapshot.payloadJson.includes('order_id'), false);
  assert.equal(snapshot.payloadJson.includes('conversion_date_time'), false);
  assert.equal(snapshot.payloadJson.includes('opaque-wbraid-exact'), true);
  assert.equal(snapshot.payloadJson.includes('nome'), false);
  assert.equal(
    snapshot.payloadFingerprint,
    buildOfflinePayload(
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
    ).payloadFingerprint
  );
});

test('offline selection rejects an order timestamp in the future', () => {
  const selected = selectOfflineOrder(
    evidence({ createdAt: new Date('2099-01-01T00:00:00.000Z') }),
    {
      approvedOrderIds: new Set([ORDER_ID]),
      now: NOW,
    }
  );
  assert.equal(selected.status, 'excluded');
  assert.ok(selected.reasons.includes('future_order_timestamp'));
});

test('offline payload rejects money whose cents change during JSON serialization', () => {
  assert.throws(
    () =>
      buildOfflinePayload(
        {
          salesOrderId: ORDER_ID,
          quoteLeadId: LEAD_ID,
          originSource: 'site_form',
          eventTimestamp: NOW,
          conversionValue: '90071992547409.91',
          adIdentifierType: 'gclid',
          adIdentifier: 'opaque-gclid-preserved',
          consentEvidence: {
            adUserData: 'CONSENT_GRANTED',
            adPersonalization: 'CONSENT_GRANTED',
            policyVersion: '2026-08-18',
            reviewedAt: NOW.toISOString(),
            source: 'site_cookie_preferences',
          },
        },
        DESTINATION
      ),
    /safe API number range/
  );
});

test('offline selection blocks legacy and generic grant variants at the ads boundary', () => {
  const strictGrant = {
    adUserData: 'CONSENT_GRANTED',
    adPersonalization: 'CONSENT_GRANTED',
    policyVersion: '2026-08-18',
    reviewedAt: '2026-08-31T12:00:00.000Z',
    source: 'site_cookie_preferences',
  };
  const selected = selectOfflineOrder(evidence({ raw: { siteSubmission: {
    payloadFingerprint: 'a'.repeat(64),
    originalCreatedAt: '2026-08-31T12:00:00.000Z',
    primaryAdIdentifier: 'gclid',
    consent: strictGrant,
  } } }), { approvedOrderIds: new Set([ORDER_ID]) });
  assert.equal(selected.status, 'eligible');
  for (const consent of [
    { ...strictGrant, policyVersion: '2025-01-01' },
    { ...strictGrant, source: 'site_quote_form' },
    { given: true, source: 'site_quote_form' },
    { ...strictGrant, adUserData: 'CONSENT_DENIED' },
    { ...strictGrant, reviewedAt: '2026-08-31T12:00:00Z' },
    null,
  ]) {
    const blocked = selectOfflineOrder(evidence({ raw: { siteSubmission: {
      payloadFingerprint: 'a'.repeat(64),
      originalCreatedAt: '2026-08-31T12:00:00.000Z',
      primaryAdIdentifier: 'gclid',
      consent,
    } } }), { approvedOrderIds: new Set([ORDER_ID]) });
    assert.equal(blocked.status, 'needs_review', JSON.stringify(consent));
    assert.equal(blocked.reviewReason, 'consent_review_required', JSON.stringify(consent));
    assert.equal(blocked.consentEvidence, null, JSON.stringify(consent));
  }
});

test('preflight is fail-closed and binds target metadata to Data Manager destination', () => {
  const proof = preflightProof();
  assert.deepEqual(validateOfflinePreflight(proof, DESTINATION, RUNTIME_TARGET), { ok: true });
  assert.equal(validateOfflinePreflight(null, DESTINATION).ok, false);
  assert.equal(
    validateOfflinePreflight({ ...proof, target: 'other-target' }, DESTINATION, RUNTIME_TARGET).ok,
    false
  );
  assert.equal(
    validateOfflinePreflight(
      { ...proof, databaseFingerprint: 'a'.repeat(64) },
      DESTINATION,
      RUNTIME_TARGET
    ).ok,
    false
  );
  assert.equal(
    validateOfflinePreflight(
      { ...proof, productDestinationType: 'UPLOAD_CONVERSIONS' },
      DESTINATION,
      RUNTIME_TARGET
    ).ok,
    false
  );
  assert.equal(
    validateOfflinePreflight(
      { ...proof, productDestinationId: '0000000000' },
      DESTINATION,
      RUNTIME_TARGET
    ).ok,
    false
  );
  assert.equal(
    validateOfflinePreflight(
      { ...proof, verifiedAt: '2026-09-01T12:00:00Z' },
      DESTINATION,
      RUNTIME_TARGET
    ).ok,
    false
  );
});

test('transport diagnostics keep only controlled fields and fixed detail text', () => {
  const secret = 'Authorization: Bearer synthetic-secret';
  assert.deepEqual(
    sanitizeTransportWarnings([
      { field: 'events[0]', reason: 'WARNING_REASON_GENERIC', description: secret },
      { field: secret, reason: secret, description: secret },
    ]),
    [
      { code: 'GOOGLE_DM_FIELD_WARNING', field: 'events[0]', reason: 'WARNING_REASON_GENERIC' },
      { code: 'GOOGLE_DM_FIELD_WARNING' },
    ]
  );
  assert.equal(sanitizeTransportDetail(secret), 'detalhe do transporte omitido');
  assert.equal(isRetryableDiagnosticCode('GOOGLE_DM_HTTP_503'), true);
  assert.equal(isRetryableDiagnosticCode('GOOGLE_DM_HTTP_400'), false);
});

test('Data Manager catalogs preserve every current supported reason and reject injected values', () => {
  const fieldWarningReasons = [
    'WARNING_REASON_UNSPECIFIED',
    'WARNING_REASON_CUSTOM_VARIABLE_NOT_ENABLED',
    'WARNING_REASON_CUSTOM_VARIABLE_NOT_PREDEFINED',
    'WARNING_REASON_CART_DATA_NOT_SUPPORTED_WITH_GBRAID_OR_WBRAID',
    'WARNING_REASON_CART_DATA_ITEM_MERCHANT_PRODUCT_ID_MISSING',
    'WARNING_REASON_CART_DATA_ITEM_UNIT_PRICE_MISSING',
    'WARNING_REASON_GENERIC',
    'WARNING_REASON_INVALID_CLIENT_ID',
    'WARNING_REASON_INVALID_SUBDIVISION_CODE',
    'WARNING_REASON_INVALID_REGION_CODE',
    'WARNING_REASON_INVALID_SUBCONTINENT_CODE',
    'WARNING_REASON_INVALID_CONTINENT_CODE',
    'WARNING_REASON_INVALID_DEVICE_CATEGORY',
    'WARNING_REASON_INVALID_DEVICE_SCREEN_RESOLUTION',
    'WARNING_REASON_INVALID_MERCHANT_ID',
  ];
  const processingErrorReasons = [
    'PROCESSING_ERROR_REASON_UNSPECIFIED',
    'PROCESSING_ERROR_REASON_INVALID_CUSTOM_VARIABLE',
    'PROCESSING_ERROR_REASON_CUSTOM_VARIABLE_NOT_ENABLED',
    'PROCESSING_ERROR_REASON_EVENT_TOO_OLD',
    'PROCESSING_ERROR_REASON_DENIED_CONSENT',
    'PROCESSING_ERROR_REASON_NO_CONSENT',
    'PROCESSING_ERROR_REASON_UNKNOWN_CONSENT',
    'PROCESSING_ERROR_REASON_DUPLICATE_GCLID',
    'PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID',
    'PROCESSING_ERROR_REASON_INVALID_GBRAID',
    'PROCESSING_ERROR_REASON_INVALID_GCLID',
    'PROCESSING_ERROR_REASON_INVALID_MERCHANT_ID',
    'PROCESSING_ERROR_REASON_INVALID_WBRAID',
    'PROCESSING_ERROR_REASON_INTERNAL_ERROR',
    'PROCESSING_ERROR_REASON_DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED',
    'PROCESSING_ERROR_REASON_INVALID_EVENT',
    'PROCESSING_ERROR_REASON_INSUFFICIENT_MATCHED_TRANSACTIONS',
    'PROCESSING_ERROR_REASON_INSUFFICIENT_TRANSACTIONS',
    'PROCESSING_ERROR_REASON_INVALID_FORMAT',
    'PROCESSING_ERROR_REASON_DECRYPTION_ERROR',
    'PROCESSING_ERROR_REASON_DEK_DECRYPTION_ERROR',
    'PROCESSING_ERROR_REASON_INVALID_WIP',
    'PROCESSING_ERROR_REASON_INVALID_KEK',
    'PROCESSING_ERROR_REASON_WIP_AUTH_FAILED',
    'PROCESSING_ERROR_REASON_KEK_PERMISSION_DENIED',
    'PROCESSING_ERROR_REASON_AWS_AUTH_FAILED',
    'PROCESSING_ERROR_REASON_USER_IDENTIFIER_DECRYPTION_ERROR',
    'PROCESSING_ERROR_OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER',
    'PROCESSING_ERROR_REASON_ONE_PER_CLICK_CONVERSION_ACTION_NOT_PERMITTED_WITH_BRAID',
    'PROCESSING_ERROR_REASON_MATCH_ID_NOT_FOUND',
    'PROCESSING_ERROR_REASON_USER_ID_NOT_FOUND_FOR_MATCH_ID',
    'PROCESSING_ERROR_REASON_USER_ID_NOT_FOUND_FOR_GCLID',
    'PROCESSING_ERROR_REASON_USER_ID_NOT_FOUND_FOR_DCLID',
    'PROCESSING_ERROR_REASON_INVALID_AD_IDENTIFIERS',
    'PROCESSING_ERROR_REASON_INVALID_MOBILE_ID_FORMAT',
    'PROCESSING_ERROR_REASON_ORIGINAL_CONVERSIONS_NOT_FOUND',
    'PROCESSING_ERROR_REASON_EVENT_ID_DECODE_ERROR',
    'PROCESSING_ERROR_REASON_USER_ID_NOT_FOUND_FOR_IMPRESSION_ID',
    'PROCESSING_ERROR_REASON_USER_ID_NOT_FOUND',
    'PROCESSING_ERROR_REASON_CONVERSION_PRECEDES_CLICK',
    'PROCESSING_ERROR_REASON_TOO_RECENT_CLICK',
    'PROCESSING_ERROR_REASON_INVALID_CLICK',
    'PROCESSING_ERROR_REASON_INVALID_OPERATING_ACCOUNT_FOR_CLICK',
    'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND',
    'PROCESSING_ERROR_REASON_EXTERNAL_ATTRIBUTION_DATA_MISSING',
  ];
  const processingWarningReasons = [
    'PROCESSING_WARNING_REASON_UNSPECIFIED',
    'PROCESSING_WARNING_REASON_KEK_PERMISSION_DENIED',
    'PROCESSING_WARNING_REASON_DEK_DECRYPTION_ERROR',
    'PROCESSING_WARNING_REASON_DECRYPTION_ERROR',
    'PROCESSING_WARNING_REASON_WIP_AUTH_FAILED',
    'PROCESSING_WARNING_REASON_INVALID_WIP',
    'PROCESSING_WARNING_REASON_INVALID_KEK',
    'PROCESSING_WARNING_REASON_USER_IDENTIFIER_DECRYPTION_ERROR',
    'PROCESSING_WARNING_REASON_INTERNAL_ERROR',
    'PROCESSING_WARNING_REASON_AWS_AUTH_FAILED',
  ];

  for (const reason of fieldWarningReasons) {
    assert.deepEqual(sanitizeTransportWarnings([{ field: 'events[0]', reason }]), [
      { code: 'GOOGLE_DM_FIELD_WARNING', field: 'events[0]', reason },
    ]);
  }
  for (const reason of processingErrorReasons) {
    assert.deepEqual(sanitizeDiagnosticCounts([{ reason, recordCount: '2' }], 'error'), [
      { reason, recordCount: 2 },
    ]);
  }
  for (const reason of processingWarningReasons) {
    assert.deepEqual(sanitizeDiagnosticCounts([{ reason, recordCount: '2' }], 'warning'), [
      { reason, recordCount: 2 },
    ]);
  }

  const secret = 'WARNING_REASON_SYNTHETIC_SECRET_123';
  const unknownError = 'PROCESSING_ERROR_REASON_SYNTHETIC_SECRET_123';
  const unknownWarning = 'PROCESSING_WARNING_REASON_SYNTHETIC_SECRET_123';
  const sanitized = {
    field: sanitizeTransportWarnings([{ field: 'events[0]', reason: secret }]),
    error: sanitizeDiagnosticCounts([{ reason: unknownError, recordCount: '2' }], 'error'),
    warning: sanitizeDiagnosticCounts([{ reason: unknownWarning, recordCount: '3' }], 'warning'),
  };
  assert.deepEqual(sanitized, {
    field: [{ code: 'GOOGLE_DM_FIELD_WARNING', field: 'events[0]' }],
    error: [{ reason: 'PROCESSING_ERROR_REASON_UNSPECIFIED', recordCount: 2 }],
    warning: [{ reason: 'PROCESSING_WARNING_REASON_UNSPECIFIED', recordCount: 3 }],
  });
  assert.equal(JSON.stringify(sanitized).includes('SYNTHETIC_SECRET'), false);
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
  const report = await service.preview({
    from: new Date('2026-09-01T00:00:00Z'),
    to: new Date('2026-09-02T00:00:00Z'),
  });
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
        return {
          kind: 'accepted' as const,
          requestId: 'request-fake',
          httpStatus: 200 as const,
          fieldWarnings: [],
        };
      },
      retrieveStatus: async () => ({ status: 'processing' as const }),
    },
    now: () => NOW,
  });
  const proof = {
    ...preflightProof(),
  };
  const report = await service.apply({
    from: new Date('2026-09-01T00:00:00Z'),
    to: new Date('2026-09-02T00:00:00Z'),
    approvedOrderIds: new Set([ORDER_ID]),
    preflightProof: proof,
    runtimeTarget: RUNTIME_TARGET,
  });
  assert.equal(report.preflightVerified, true);
  assert.equal(report.rows[0].category, 'accepted_pending_diagnostic');
  assert.equal((sentPayload as { events: unknown[] }).events.length, 1);
  assert.deepEqual(
    writes.map((entry) => (entry.startsWith('prepare:') ? 'prepare' : entry)),
    ['prepare', 'record']
  );
  await assert.rejects(
    () =>
      service.apply({
        from: new Date('2026-09-01T00:00:00Z'),
        to: new Date('2026-09-02T00:00:00Z'),
        approvedOrderIds: new Set([ORDER_ID]),
        preflightProof: null,
        runtimeTarget: RUNTIME_TARGET,
      }),
    /Preflight recusado/
  );
});

test('apply rejects a mismatched target before recovery, claims, writes, or transport', async () => {
  const effects: string[] = [];
  const repository = {
    recoverExpiredSending: async () => effects.push('recover'),
    listOrderEvidence: async () => {
      effects.push('list');
      return [];
    },
    getByIdentity: async () => {
      effects.push('get-identity');
      return null;
    },
    prepare: async () => {
      effects.push('prepare');
      throw new Error('must not write');
    },
    claim: async () => {
      effects.push('claim');
      return null;
    },
  } as unknown as OfflineExportRepository;
  const service = createAdsOfflineService({
    repository,
    destination: DESTINATION,
    transport: {
      ingest: async () => {
        effects.push('transport');
        throw new Error('must not send');
      },
      retrieveStatus: async () => ({ status: 'processing' as const }),
    },
    now: () => NOW,
  });
  await assert.rejects(
    () =>
      service.apply({
        from: new Date('2026-09-01T00:00:00Z'),
        to: new Date('2026-09-02T00:00:00Z'),
        approvedOrderIds: new Set([ORDER_ID]),
        preflightProof: preflightProof({ target: 'wrong-target' }),
        runtimeTarget: RUNTIME_TARGET,
      }),
    /Preflight recusado/
  );
  assert.deepEqual(effects, []);
});

test('diagnose rejects a ledger destination mismatch before fetch or persistence', async () => {
  const effects: string[] = [];
  const repository = {
    get: async () => {
      effects.push('get');
      return {
        state: 'accepted_pending_diagnostic',
        destinationAccountId: 'other-account',
        destinationActionId: DESTINATION.productDestinationId,
      };
    },
    getLatestAcceptedAttempt: async () => {
      effects.push('get-attempt');
      return {
        id: '66666666-6666-4666-8666-666666666666',
        requestId: 'request-wrong-destination',
        errorCode: null,
      };
    },
    recordDiagnostic: async () => {
      effects.push('record');
      return true;
    },
    recordDiagnosticError: async () => {
      effects.push('record-error');
      return true;
    },
  } as unknown as OfflineExportRepository;
  const service = createAdsOfflineService({
    repository,
    destination: DESTINATION,
    transport: {
      ingest: async () => {
        effects.push('ingest');
        throw new Error('must not ingest');
      },
      retrieveStatus: async () => {
        effects.push('retrieve');
        return { status: 'success' as const };
      },
    },
  });

  assert.equal(
    await service.diagnose({
      exportId: '55555555-5555-4555-8555-555555555555',
      preflightProof: preflightProof(),
      runtimeTarget: RUNTIME_TARGET,
    }),
    false
  );
  assert.deepEqual(effects, ['get']);
});

test('diagnose retries a transient diagnostic without ingesting again', async () => {
  let state: 'accepted_pending_diagnostic' | 'needs_review' = 'accepted_pending_diagnostic';
  let reviewReason: string | null = null;
  let attemptErrorCode: string | null = null;
  let retrieveCalls = 0;
  let ingestCalls = 0;
  let diagnosticErrors = 0;
  let diagnosticResults = 0;
  const repository = {
    get: async () => ({
      state,
      reviewReason,
      destinationAccountId: DESTINATION.operatingAccountId,
      destinationActionId: DESTINATION.productDestinationId,
    }),
    getLatestAcceptedAttempt: async () => ({
      id: '66666666-6666-4666-8666-666666666666',
      requestId: 'request-diagnostic-retry',
      errorCode: attemptErrorCode,
    }),
    recordDiagnosticError: async ({ retryable, code }: { retryable: boolean; code: string }) => {
      diagnosticErrors += 1;
      assert.equal(retryable, true);
      assert.equal(code, 'GOOGLE_DM_HTTP_429');
      state = 'needs_review';
      reviewReason = 'result_unknown';
      attemptErrorCode = code;
      return true;
    },
    recordDiagnostic: async ({ result }: { result: { status: string } }) => {
      diagnosticResults += 1;
      assert.equal(result.status, 'success');
      state = 'processed' as typeof state;
      return true;
    },
  } as unknown as OfflineExportRepository;
  const service = createAdsOfflineService({
    repository,
    destination: DESTINATION,
    transport: {
      ingest: async () => {
        ingestCalls += 1;
        throw new Error('diagnostic retry must not ingest');
      },
      retrieveStatus: async () => {
        retrieveCalls += 1;
        if (retrieveCalls === 1) {
          throw { kind: 'transient', code: 'GOOGLE_DM_HTTP_429', detail: 'provider secret' };
        }
        return { status: 'success' as const };
      },
    },
    now: () => NOW,
  });
  const input = {
    exportId: '55555555-5555-4555-8555-555555555555',
    preflightProof: preflightProof(),
    runtimeTarget: RUNTIME_TARGET,
  };
  assert.equal(await service.diagnose(input), true);
  assert.equal(await service.diagnose(input), true);
  assert.equal(retrieveCalls, 2);
  assert.equal(diagnosticErrors, 1);
  assert.equal(diagnosticResults, 1);
  assert.equal(ingestCalls, 0);
});
