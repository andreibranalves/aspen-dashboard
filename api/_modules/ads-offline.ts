import {
  buildOfflinePayload,
  isRetryableDiagnosticCode,
  selectOfflineOrder,
  sanitizeTransportDetail,
  sanitizeTransportCode,
  validateOfflinePreflight,
  type GoogleDataManagerPayload,
  type GoogleDataManagerTransport,
  type OfflineDestination,
  type OfflineOrderEvidence,
  type OfflineOrderSelection,
  type OfflinePreflightRuntimeTarget,
  type OfflineTransportError,
} from './ads-offline-core.js';
import {
  type OfflineExportRecord,
  type OfflineExportRepository,
  type OfflineExportClaim,
  type PrepareOfflineExportInput,
} from '../_infrastructure/db/repositories/sales-order-offline-export-repository.js';

export interface AdsOfflineReportRow {
  salesOrderId: string;
  orderNumber: string;
  orderStatus: string;
  category: string;
  reasons: string[];
  reviewReason: string | null;
  adIdentifierType: string | null;
  eventTimestamp: string | null;
  conversionValue: string | null;
  ledgerState: string | null;
}

export interface AdsOfflineReport {
  from: string;
  to: string;
  destination: 'configured' | 'unverified';
  preflightVerified: boolean;
  counts: Record<string, number>;
  rows: AdsOfflineReportRow[];
}

export interface AdsOfflineServiceOptions {
  repository: OfflineExportRepository;
  transport: GoogleDataManagerTransport;
  destination: OfflineDestination | null;
  now?: () => Date;
}

export interface AdsOfflineApplyInput {
  from: Date;
  to: Date;
  approvedOrderIds: ReadonlySet<string>;
  preflightProof: unknown;
  runtimeTarget: OfflinePreflightRuntimeTarget;
}

export interface AdsOfflineDiagnoseInput {
  exportId: string;
  preflightProof: unknown;
  runtimeTarget: OfflinePreflightRuntimeTarget;
}

export class AdsOfflinePreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdsOfflinePreflightError';
  }
}

function asDate(value: Date | string | null | undefined): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

function nowFrom(factory: () => Date): Date {
  return asDate(factory()) || new Date();
}

function selectionDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function reportRow(
  evidence: OfflineOrderEvidence,
  selection: OfflineOrderSelection,
  ledgerState: string | null = null
): AdsOfflineReportRow {
  return {
    salesOrderId: evidence.salesOrderId,
    orderNumber: evidence.orderNumber,
    orderStatus: evidence.status,
    category: selection.category,
    reasons: selection.reasons,
    reviewReason: selection.reviewReason,
    adIdentifierType: selection.adIdentifierType,
    eventTimestamp: selectionDate(selection.eventTimestamp),
    conversionValue: selection.conversionValue,
    ledgerState,
  };
}

function registeredRow(
  evidence: OfflineOrderEvidence,
  ledger: OfflineExportRecord
): AdsOfflineReportRow {
  return {
    salesOrderId: evidence.salesOrderId,
    orderNumber: evidence.orderNumber,
    orderStatus: evidence.status,
    category: 'already_registered',
    reasons: ['already_registered'],
    reviewReason: ledger.reviewReason,
    adIdentifierType: ledger.adIdentifierType,
    eventTimestamp: ledger.eventTimestamp.toISOString(),
    conversionValue: ledger.conversionValue,
    ledgerState: ledger.state,
  };
}

function countsFor(rows: AdsOfflineReportRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.category] = (counts[row.category] || 0) + 1;
    return counts;
  }, {});
}

