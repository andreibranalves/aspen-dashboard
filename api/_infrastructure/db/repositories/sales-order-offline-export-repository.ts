import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gte, lt, lte, or } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import {
  quoteLeads,
  quoteRevisions,
  quotations,
  salesOrderOfflineExportAttempts,
  salesOrderOfflineExports,
  salesOrders,
} from '../schema.js';
import type {
  GoogleDataManagerDiagnosticResult,
  OfflineAttemptState,
  OfflineDiagnosticStatus,
  OfflineExportState,
  OfflineOrderEvidence,
  OfflinePayloadSnapshot,
  OfflineReviewReason,
  OfflineTransportAccepted,
  OfflineTransportError,
} from '../../../_modules/ads-offline-core.js';
import { sanitizeTransportDetail } from '../../../_modules/ads-offline-core.js';

type DatabaseProvider = () => AppDatabase;
export type OfflineExportRecord = typeof salesOrderOfflineExports.$inferSelect;
export type OfflineAttemptRecord = typeof salesOrderOfflineExportAttempts.$inferSelect;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

export interface OfflineExportIdentity {
  salesOrderId: string;
  eventType?: 'pedido_iniciado';
  destinationAccountId: string;
  destinationActionId: string;
}

export interface PrepareOfflineExportInput extends Omit<OfflinePayloadSnapshot, 'consentEvidence'> {
  consentEvidence: Record<string, unknown>;
  destinationAccountId: string;
  destinationActionId: string;
  payloadFingerprint: string;
  state: 'prepared' | 'needs_review';
  reviewReason?: OfflineReviewReason | null;
  createdAt?: Date;
}

export interface OfflineExportClaim {
  export: OfflineExportRecord;
  attempt: OfflineAttemptRecord;
  leaseToken: string;
}

export type TransportOutcome =
  | { kind: 'accepted'; result: OfflineTransportAccepted }
  | { kind: 'error'; error: OfflineTransportError; retryAt?: Date | null };

export interface RecordDiagnosticInput {
  exportId: string;
  attemptId: string;
  requestId: string;
  result: GoogleDataManagerDiagnosticResult;
  checkedAt?: Date;
}

export interface OfflineExportRepository {
  listOrderEvidence(input: { from: Date; to: Date }): Promise<OfflineOrderEvidence[]>;
  get(id: string): Promise<OfflineExportRecord | null>;
  getByIdentity(identity: OfflineExportIdentity): Promise<OfflineExportRecord | null>;
  getLatestAcceptedAttempt(exportId: string): Promise<OfflineAttemptRecord | null>;
  prepare(input: PrepareOfflineExportInput): Promise<OfflineExportRecord>;
  reconcileSnapshot(input: {
    exportId: string;
    snapshot: PrepareOfflineExportInput;
    now?: Date;
  }): Promise<'unchanged' | 'deleted' | 'needs_review'>;
  claim(id: string, input?: { now?: Date; leaseMs?: number }): Promise<OfflineExportClaim | null>;
  recordTransportOutcome(input: {
    exportId: string;
    attemptId: string;
    leaseToken: string;
    outcome: TransportOutcome;
    now?: Date;
  }): Promise<boolean>;
  recordDiagnostic(input: RecordDiagnosticInput): Promise<boolean>;
  recordDiagnosticError(input: {
    exportId: string;
    attemptId: string;
    requestId: string;
    code: string;
    detail?: string;
    checkedAt?: Date;
  }): Promise<boolean>;
  recoverExpiredSending(now?: Date): Promise<number>;
  cancelOrReview(input: {
    exportId: string;
    kind: 'cancellation' | 'correction' | 'substitution';
    now?: Date;
  }): Promise<'deleted' | 'needs_review' | 'missing'>;
}

export interface OfflineExportRepositoryOptions {
  now?: () => Date;
  idFactory?: () => string;
  leaseMs?: number;
  retryDelayMs?: number;
}

