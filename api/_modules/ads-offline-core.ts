import { createHash } from 'node:crypto';

import { canonicalizeNonNegativeDecimal } from '../_shared/decimal-money.js';

export const OFFLINE_EVENT_TYPE = 'pedido_iniciado' as const;
export const OFFLINE_CURRENCY = 'BRL' as const;
export const OFFLINE_EVENT_SOURCE = 'OTHER' as const;
export const GOOGLE_DATA_MANAGER_SCOPE = 'https://www.googleapis.com/auth/datamanager';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AD_IDENTIFIER_TYPES = ['gclid', 'wbraid', 'gbraid'] as const;
const SAFE_WARNING_FIELDS = new Set([
  'destinations',
  'destinations[0]',
  'destinations[0].operatingAccount',
  'destinations[0].operatingAccount.accountType',
  'destinations[0].operatingAccount.accountId',
  'destinations[0].productDestinationId',
  'events',
  'events[0]',
  'events[0].transactionId',
  'events[0].eventTimestamp',
  'events[0].conversionValue',
  'events[0].currency',
  'events[0].eventSource',
  'events[0].adIdentifiers',
  'events[0].adIdentifiers.gclid',
  'events[0].adIdentifiers.wbraid',
  'events[0].adIdentifiers.gbraid',
  'events[0].consent',
]);
export const GOOGLE_DATA_MANAGER_FIELD_WARNING_REASONS = [
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
] as const;
export const GOOGLE_DATA_MANAGER_PROCESSING_ERROR_REASONS = [
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
] as const;
export const GOOGLE_DATA_MANAGER_PROCESSING_WARNING_REASONS = [
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
] as const;
const SAFE_WARNING_REASONS = new Set<string>(GOOGLE_DATA_MANAGER_FIELD_WARNING_REASONS);
const SAFE_PROCESSING_ERROR_REASONS = new Set<string>(GOOGLE_DATA_MANAGER_PROCESSING_ERROR_REASONS);
const SAFE_PROCESSING_WARNING_REASONS = new Set<string>(
  GOOGLE_DATA_MANAGER_PROCESSING_WARNING_REASONS
);
const SAFE_TRANSPORT_CODE_PATTERN =
  /^GOOGLE_DM_(?:CONFIG_INCOMPLETE|HTTP_[1-5][0-9]{2}|OAUTH_(?:[1-5][0-9]{2}|RESPONSE|TIMEOUT|NETWORK)|TIMEOUT|NETWORK|UNEXPECTED_[1-5][0-9]{2}|MISSING_REQUEST_ID|REQUEST_ID_INVALID|INVALID_DIAGNOSTIC_RESPONSE|DIAGNOSTIC_FAILURE|DIAGNOSTIC_PARTIAL_SUCCESS)$/;
const RETRYABLE_DIAGNOSTIC_CODES = new Set([
  'GOOGLE_DM_HTTP_429',
  'GOOGLE_DM_TIMEOUT',
  'GOOGLE_DM_NETWORK',
  'GOOGLE_DM_OAUTH_TIMEOUT',
  'GOOGLE_DM_OAUTH_NETWORK',
]);
const OMITTED_TRANSPORT_DETAIL = 'detalhe do transporte omitido';

export type AdIdentifierType = (typeof AD_IDENTIFIER_TYPES)[number];
export type OfflineExportState =
  | 'prepared'
  | 'sending'
  | 'accepted_pending_diagnostic'
  | 'processed'
  | 'failed'
  | 'needs_review';
export type OfflineReviewReason =
  | 'consent_review_required'
  | 'result_unknown'
  | 'diagnostic_partial_success'
  | 'lease_expired_after_transport'
  | 'cancellation_after_attempt'
  | 'correction_after_attempt'
  | 'substitution_after_attempt';
export type OfflineAttemptState = 'started' | 'accepted' | 'failed' | 'unknown';
export type OfflineDiagnosticStatus = 'processing' | 'success' | 'partial_success' | 'failure';