function normalizeTransportError(error: unknown): OfflineTransportError {
  if (error && typeof error === 'object') {
    const value = error as Partial<OfflineTransportError>;
    if (
      (value.kind === 'permanent' || value.kind === 'transient' || value.kind === 'ambiguous') &&
      typeof value.code === 'string'
    ) {
      return {
        kind: value.kind,
        code: sanitizeTransportCode(value.code),
        detail: sanitizeTransportDetail(value.detail),
        ...(typeof value.httpStatus === 'number' ? { httpStatus: value.httpStatus } : {}),
      };
    }
  }
  return {
    kind: 'ambiguous',
    code: 'UNKNOWN_TRANSPORT_ERROR',
    detail: sanitizeTransportDetail('resultado do transporte não classificado'),
  };
}

function reportWithRows(
  from: Date,
  to: Date,
  destination: OfflineDestination | null,
  rows: AdsOfflineReportRow[],
  preflightVerified = false
): AdsOfflineReport {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    destination: destination ? 'configured' : 'unverified',
    preflightVerified,
    counts: countsFor(rows),
    rows,
  };
}

function prepareInput(
  evidence: OfflineOrderEvidence,
  selection: OfflineOrderSelection,
  payload: ReturnType<typeof buildOfflinePayload>,
  destination: OfflineDestination,
  now: Date
): PrepareOfflineExportInput {
  if (
    !evidence.quoteLeadId ||
    !evidence.originSource ||
    !selection.adIdentifierType ||
    !selection.adIdentifier ||
    !selection.eventTimestamp ||
    !selection.conversionValue ||
    !selection.consentEvidence
  ) {
    throw new AdsOfflinePreflightError('A seleção offline não contém evidência suficiente.');
  }
  return {
    salesOrderId: evidence.salesOrderId,
    quoteLeadId: evidence.quoteLeadId,
    originSource: evidence.originSource,
    eventTimestamp: selection.eventTimestamp,
    conversionValue: selection.conversionValue,
    adIdentifierType: selection.adIdentifierType,
    adIdentifier: selection.adIdentifier,
    consentEvidence: { ...selection.consentEvidence },
    payloadFingerprint: payload.payloadFingerprint,
    destinationAccountId: destination.operatingAccountId,
    destinationActionId: destination.productDestinationId,
    state: 'prepared',
    reviewReason: null,
    createdAt: now,
  };
}

function outputState(
  evidence: OfflineOrderEvidence,
  selection: OfflineOrderSelection,
  ledgerState: string | null,
  category = selection.category,
  reasons = selection.reasons
): AdsOfflineReportRow {
  return reportRow(evidence, { ...selection, category, reasons }, ledgerState);
}