export class OfflineExportConflictError extends Error {
  constructor(message = 'O snapshot da exportação offline divergiu do registro existente.') {
    super(message);
    this.name = 'OfflineExportConflictError';
  }
}

export class OfflineExportRepositoryError extends Error {
  constructor(message = 'Não foi possível acessar o registro de exportação offline.') {
    super(message);
    this.name = 'OfflineExportRepositoryError';
  }
}

function asDate(value: Date | string | null | undefined): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

function requiredDate(value: Date | string | null | undefined): Date {
  const date = asDate(value);
  if (!date) throw new OfflineExportRepositoryError('Data inválida para exportação offline.');
  return date;
}

function requiredUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new OfflineExportRepositoryError(`${label} inválido.`);
  return value;
}

function safeCode(value: unknown): string {
  const code = String(value || '').trim().slice(0, 128);
  return HEX_CODE_PATTERN.test(code) ? code : 'UNKNOWN_TRANSPORT_ERROR';
}

function safeRequestId(value: unknown): string | null {
  const requestId = String(value || '').trim().slice(0, 255);
  return requestId || null;
}

function safeReviewReason(value: OfflineReviewReason | null | undefined): OfflineReviewReason | null {
  return value || null;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, item]) => [key, canonical(item)])
    );
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function originStatus(row: {
  quotationId: string | null;
  quotationQuoteLeadId: string | null;
  quoteLeadId: string | null;
  revisionQuotationId: string | null;
}): 'linked' | 'missing' | 'conflict' {
  if (row.revisionQuotationId && row.quotationId && row.revisionQuotationId !== row.quotationId) {
    return 'conflict';
  }
  if (!row.quotationId || !row.quotationQuoteLeadId || !row.quoteLeadId) return 'missing';
  return 'linked';
}

function lineageVerified(row: {
  quotationId: string | null;
  quotationQuoteLeadId: string | null;
  quoteLeadId: string | null;
  quotationRevisionId: string | null;
  revisionId: string | null;
  revisionQuotationId: string | null;
  quotationStatus: string | null;
  revisionStatus: string | null;
  originSource: string | null;
}): boolean {
  return Boolean(
    row.quotationId &&
      row.quotationQuoteLeadId &&
      row.quoteLeadId &&
      row.quotationQuoteLeadId === row.quoteLeadId &&
      row.quotationRevisionId &&
      row.revisionId === row.quotationRevisionId &&
      row.revisionQuotationId === row.quotationId &&
      row.quotationStatus === 'aprovado' &&
      row.revisionStatus === 'aprovado' &&
      row.originSource === 'site_form'
  );
}

function mapEvidence(row: {
  salesOrderId: string;
  orderNumber: string;
  status: string;
  quotationId: string | null;
  quotationRevisionId: string | null;
  quotationQuoteLeadId: string | null;
  quoteLeadId: string | null;
  originSource: string | null;
  revisionId: string | null;
  revisionQuotationId: string | null;
  quotationStatus: string | null;
  revisionStatus: string | null;
  total: string | number;
  createdAt: Date | string | null;
  attribution: unknown;
  raw: unknown;
}): OfflineOrderEvidence {
  return {
    salesOrderId: row.salesOrderId,
    orderNumber: row.orderNumber,
    status: row.status,
    quotationId: row.quotationId,
    quotationRevisionId: row.quotationRevisionId,
    quoteLeadId: row.quoteLeadId,
    originStatus: originStatus(row),
    originSource: row.originSource,
    revisionQuotationId: row.revisionQuotationId,
    quotationStatus: row.quotationStatus,
    revisionStatus: row.revisionStatus,
    total: row.total,
    createdAt: row.createdAt,
    attribution: row.attribution,
    raw: row.raw,
    lineageVerified: lineageVerified(row),
  };
}

function identityWhere(identity: OfflineExportIdentity) {
  return and(
    eq(salesOrderOfflineExports.salesOrderId, identity.salesOrderId),
    eq(salesOrderOfflineExports.eventType, identity.eventType || 'pedido_iniciado'),
    eq(salesOrderOfflineExports.destinationAccountId, identity.destinationAccountId),
    eq(salesOrderOfflineExports.destinationActionId, identity.destinationActionId)
  );
}