export interface OfflineDestination {
  operatingAccountId: string;
  productDestinationId: string;
  productDestinationType?: 'UPLOAD_CLICKS' | string;
}

export interface OfflineConsentEvidence {
  adUserData: 'CONSENT_GRANTED';
  adPersonalization: 'CONSENT_GRANTED';
  policyVersion: string;
  reviewedAt: string;
  source: string;
  evidenceId?: string;
}

export interface OfflineOrderEvidence {
  salesOrderId: string;
  orderNumber: string;
  status: string;
  quotationId: string | null;
  quotationRevisionId: string | null;
  quoteLeadId: string | null;
  originStatus: 'linked' | 'missing' | 'conflict';
  originSource: string | null;
  revisionQuotationId: string | null;
  quotationStatus: string | null;
  revisionStatus: string | null;
  total: string | number;
  createdAt: Date | string | null;
  attribution: unknown;
  raw: unknown;
  lineageVerified: boolean;
}

export interface OfflineOrderSelection {
  status: 'eligible' | 'needs_review' | 'excluded';
  category: string;
  reasons: string[];
  reviewReason: OfflineReviewReason | null;
  adIdentifierType: AdIdentifierType | null;
  adIdentifier: string | null;
  consentEvidence: OfflineConsentEvidence | null;
  eventTimestamp: Date | null;
  conversionValue: string | null;
}

export interface GoogleDataManagerEvent {
  transactionId: string;
  eventTimestamp: string;
  conversionValue: number;
  currency: typeof OFFLINE_CURRENCY;
  eventSource: typeof OFFLINE_EVENT_SOURCE;
  adIdentifiers: Partial<Record<AdIdentifierType, string>>;
  consent?: {
    adUserData: 'CONSENT_GRANTED';
    adPersonalization: 'CONSENT_GRANTED';
  };
}

export interface GoogleDataManagerPayload {
  destinations: Array<{
    operatingAccount: {
      accountType: 'GOOGLE_ADS';
      accountId: string;
    };
    productDestinationId: string;
  }>;
  events: [GoogleDataManagerEvent];
}

export interface OfflinePreflightProof {
  target: string;
  owner: string;
  databaseFingerprint: string;
  deploymentRef: string;
  operatingAccountId: string;
  productDestinationId: string;
  productDestinationType: string;
  oauthScope: string;
  verifiedAt: string;
}

export interface OfflinePreflightRuntimeTarget {
  target: string;
  owner: string;
  databaseFingerprint: string;
  deploymentRef: string;
}

export interface OfflineTransportAccepted {
  kind: 'accepted';
  requestId: string;
  httpStatus: 200;
  fieldWarnings: unknown[];
}

export interface OfflineTransportError {
  kind: 'permanent' | 'transient' | 'ambiguous';
  code: string;
  detail?: string;
  httpStatus?: number;
}

export type OfflineTransportResult = OfflineTransportAccepted;

export interface GoogleDataManagerDiagnosticResult {
  status: OfflineDiagnosticStatus;
  detail?: string;
  errorCounts?: GoogleDataManagerDiagnosticCount[];
  warningCounts?: GoogleDataManagerDiagnosticCount[];
}

export interface GoogleDataManagerDiagnosticCount {
  reason: string;
  recordCount: number;
}

export interface GoogleDataManagerTransport {
  ingest(payload: GoogleDataManagerPayload): Promise<OfflineTransportResult>;
  retrieveStatus(requestId: string): Promise<GoogleDataManagerDiagnosticResult>;
}

export interface OfflinePayloadSnapshot {
  salesOrderId: string;
  quoteLeadId: string;
  originSource: string;
  eventTimestamp: Date | string;
  conversionValue: string;
  adIdentifierType: AdIdentifierType;
  adIdentifier: string;
  consentEvidence: OfflineConsentEvidence;
}

