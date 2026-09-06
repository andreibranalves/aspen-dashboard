import { createHash } from 'node:crypto';

import { canonicalizeNonNegativeDecimal } from '../_shared/decimal-money.js';

export const OFFLINE_EVENT_TYPE = 'pedido_iniciado' as const;
export const OFFLINE_CURRENCY = 'BRL' as const;
export const OFFLINE_EVENT_SOURCE = 'OTHER' as const;
export const GOOGLE_DATA_MANAGER_SCOPE = 'https://www.googleapis.com/auth/datamanager';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AD_IDENTIFIER_TYPES = ['gclid', 'wbraid', 'gbraid'] as const;

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
  const candidates = isAdIdentifierType(marker)
    ? [marker]
    : AD_IDENTIFIER_TYPES;
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
  options: { approvedOrderIds?: ReadonlySet<string>; allowTestMarker?: boolean } = {}
): OfflineOrderSelection {
  const approvedOrderIds = options.approvedOrderIds || new Set<string>();
  const reasons: string[] = [];
  if (evidence.status === 'Draft' || evidence.status === 'Cancelled') {
    return result('excluded', evidence.status === 'Draft' ? 'draft' : 'cancelled', [
      `status_${evidence.status.toLowerCase()}`,
    ]);
  }
  if (evidence.status === 'Closed') reasons.push('closed_status');
  else if (!['To Deliver and Bill', 'To Deliver', 'To Bill', 'Completed'].includes(evidence.status)) {
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
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('conversion value exceeds the safe API number range');
  }
  return Number(value);
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
  if (destination.productDestinationType && destination.productDestinationType !== 'UPLOAD_CLICKS') {
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
  destination: OfflineDestination
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
  if (required.some((key) => !clean(proof[key]))) return { ok: false, reason: 'preflight_incomplete' };
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
  if (!verifiedIsoString(proof.verifiedAt)) return { ok: false, reason: 'preflight_timestamp_invalid' };
  return { ok: true };
}

export function sanitizeTransportWarnings(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((entry) => {
    if (!isRecord(entry)) return { code: 'unknown_warning' };
    const field = clean(entry.field ?? entry.fieldPath ?? entry.field_path).slice(0, 128);
    const reason = clean(entry.reason ?? entry.code).slice(0, 128);
    return {
      ...(field ? { field } : {}),
      ...(reason ? { reason } : {}),
    };
  });
}

export function sanitizeTransportDetail(value: unknown): string {
  return clean(value).replace(/[\r\n\t]+/g, ' ').slice(0, 1000);
}