function immutableMatches(row: OfflineExportRecord, input: PrepareOfflineExportInput): boolean {
  const matches = [
    row.salesOrderId === input.salesOrderId,
    row.quoteLeadId === input.quoteLeadId,
    row.originSource === input.originSource,
    row.eventType === 'pedido_iniciado',
    row.destinationAccountId === input.destinationAccountId,
    row.destinationActionId === input.destinationActionId,
    row.transactionId === `aspen-pedido-iniciado:${input.salesOrderId}`,
    row.eventTimestamp.getTime() === requiredDate(input.eventTimestamp).getTime(),
    row.conversionValue === input.conversionValue,
    row.currency === 'BRL',
    row.eventSource === 'OTHER',
    row.adIdentifierType === input.adIdentifierType,
    row.adIdentifier === input.adIdentifier,
    jsonEqual(row.consentEvidence, input.consentEvidence),
    row.payloadFingerprint === input.payloadFingerprint,
  ];
  return matches.every(Boolean);
}

function attemptFinishedState(
  error: OfflineTransportError
): { attemptState: OfflineAttemptState; exportState: OfflineExportState; reviewReason: OfflineReviewReason | null } {
  if (error.kind === 'ambiguous') {
    return { attemptState: 'unknown', exportState: 'needs_review', reviewReason: 'result_unknown' };
  }
  return { attemptState: 'failed', exportState: 'failed', reviewReason: null };
}

function cancellationReason(kind: 'cancellation' | 'correction' | 'substitution'): OfflineReviewReason {
  if (kind === 'cancellation') return 'cancellation_after_attempt';
  if (kind === 'substitution') return 'substitution_after_attempt';
  return 'correction_after_attempt';
}