export interface OfflinePreparedPayload {
  payload: GoogleDataManagerPayload;
  payloadJson: string;
  payloadFingerprint: string;
  eventTimestamp: Date;
  conversionValue: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalIso(value: unknown): string | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function verifiedIsoString(value: unknown): string | null {
  const raw = clean(value);
  const iso = canonicalIso(raw);
  return iso && raw === iso ? iso : null;
}

function isAdIdentifierType(value: unknown): value is AdIdentifierType {
  return AD_IDENTIFIER_TYPES.includes(value as AdIdentifierType);
}

function rawSiteSubmission(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw) || !isRecord(raw.siteSubmission)) return null;
  return raw.siteSubmission;
}

function consentEvidenceFrom(raw: unknown): OfflineConsentEvidence | null {
  const consent = rawSiteSubmission(raw)?.consent;
  if (!isRecord(consent)) return null;
  const policyVersion = clean(consent.policyVersion ?? consent.policy_version);
  const reviewedAt = verifiedIsoString(consent.reviewedAt ?? consent.reviewed_at);
  const source = clean(consent.source);
  const evidenceId = clean(consent.evidenceId ?? consent.evidence_id);
  if (
    consent.adUserData !== 'CONSENT_GRANTED' ||
    consent.adPersonalization !== 'CONSENT_GRANTED' ||
    !policyVersion ||
    !reviewedAt ||
    !source
  ) {
    return null;
  }
  return {
    adUserData: 'CONSENT_GRANTED',
    adPersonalization: 'CONSENT_GRANTED',
    policyVersion,
    reviewedAt,
    source,
    ...(evidenceId ? { evidenceId } : {}),
  };
}

function adIdentifierFrom(evidence: OfflineOrderEvidence): {
  type: AdIdentifierType;
  value: string;
} | null {
  const attribution = isRecord(evidence.attribution) ? evidence.attribution : {};
  const marker = rawSiteSubmission(evidence.raw)?.primaryAdIdentifier;
  const candidates = isAdIdentifierType(marker) ? [marker] : AD_IDENTIFIER_TYPES;
  for (const type of candidates) {
    const value = attribution[type];
    if (typeof value === 'string' && value.trim()) return { type, value };
  }
  return null;
}

function sourceSubmissionIsVerified(raw: unknown): boolean {
  const siteSubmission = rawSiteSubmission(raw);
  const fingerprint = clean(siteSubmission?.payloadFingerprint);
  const originalCreatedAt = verifiedIsoString(siteSubmission?.originalCreatedAt);
  return Boolean(
    fingerprint &&
    SHA256_PATTERN.test(fingerprint) &&
    originalCreatedAt &&
    siteSubmission?.consent !== undefined
  );
}

function reasonFor(reasons: string[]): OfflineReviewReason | null {
  const priority: OfflineReviewReason[] = [
    'result_unknown',
    'lease_expired_after_transport',
    'diagnostic_partial_success',
    'cancellation_after_attempt',
    'correction_after_attempt',
    'substitution_after_attempt',
    'consent_review_required',
  ];
  return priority.find((reason) => reasons.includes(reason)) || null;
}

function result(
  status: OfflineOrderSelection['status'],
  category: string,
  reasons: string[],
  values: Partial<OfflineOrderSelection> = {}
): OfflineOrderSelection {
  return {
    status,
    category,
    reasons,
    reviewReason: reasonFor(reasons),
    adIdentifierType: null,
    adIdentifier: null,
    consentEvidence: null,
    eventTimestamp: null,
    conversionValue: null,
    ...values,
  };
}