export function createAdsOfflineService(options: AdsOfflineServiceOptions) {
  const nowFactory = options.now || (() => new Date());
  const { repository, transport, destination } = options;

  async function preview(input: {
    from: Date;
    to: Date;
    approvedOrderIds?: ReadonlySet<string>;
  }): Promise<AdsOfflineReport> {
    const from = asDate(input.from);
    const to = asDate(input.to);
    if (!from || !to || from >= to) throw new AdsOfflinePreflightError('Intervalo inválido.');
    const evidence = await repository.listOrderEvidence({ from, to });
    const now = nowFrom(nowFactory);
    const approvedOrderIds = input.approvedOrderIds || new Set<string>();
    const rows: AdsOfflineReportRow[] = [];
    for (const item of evidence) {
      const selection = selectOfflineOrder(item, { approvedOrderIds, now });
      if (destination) {
        const ledger = await repository.getByIdentity({
          salesOrderId: item.salesOrderId,
          destinationAccountId: destination.operatingAccountId,
          destinationActionId: destination.productDestinationId,
        });
        const currentOrderNeedsReview = selection.reasons.some(
          (reason) => reason !== 'reviewed_uuid_required'
        );
        if (ledger && (selection.status === 'eligible' || !currentOrderNeedsReview)) {
          rows.push(registeredRow(item, ledger));
          continue;
        }
        rows.push(reportRow(item, selection, ledger?.state || null));
        continue;
      }
      if (selection.status === 'eligible') {
        rows.push(
          outputState(item, selection, null, 'configuration_unverified', [
            ...selection.reasons,
            'configuration_unverified',
          ])
        );
      } else {
        rows.push(reportRow(item, selection));
      }
    }
    return reportWithRows(from, to, destination, rows);
  }

  async function apply(input: AdsOfflineApplyInput): Promise<AdsOfflineReport> {
    const from = asDate(input.from);
    const to = asDate(input.to);
    if (!from || !to || from >= to) throw new AdsOfflinePreflightError('Intervalo inválido.');
    if (!destination)
      throw new AdsOfflinePreflightError('Destino do Data Manager não configurado.');
    if (!input.approvedOrderIds || input.approvedOrderIds.size === 0) {
      throw new AdsOfflinePreflightError('Lista explícita de pedidos revisados é obrigatória.');
    }
    const proofCheck = validateOfflinePreflight(
      input.preflightProof,
      destination,
      input.runtimeTarget
    );
    if (!proofCheck.ok)
      throw new AdsOfflinePreflightError(`Preflight recusado: ${proofCheck.reason}.`);

    const now = nowFrom(nowFactory);
    await repository.recoverExpiredSending(now);
    const evidence = await repository.listOrderEvidence({ from, to });
    const rows: AdsOfflineReportRow[] = [];
    for (const item of evidence) {
      if (!input.approvedOrderIds.has(item.salesOrderId)) {
        const selection = selectOfflineOrder(item, { approvedOrderIds: new Set(), now });
        rows.push(
          outputState(item, selection, null, 'not_in_reviewed_allowlist', [
            'reviewed_uuid_required',
          ])
        );
        continue;
      }
      const selection = selectOfflineOrder(item, { approvedOrderIds: input.approvedOrderIds, now });
      let ledger = await repository.getByIdentity({
        salesOrderId: item.salesOrderId,
        destinationAccountId: destination.operatingAccountId,
        destinationActionId: destination.productDestinationId,
      });
      if (selection.status !== 'eligible') {
        if (ledger && selection.reasons.some((reason) => reason !== 'reviewed_uuid_required')) {
          const kind = selection.reasons.includes('status_cancelled')
            ? 'cancellation'
            : 'correction';
          const result = await repository.cancelOrReview({ exportId: ledger.id, kind, now });
          const reviewReason =
            result === 'needs_review'
              ? kind === 'cancellation'
                ? 'cancellation_after_attempt'
                : 'correction_after_attempt'
              : null;
          const category =
            result === 'needs_review'
              ? reviewReason!
              : kind === 'cancellation'
                ? 'cancelled_before_attempt'
                : selection.category;
          const current = result === 'missing' ? null : await repository.get(ledger.id);
          rows.push(
            reportRow(
              item,
              {
                ...selection,
                category,
                reasons: [...selection.reasons, ...(reviewReason ? [reviewReason] : [])],
                reviewReason,
              },
              current?.state || null
            )
          );
        } else {
          rows.push(reportRow(item, selection, ledger?.state || null));
        }
        continue;
      }
      const payload = buildOfflinePayload(
        {
          salesOrderId: item.salesOrderId,
          quoteLeadId: item.quoteLeadId!,
          originSource: item.originSource!,
          eventTimestamp: selection.eventTimestamp!,
          conversionValue: selection.conversionValue!,
          adIdentifierType: selection.adIdentifierType!,
          adIdentifier: selection.adIdentifier!,
          consentEvidence: selection.consentEvidence!,
        },
        destination
      );
      const snapshot = prepareInput(item, selection, payload, destination, now);
      if (!ledger) {
        ledger = await repository.prepare(snapshot);
      } else {
        const reconciliation = await repository.reconcileSnapshot({
          exportId: ledger.id,
          snapshot,
          now,
        });
        if (reconciliation === 'deleted') {
          ledger = await repository.prepare(snapshot);
        } else if (reconciliation === 'needs_review') {
          const current = await repository.get(ledger.id);
          rows.push(registeredRow(item, current || ledger));
          continue;
        }
      }
      if (
        ledger.state !== 'prepared' &&
        !(ledger.state === 'failed' && ledger.nextAttemptAt && ledger.nextAttemptAt <= now)
      ) {
        rows.push(registeredRow(item, ledger));
        continue;
      }
      const claim = await repository.claim(ledger.id, { now });
      if (!claim) {
        const current = await repository.get(ledger.id);
        rows.push(
          outputState(item, selection, current?.state || ledger.state, 'claim_not_available', [
            'claim_not_available',
          ])
        );
        continue;
      }
      rows.push(await sendClaim(item, selection, payload.payload, claim));
    }
    return reportWithRows(from, to, destination, rows, true);
  }

  async function sendClaim(
    evidence: OfflineOrderEvidence,
    selection: OfflineOrderSelection,
    payload: GoogleDataManagerPayload,
    claim: OfflineExportClaim
  ): Promise<AdsOfflineReportRow> {
    const now = nowFrom(nowFactory);
    try {
      const accepted = await transport.ingest(payload);
      const recorded = await repository.recordTransportOutcome({
        exportId: claim.export.id,
        attemptId: claim.attempt.id,
        leaseToken: claim.leaseToken,
        outcome: { kind: 'accepted', result: accepted },
        now,
      });
      return outputState(
        evidence,
        selection,
        recorded ? 'accepted_pending_diagnostic' : 'stale_worker_ignored',
        recorded ? 'accepted_pending_diagnostic' : 'stale_worker_ignored',
        recorded ? ['accepted_pending_diagnostic'] : ['stale_worker_ignored']
      );
    } catch (error) {
      const normalized = normalizeTransportError(error);
      const recorded = await repository.recordTransportOutcome({
        exportId: claim.export.id,
        attemptId: claim.attempt.id,
        leaseToken: claim.leaseToken,
        outcome: {
          kind: 'error',
          error: normalized,
          retryAt: normalized.kind === 'transient' ? new Date(now.getTime() + 60_000) : null,
        },
        now,
      });
      const state = recorded
        ? normalized.kind === 'ambiguous'
          ? 'needs_review'
          : 'failed'
        : 'stale_worker_ignored';
      return outputState(evidence, selection, state, state, [normalized.code]);
    }
  }

  async function diagnose(input: AdsOfflineDiagnoseInput): Promise<boolean> {
    if (!destination)
      throw new AdsOfflinePreflightError('Destino do Data Manager não configurado.');
    const proofCheck = validateOfflinePreflight(
      input.preflightProof,
      destination,
      input.runtimeTarget
    );
    if (!proofCheck.ok)
      throw new AdsOfflinePreflightError(`Preflight recusado: ${proofCheck.reason}.`);
    const ledger = await repository.get(input.exportId);
    const attempt = ledger ? await repository.getLatestAcceptedAttempt(input.exportId) : null;
    if (!attempt?.requestId) return false;
    const canRetryDiagnostic =
      ledger?.state === 'accepted_pending_diagnostic' ||
      (ledger?.state === 'needs_review' &&
        ledger.reviewReason === 'result_unknown' &&
        isRetryableDiagnosticCode(attempt.errorCode));
    if (!canRetryDiagnostic) return false;
    try {
      const result = await transport.retrieveStatus(attempt.requestId);
      return repository.recordDiagnostic({
        exportId: input.exportId,
        attemptId: attempt.id,
        requestId: attempt.requestId,
        result,
        checkedAt: nowFrom(nowFactory),
      });
    } catch (error) {
      const normalized = normalizeTransportError(error);
      return repository.recordDiagnosticError({
        exportId: input.exportId,
        attemptId: attempt.id,
        requestId: attempt.requestId,
        code: normalized.code,
        detail: normalized.detail,
        retryable: normalized.kind !== 'permanent' && isRetryableDiagnosticCode(normalized.code),
        checkedAt: nowFrom(nowFactory),
      });
    }
  }

  return { preview, apply, diagnose };
}