export function createPostgresSalesOrderOfflineExportRepository(
  getDb: DatabaseProvider = getDatabase,
  options: OfflineExportRepositoryOptions = {}
): OfflineExportRepository {
  const nowFactory = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;
  const leaseMs = options.leaseMs || 15 * 60 * 1000;
  const retryDelayMs = Math.min(Math.max(options.retryDelayMs || 60 * 1000, 1000), MAX_RETRY_DELAY_MS);

  const repository: OfflineExportRepository = {
    async listOrderEvidence({ from, to }) {
      const start = requiredDate(from);
      const end = requiredDate(to);
      if (start >= end) throw new OfflineExportRepositoryError('Intervalo inválido.');
      const rows = await getDb()
        .select({
          salesOrderId: salesOrders.id,
          orderNumber: salesOrders.orderNumber,
          status: salesOrders.status,
          quotationId: salesOrders.quotationId,
          quotationRevisionId: salesOrders.quotationRevisionId,
          quotationQuoteLeadId: quotations.quoteLeadId,
          quoteLeadId: quoteLeads.id,
          originSource: quoteLeads.source,
          revisionId: quoteRevisions.id,
          revisionQuotationId: quoteRevisions.quotationId,
          quotationStatus: quotations.status,
          revisionStatus: quoteRevisions.status,
          total: salesOrders.grandTotal,
          createdAt: salesOrders.createdAt,
          attribution: quoteLeads.attribution,
          raw: quoteLeads.raw,
        })
        .from(salesOrders)
        .leftJoin(quotations, eq(salesOrders.quotationId, quotations.id))
        .leftJoin(quoteRevisions, eq(salesOrders.quotationRevisionId, quoteRevisions.id))
        .leftJoin(quoteLeads, eq(quotations.quoteLeadId, quoteLeads.id))
        .where(and(gte(salesOrders.createdAt, start), lt(salesOrders.createdAt, end)))
        .orderBy(asc(salesOrders.createdAt), asc(salesOrders.id));
      return rows.map((row) => mapEvidence(row));
    },

    async get(id) {
      const [row] = await getDb()
        .select()
        .from(salesOrderOfflineExports)
        .where(eq(salesOrderOfflineExports.id, id))
        .limit(1);
      return row || null;
    },

    async getByIdentity(identity) {
      const [row] = await getDb()
        .select()
        .from(salesOrderOfflineExports)
        .where(identityWhere(identity))
        .limit(1);
      return row || null;
    },

    async getLatestAcceptedAttempt(exportId) {
      const [row] = await getDb()
        .select()
        .from(salesOrderOfflineExportAttempts)
        .where(
          and(
            eq(salesOrderOfflineExportAttempts.exportId, exportId),
            eq(salesOrderOfflineExportAttempts.attemptState, 'accepted')
          )
        )
        .orderBy(desc(salesOrderOfflineExportAttempts.attemptNo))
        .limit(1);
      return row || null;
    },

    async prepare(input) {
      const createdAt = requiredDate(input.createdAt || nowFactory());
      const eventTimestamp = requiredDate(input.eventTimestamp);
      const state = input.state;
      const reviewReason = safeReviewReason(input.reviewReason);
      if (state === 'needs_review' && !reviewReason) {
        throw new OfflineExportRepositoryError('Motivo da revisão offline é obrigatório.');
      }
      if (state === 'prepared' && reviewReason) {
        throw new OfflineExportRepositoryError('Exportação preparada não pode conter motivo de revisão.');
      }
      requiredUuid(input.salesOrderId, 'Pedido');
      requiredUuid(input.quoteLeadId, 'Lead');
      if (!input.destinationAccountId.trim() || !input.destinationActionId.trim()) {
        throw new OfflineExportRepositoryError('Destino da exportação offline é obrigatório.');
      }
      if (!/^[0-9a-f]{64}$/.test(input.payloadFingerprint)) {
        throw new OfflineExportRepositoryError('Fingerprint da exportação offline é inválida.');
      }
      return getDb().transaction(async (tx) => {
        const identity: OfflineExportIdentity = {
          salesOrderId: input.salesOrderId,
          destinationAccountId: input.destinationAccountId,
          destinationActionId: input.destinationActionId,
        };
        const [inserted] = await tx
          .insert(salesOrderOfflineExports)
          .values({
            id: requiredUuid(idFactory(), 'Exportação'),
            salesOrderId: input.salesOrderId,
            quoteLeadId: input.quoteLeadId,
            originSource: input.originSource,
            eventType: 'pedido_iniciado',
            destinationAccountId: input.destinationAccountId,
            destinationActionId: input.destinationActionId,
            transactionId: `aspen-pedido-iniciado:${input.salesOrderId}`,
            eventTimestamp,
            conversionValue: input.conversionValue,
            currency: 'BRL',
            eventSource: 'OTHER',
            adIdentifierType: input.adIdentifierType,
            adIdentifier: input.adIdentifier,
            consentEvidence: input.consentEvidence,
            payloadFingerprint: input.payloadFingerprint,
            state,
            reviewReason,
            nextAttemptAt: null,
            leaseToken: null,
            leaseUntil: null,
            createdAt,
            updatedAt: createdAt,
          })
          .onConflictDoNothing({
            target: [
              salesOrderOfflineExports.salesOrderId,
              salesOrderOfflineExports.eventType,
              salesOrderOfflineExports.destinationAccountId,
              salesOrderOfflineExports.destinationActionId,
            ],
          })
          .returning();
        if (inserted) return inserted;
        const [existing] = await tx
          .select()
          .from(salesOrderOfflineExports)
          .where(identityWhere(identity))
          .for('update')
          .limit(1);
        if (!existing) throw new OfflineExportRepositoryError();
        if (!immutableMatches(existing, input)) throw new OfflineExportConflictError();
        return existing;
      });
    },

    async reconcileSnapshot({ exportId, snapshot, now: inputNow }) {
      const now = requiredDate(inputNow || nowFactory());
      return getDb().transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(salesOrderOfflineExports)
          .where(eq(salesOrderOfflineExports.id, exportId))
          .for('update')
          .limit(1);
        if (!current) return 'deleted';
        if (immutableMatches(current, snapshot)) return 'unchanged';
        const [attempt] = await tx
          .select({ id: salesOrderOfflineExportAttempts.id })
          .from(salesOrderOfflineExportAttempts)
          .where(eq(salesOrderOfflineExportAttempts.exportId, exportId))
          .limit(1);
        if (!attempt) {
          await tx.delete(salesOrderOfflineExports).where(eq(salesOrderOfflineExports.id, exportId));
          return 'deleted';
        }
        await tx
          .update(salesOrderOfflineExports)
          .set({
            state: 'needs_review',
            reviewReason: 'correction_after_attempt',
            nextAttemptAt: null,
            leaseToken: null,
            leaseUntil: null,
            updatedAt: now,
          })
          .where(eq(salesOrderOfflineExports.id, exportId));
        return 'needs_review';
      });
    },

    async claim(id, input = {}) {
      const now = requiredDate(input.now || nowFactory());
      const duration = input.leaseMs || leaseMs;
      if (!Number.isInteger(duration) || duration < 1000 || duration > MAX_RETRY_DELAY_MS) {
        throw new OfflineExportRepositoryError('Lease da exportação offline é inválida.');
      }
      return getDb().transaction(async (tx) => {
        await tx
          .update(salesOrderOfflineExports)
          .set({
            state: 'needs_review',
            reviewReason: 'lease_expired_after_transport',
            leaseToken: null,
            leaseUntil: null,
            nextAttemptAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(salesOrderOfflineExports.id, id),
              eq(salesOrderOfflineExports.state, 'sending'),
              lte(salesOrderOfflineExports.leaseUntil, now)
            )
          );
        const leaseToken = requiredUuid(idFactory(), 'Lease');
        const leaseUntil = new Date(now.getTime() + duration);
        const [claimed] = await tx
          .update(salesOrderOfflineExports)
          .set({
            state: 'sending',
            reviewReason: null,
            nextAttemptAt: null,
            leaseToken,
            leaseUntil,
            updatedAt: now,
          })
          .where(
            and(
              eq(salesOrderOfflineExports.id, id),
              or(
                eq(salesOrderOfflineExports.state, 'prepared'),
                and(
                  eq(salesOrderOfflineExports.state, 'failed'),
                  lte(salesOrderOfflineExports.nextAttemptAt, now)
                )
              )
            )
          )
          .returning();
        if (!claimed) return null;
        const attemptId = requiredUuid(idFactory(), 'Tentativa');
        const correlationId = requiredUuid(idFactory(), 'Correlação');
        const [previous] = await tx
          .select({ attemptNo: salesOrderOfflineExportAttempts.attemptNo })
          .from(salesOrderOfflineExportAttempts)
          .where(eq(salesOrderOfflineExportAttempts.exportId, id))
          .orderBy(desc(salesOrderOfflineExportAttempts.attemptNo))
          .limit(1);
        const [attempt] = await tx
          .insert(salesOrderOfflineExportAttempts)
          .values({
            id: attemptId,
            exportId: id,
            attemptNo: (previous?.attemptNo || 0) + 1,
            correlationId,
            attemptState: 'started',
            startedAt: now,
          })
          .returning();
        if (!attempt) throw new OfflineExportRepositoryError();
        return { export: claimed, attempt, leaseToken };
      });
    },

    async recordTransportOutcome({ exportId, attemptId, leaseToken, outcome, now: inputNow }) {
      const now = requiredDate(inputNow || nowFactory());
      return getDb().transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(salesOrderOfflineExports)
          .where(
            and(
              eq(salesOrderOfflineExports.id, exportId),
              eq(salesOrderOfflineExports.state, 'sending'),
              eq(salesOrderOfflineExports.leaseToken, leaseToken)
            )
          )
          .for('update')
          .limit(1);
        if (!current) return false;
        const [attempt] = await tx
          .select()
          .from(salesOrderOfflineExportAttempts)
          .where(
            and(
              eq(salesOrderOfflineExportAttempts.id, attemptId),
              eq(salesOrderOfflineExportAttempts.exportId, exportId),
              eq(salesOrderOfflineExportAttempts.attemptState, 'started')
            )
          )
          .for('update')
          .limit(1);
        if (!attempt) return false;

        if (outcome.kind === 'accepted') {
          const requestId = safeRequestId(outcome.result.requestId);
          if (!requestId || outcome.result.httpStatus !== 200) {
            throw new OfflineExportRepositoryError('Resposta de aceite offline inválida.');
          }
          await tx
            .update(salesOrderOfflineExportAttempts)
            .set({
              attemptState: 'accepted',
              finishedAt: now,
              requestId,
              httpStatus: 200,
              fieldWarnings: outcome.result.fieldWarnings,
            })
            .where(eq(salesOrderOfflineExportAttempts.id, attemptId));
          await tx
            .update(salesOrderOfflineExports)
            .set({
              state: 'accepted_pending_diagnostic',
              reviewReason: null,
              nextAttemptAt: null,
              leaseToken: null,
              leaseUntil: null,
              updatedAt: now,
            })
            .where(eq(salesOrderOfflineExports.id, exportId));
          return true;
        }

        const finalState = attemptFinishedState(outcome.error);
        const retryAt =
          outcome.error.kind === 'transient'
            ? requiredDate(outcome.retryAt || new Date(now.getTime() + retryDelayMs))
            : null;
        await tx
          .update(salesOrderOfflineExportAttempts)
          .set({
            attemptState: finalState.attemptState,
            finishedAt: now,
            httpStatus:
              outcome.error.httpStatus && outcome.error.httpStatus >= 100 && outcome.error.httpStatus <= 599
                ? outcome.error.httpStatus
                : null,
            errorCode: safeCode(outcome.error.code),
            errorDetail: sanitizeTransportDetail(outcome.error.detail),
          })
          .where(eq(salesOrderOfflineExportAttempts.id, attemptId));
        await tx
          .update(salesOrderOfflineExports)
          .set({
            state: finalState.exportState,
            reviewReason: finalState.reviewReason,
            nextAttemptAt: retryAt,
            leaseToken: null,
            leaseUntil: null,
            updatedAt: now,
          })
          .where(eq(salesOrderOfflineExports.id, exportId));
        return true;
      });
    },

    async recordDiagnostic({ exportId, attemptId, requestId, result, checkedAt: inputCheckedAt }) {
      const checkedAt = requiredDate(inputCheckedAt || nowFactory());
      const normalizedRequestId = safeRequestId(requestId);
      if (!normalizedRequestId) return false;
      return getDb().transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(salesOrderOfflineExports)
          .where(
            and(
              eq(salesOrderOfflineExports.id, exportId),
              eq(salesOrderOfflineExports.state, 'accepted_pending_diagnostic')
            )
          )
          .for('update')
          .limit(1);
        if (!current) return false;
        const [attempt] = await tx
          .select()
          .from(salesOrderOfflineExportAttempts)
          .where(
            and(
              eq(salesOrderOfflineExportAttempts.id, attemptId),
              eq(salesOrderOfflineExportAttempts.exportId, exportId),
              eq(salesOrderOfflineExportAttempts.attemptState, 'accepted'),
              eq(salesOrderOfflineExportAttempts.requestId, normalizedRequestId)
            )
          )
          .for('update')
          .limit(1);
        if (!attempt) return false;
        const diagnosticStatus: OfflineDiagnosticStatus = result.status;
        const nextState: OfflineExportState =
          diagnosticStatus === 'success'
            ? 'processed'
            : diagnosticStatus === 'partial_success'
              ? 'needs_review'
              : diagnosticStatus === 'failure'
                ? 'failed'
                : 'accepted_pending_diagnostic';
        const reviewReason: OfflineReviewReason | null =
          diagnosticStatus === 'partial_success' ? 'diagnostic_partial_success' : null;
        await tx
          .update(salesOrderOfflineExportAttempts)
          .set({ diagnosticStatus, diagnosticCheckedAt: checkedAt })
          .where(eq(salesOrderOfflineExportAttempts.id, attemptId));
        await tx
          .update(salesOrderOfflineExports)
          .set({ state: nextState, reviewReason, updatedAt: checkedAt })
          .where(eq(salesOrderOfflineExports.id, exportId));
        return true;
      });
    },

    async recordDiagnosticError({ exportId, attemptId, requestId, code, detail, checkedAt: inputCheckedAt }) {
      const checkedAt = requiredDate(inputCheckedAt || nowFactory());
      const normalizedRequestId = safeRequestId(requestId);
      if (!normalizedRequestId) return false;
      return getDb().transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(salesOrderOfflineExports)
          .where(
            and(
              eq(salesOrderOfflineExports.id, exportId),
              eq(salesOrderOfflineExports.state, 'accepted_pending_diagnostic')
            )
          )
          .for('update')
          .limit(1);
        if (!current) return false;
        const [attempt] = await tx
          .select()
          .from(salesOrderOfflineExportAttempts)
          .where(
            and(
              eq(salesOrderOfflineExportAttempts.id, attemptId),
              eq(salesOrderOfflineExportAttempts.exportId, exportId),
              eq(salesOrderOfflineExportAttempts.attemptState, 'accepted'),
              eq(salesOrderOfflineExportAttempts.requestId, normalizedRequestId)
            )
          )
          .for('update')
          .limit(1);
        if (!attempt) return false;
        await tx
          .update(salesOrderOfflineExportAttempts)
          .set({
            errorCode: safeCode(code),
            errorDetail: sanitizeTransportDetail(detail),
          })
          .where(eq(salesOrderOfflineExportAttempts.id, attemptId));
        await tx
          .update(salesOrderOfflineExports)
          .set({
            state: 'needs_review',
            reviewReason: 'result_unknown',
            updatedAt: checkedAt,
          })
          .where(eq(salesOrderOfflineExports.id, exportId));
        return true;
      });
    },

    async recoverExpiredSending(inputNow) {
      const now = requiredDate(inputNow || nowFactory());
      const rows = await getDb()
        .update(salesOrderOfflineExports)
        .set({
          state: 'needs_review',
          reviewReason: 'lease_expired_after_transport',
          nextAttemptAt: null,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(and(eq(salesOrderOfflineExports.state, 'sending'), lte(salesOrderOfflineExports.leaseUntil, now)))
        .returning({ id: salesOrderOfflineExports.id });
      return rows.length;
    },

    async cancelOrReview({ exportId, kind, now: inputNow }) {
      const now = requiredDate(inputNow || nowFactory());
      return getDb().transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(salesOrderOfflineExports)
          .where(eq(salesOrderOfflineExports.id, exportId))
          .for('update')
          .limit(1);
        if (!current) return 'missing';
        const [attempt] = await tx
          .select({ id: salesOrderOfflineExportAttempts.id })
          .from(salesOrderOfflineExportAttempts)
          .where(eq(salesOrderOfflineExportAttempts.exportId, exportId))
          .limit(1);
        if (!attempt) {
          await tx.delete(salesOrderOfflineExports).where(eq(salesOrderOfflineExports.id, exportId));
          return 'deleted';
        }
        await tx
          .update(salesOrderOfflineExports)
          .set({
            state: 'needs_review',
            reviewReason: cancellationReason(kind),
            nextAttemptAt: null,
            leaseToken: null,
            leaseUntil: null,
            updatedAt: now,
          })
          .where(eq(salesOrderOfflineExports.id, exportId));
        return 'needs_review';
      });
    },
  };
  return repository;
}

export const createSalesOrderOfflineExportRepository = createPostgresSalesOrderOfflineExportRepository;