export function selectOfflineOrder(
  evidence: OfflineOrderEvidence,
  options: {
    approvedOrderIds?: ReadonlySet<string>;
    allowTestMarker?: boolean;
    now?: Date | string;
  } = {}
): OfflineOrderSelection {
  const approvedOrderIds = options.approvedOrderIds || new Set<string>();
  const reasons: string[] = [];
  if (evidence.status === 'Draft' || evidence.status === 'Cancelled') {
    return result('excluded', evidence.status === 'Draft' ? 'draft' : 'cancelled', [
      `status_${evidence.status.toLowerCase()}`,
    ]);
  }
  if (evidence.status === 'Closed') reasons.push('closed_status');
  else if (
    !['To Deliver and Bill', 'To Deliver', 'To Bill', 'Completed'].includes(evidence.status)
  ) {
    reasons.push('unsupported_order_status');
  }
  if (evidence.originStatus !== 'linked') reasons.push(`origin_${evidence.originStatus}`);
  if (evidence.originSource !== 'site_form') reasons.push('unsupported_origin_source');
  if (
    !evidence.quotationId ||
    !evidence.quotationRevisionId ||
    !evidence.quoteLeadId ||
    evidence.revisionQuotationId !== evidence.quotationId ||
    evidence.quotationStatus !== 'aprovado' ||
    evidence.revisionStatus !== 'aprovado' ||
    !evidence.lineageVerified
  ) {
    reasons.push('unverified_approved_lineage');
  }
  if (!sourceSubmissionIsVerified(evidence.raw)) reasons.push('unverified_submission_history');

  const total = canonicalizeNonNegativeDecimal(evidence.total, { maxIntegerDigits: 18 });
  if (!total || total === '0.00') reasons.push('non_positive_total');
  const eventTimestamp = canonicalIso(evidence.createdAt);
  if (!eventTimestamp) reasons.push('invalid_order_timestamp');
  const selectionNow = canonicalIso(options.now ?? new Date());
  if (eventTimestamp && selectionNow && new Date(eventTimestamp) > new Date(selectionNow)) {
    reasons.push('future_order_timestamp');
  }

  const adIdentifier = adIdentifierFrom(evidence);
  if (!adIdentifier) reasons.push('missing_ad_identifier');
  const consentEvidence = consentEvidenceFrom(evidence.raw);
  if (!consentEvidence) reasons.push('consent_review_required');

  const testMarker = rawSiteSubmission(evidence.raw)?.offlineExportTestMarker;
  if (
    !approvedOrderIds.has(evidence.salesOrderId) &&
    !(options.allowTestMarker && testMarker === 'synthetic-approved-v1')
  ) {
    reasons.push('reviewed_uuid_required');
  }

  const hasBlockingLineage = reasons.some((reason) =>
    [
      'closed_status',
      'unsupported_order_status',
      'origin_missing',
      'origin_conflict',
      'unsupported_origin_source',
      'unverified_approved_lineage',
      'unverified_submission_history',
      'non_positive_total',
      'invalid_order_timestamp',
      'future_order_timestamp',
      'missing_ad_identifier',
    ].includes(reason)
  );
  if (hasBlockingLineage) {
    return result(
      reasons.includes('closed_status') ? 'needs_review' : 'excluded',
      reasons.includes('closed_status') ? 'closed_review' : 'not_eligible',
      reasons,
      {
        adIdentifierType: adIdentifier?.type || null,
        adIdentifier: adIdentifier?.value || null,
        eventTimestamp: eventTimestamp ? new Date(eventTimestamp) : null,
        conversionValue: total,
      }
    );
  }
  if (reasons.includes('reviewed_uuid_required')) {
    return result('needs_review', 'reviewed_uuid_required', reasons, {
      adIdentifierType: adIdentifier?.type || null,
      adIdentifier: adIdentifier?.value || null,
      eventTimestamp: eventTimestamp ? new Date(eventTimestamp) : null,
      conversionValue: total,
    });
  }
  if (reasons.includes('consent_review_required')) {
    return result('needs_review', 'consent_review', reasons, {
      adIdentifierType: adIdentifier!.type,
      adIdentifier: adIdentifier!.value,
      eventTimestamp: new Date(eventTimestamp!),
      conversionValue: total,
    });
  }
  return result('eligible', 'eligible', [], {
    adIdentifierType: adIdentifier!.type,
    adIdentifier: adIdentifier!.value,
    consentEvidence,
    eventTimestamp: new Date(eventTimestamp!),
    conversionValue: total,
  });
}

function safeConversionValue(value: string): number {
  const cents = BigInt(value.replace('.', ''));
  const numeric = Number(value);
  const serialized = JSON.stringify(numeric);
  const serializedValue = serialized
    ? canonicalizeNonNegativeDecimal(serialized, { maxIntegerDigits: 18 })
    : null;
  if (
    cents > BigInt(Number.MAX_SAFE_INTEGER) ||
    !Number.isFinite(numeric) ||
    serializedValue !== value
  ) {
    throw new Error('conversion value exceeds the safe API number range');
  }
  return numeric;
}

export function buildOfflinePayload(
  snapshot: OfflinePayloadSnapshot,
  destination: OfflineDestination
): OfflinePreparedPayload {
  const salesOrderId = clean(snapshot.salesOrderId);
  const quoteLeadId = clean(snapshot.quoteLeadId);
  const originSource = clean(snapshot.originSource);
  const accountId = clean(destination.operatingAccountId);
  const productDestinationId = clean(destination.productDestinationId);
  const adIdentifier = snapshot.adIdentifier;
  const eventTimestamp = canonicalIso(snapshot.eventTimestamp);
  const conversionValue = canonicalizeNonNegativeDecimal(snapshot.conversionValue, {
    maxIntegerDigits: 18,
  });
  if (
    !UUID_PATTERN.test(salesOrderId) ||
    !UUID_PATTERN.test(quoteLeadId) ||
    !originSource ||
    !accountId ||
    !productDestinationId ||
    !isAdIdentifierType(snapshot.adIdentifierType) ||
    !adIdentifier.trim() ||
    !eventTimestamp ||
    !conversionValue ||
    conversionValue === '0.00'
  ) {
    throw new Error('offline export snapshot is incomplete');
  }
  if (!snapshot.consentEvidence) throw new Error('offline export consent is not approved');
  if (
    destination.productDestinationType &&
    destination.productDestinationType !== 'UPLOAD_CLICKS'
  ) {
    throw new Error('offline export destination type is unsupported');
  }
  const event: GoogleDataManagerEvent = {
    transactionId: `aspen-pedido-iniciado:${salesOrderId}`,
    eventTimestamp,
    conversionValue: safeConversionValue(conversionValue),
    currency: OFFLINE_CURRENCY,
    eventSource: OFFLINE_EVENT_SOURCE,
    adIdentifiers: { [snapshot.adIdentifierType]: adIdentifier },
    consent: {
      adUserData: 'CONSENT_GRANTED',
      adPersonalization: 'CONSENT_GRANTED',
    },
  };
  const payload: GoogleDataManagerPayload = {
    destinations: [
      {
        operatingAccount: { accountType: 'GOOGLE_ADS', accountId },
        productDestinationId,
      },
    ],
    events: [event],
  };
  const payloadJson = JSON.stringify(payload);
  return {
    payload,
    payloadJson,
    payloadFingerprint: createHash('sha256').update(payloadJson).digest('hex'),
    eventTimestamp: new Date(eventTimestamp),
    conversionValue,
  };
}

export function validateOfflinePreflight(
  proof: unknown,
  destination: OfflineDestination,
  runtimeTarget?: OfflinePreflightRuntimeTarget
): { ok: true } | { ok: false; reason: string } {
  if (!isRecord(proof)) return { ok: false, reason: 'preflight_missing' };
  const required = [
    'target',
    'owner',
    'databaseFingerprint',
    'deploymentRef',
    'operatingAccountId',
    'productDestinationId',
    'productDestinationType',
    'oauthScope',
    'verifiedAt',
  ] as const;
  if (required.some((key) => !clean(proof[key])))
    return { ok: false, reason: 'preflight_incomplete' };
  if (!SHA256_PATTERN.test(clean(proof.databaseFingerprint))) {
    return { ok: false, reason: 'preflight_database_fingerprint_invalid' };
  }
  if (clean(proof.productDestinationType) !== 'UPLOAD_CLICKS') {
    return { ok: false, reason: 'preflight_destination_type_invalid' };
  }
  if (clean(proof.oauthScope) !== GOOGLE_DATA_MANAGER_SCOPE) {
    return { ok: false, reason: 'preflight_oauth_scope_invalid' };
  }
  if (clean(proof.operatingAccountId) !== clean(destination.operatingAccountId)) {
    return { ok: false, reason: 'preflight_account_mismatch' };
  }
  if (clean(proof.productDestinationId) !== clean(destination.productDestinationId)) {
    return { ok: false, reason: 'preflight_destination_mismatch' };
  }
  if (
    clean(proof.productDestinationType) !==
    clean(destination.productDestinationType || 'UPLOAD_CLICKS')
  ) {
    return { ok: false, reason: 'preflight_destination_type_mismatch' };
  }
  if (!verifiedIsoString(proof.verifiedAt))
    return { ok: false, reason: 'preflight_timestamp_invalid' };
  if (!runtimeTarget) return { ok: false, reason: 'preflight_runtime_target_missing' };
  const runtimeKeys = ['target', 'owner', 'databaseFingerprint', 'deploymentRef'] as const;
  if (runtimeKeys.some((key) => !clean(runtimeTarget[key]))) {
    return { ok: false, reason: 'preflight_runtime_target_incomplete' };
  }
  if (!SHA256_PATTERN.test(clean(runtimeTarget.databaseFingerprint))) {
    return { ok: false, reason: 'preflight_runtime_database_fingerprint_invalid' };
  }
  for (const key of runtimeKeys) {
    if (clean(proof[key]) !== clean(runtimeTarget[key])) {
      return { ok: false, reason: `preflight_${key}_mismatch` };
    }
  }
  return { ok: true };
}

export function sanitizeTransportCode(value: unknown): string {
  const code = clean(value);
  return SAFE_TRANSPORT_CODE_PATTERN.test(code) || code === 'UNKNOWN_TRANSPORT_ERROR'
    ? code
    : 'UNKNOWN_TRANSPORT_ERROR';
}

export function isRetryableDiagnosticCode(value: unknown): boolean {
  const code = sanitizeTransportCode(value);
  return (
    RETRYABLE_DIAGNOSTIC_CODES.has(code) ||
    /^GOOGLE_DM_(?:HTTP|OAUTH|UNEXPECTED)_5[0-9]{2}$/.test(code)
  );
}

export function sanitizeTransportWarnings(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((entry) => {
    if (!isRecord(entry)) return { code: 'GOOGLE_DM_FIELD_WARNING' };
    const fieldValue = clean(entry.field ?? entry.fieldPath ?? entry.field_path);
    const field = SAFE_WARNING_FIELDS.has(fieldValue) ? fieldValue : '';
    const reasonValue = clean(entry.reason ?? entry.code);
    const reason = SAFE_WARNING_REASONS.has(reasonValue) ? reasonValue : '';
    return {
      code: 'GOOGLE_DM_FIELD_WARNING',
      ...(field ? { field } : {}),
      ...(reason ? { reason } : {}),
    };
  });
}

export function sanitizeTransportDetail(value: unknown): string {
  return clean(value) ? OMITTED_TRANSPORT_DETAIL : '';
}

export function sanitizeDiagnosticCounts(
  value: unknown,
  kind: 'error' | 'warning'
): GoogleDataManagerDiagnosticCount[] {
  if (!Array.isArray(value)) return [];
  const reasons =
    kind === 'error' ? SAFE_PROCESSING_ERROR_REASONS : SAFE_PROCESSING_WARNING_REASONS;
  const prefix = kind === 'error' ? 'PROCESSING_ERROR_REASON_' : 'PROCESSING_WARNING_REASON_';
  const fallback = `${prefix}UNSPECIFIED`;
  return value.slice(0, 20).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const rawCount = entry.recordCount;
    const countText = typeof rawCount === 'number' ? String(rawCount) : clean(rawCount);
    if (!/^\d+$/.test(countText)) return [];
    const recordCount = Number(countText);
    if (!Number.isSafeInteger(recordCount)) return [];
    const rawReason = clean(entry.reason);
    const reason = reasons.has(rawReason) ? rawReason : fallback;
    return [{ reason, recordCount }];
  });
}
