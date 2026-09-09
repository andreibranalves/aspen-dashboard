import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { quoteRevisions, quotationDeliveries } from '../schema.js';
import { canonicalQuotationStatus, isIssuedQuotationStatus } from '../../../_modules/quotation-status.js';
import {
  renderQuotationDocument,
  type QuotationDocumentRenderer,
} from '../../../_modules/quotation-document.js';
import {
  renderQuotationPdf,
  renderQuotationWebpHtml,
} from '../../../_modules/quotation-pdf-renderer.js';
import { readQuotationTemplateSnapshot } from './quotation-template-repository.js';
import {
  isValidPdfBuffer,
  isValidWebpBuffer,
  MAX_QUOTATION_PDF_BYTES,
  MAX_QUOTATION_WEBP_BYTES,
  quotationPdfChecksum,
  quotationWebpChecksum,
} from '../../../_modules/quotation-document-storage.js';
import { normalizeWhatsappPhone } from '../../../_modules/whatsapp-conversations-store.js';
import type { TransportFailureKind } from '../../../_modules/quotation-delivery-state.js';

type DatabaseProvider = () => AppDatabase;
type DeliveryDatabase = AppDatabase | Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESUMABLE_DAYS = 30;
const DIAGNOSTIC_DAYS = 90;
const DELIVERY_STATES = ['pending', 'transporting', 'accepted_partial', 'completed', 'retryable', 'reconciling'] as const;
export type QuotationDeliveryState = (typeof DELIVERY_STATES)[number];

export function canRecordQuotationDeliveryState(from: QuotationDeliveryState, to: QuotationDeliveryState): boolean {
  if (from === 'completed') return to === 'completed';
  if (from === 'reconciling') return to === 'reconciling' || to === 'completed' || to === 'retryable';
  if (from === 'transporting' || from === 'accepted_partial') {
    return to === 'transporting' || to === 'accepted_partial' || to === 'completed' || to === 'reconciling';
  }
  return true;
}

function blocksTransport(state: QuotationDeliveryState): boolean {
  return state === 'completed' || state === 'reconciling' || state === 'transporting' || state === 'accepted_partial';
}

function storageDeliveryState(state: QuotationDeliveryState): string {
  if (state === 'pending') return 'queued';
  if (state === 'transporting') return 'processing';
  if (state === 'accepted_partial') return 'provider_accepted';
  if (state === 'completed') return 'delivered';
  if (state === 'retryable') return 'retry_scheduled';
  return state;
}

function legacyDeliveryState(value: unknown): QuotationDeliveryState {
  if (value === 'queued') return 'pending';
  if (value === 'processing') return 'transporting';
  if (value === 'provider_accepted') return 'accepted_partial';
  if (value === 'delivered') return 'completed';
  if (value === 'retry_scheduled' || value === 'failed') return 'retryable';
  if (value === 'needs_review') return 'reconciling';
  if (DELIVERY_STATES.includes(value as QuotationDeliveryState)) return value as QuotationDeliveryState;
  throw new QuotationDeliveryRepositoryError();
}

export class QuotationDeliveryInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = 'QuotationDeliveryInputError'; }
}

export class QuotationDeliveryConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) { super(message); this.name = 'QuotationDeliveryConflictError'; }
}

export class QuotationDeliveryNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = 'Revisão do orçamento não encontrada.') { super(message); this.name = 'QuotationDeliveryNotFoundError'; }
}

export class QuotationDeliveryRepositoryError extends Error {
  readonly statusCode = 503;
  constructor(message = 'Não foi possível preparar a entrega do orçamento. Tente novamente.') { super(message); this.name = 'QuotationDeliveryRepositoryError'; }
}

export class QuotationDeliveryPdfError extends QuotationDeliveryRepositoryError {
  constructor(message = 'Não foi possível gerar o PDF da revisão. Tente novamente.') { super(message); this.name = 'QuotationDeliveryPdfError'; }
}

export class QuotationDeliveryImageError extends QuotationDeliveryRepositoryError {
  constructor(message = 'Não foi possível gerar a imagem da revisão. Tente novamente.') { super(message); this.name = 'QuotationDeliveryImageError'; }
}

export interface QuotationDelivery {
  id: string;
  revisionId: string;
  phone: string;
  flowId: string;
  state: QuotationDeliveryState;
  providerAcceptanceId: string | null;
  publicError: string | null;
  diagnosticsExpiresAt: Date;
  resumableUntil: Date;
  createdAt: Date;
  updatedAt: Date;
  readOnly: boolean;
}

export interface ReserveQuotationDeliveryInput {
  revisionId: string;
  phone: string;
  flowId: string;
}

export interface RecordQuotationDeliveryStateInput {
  revisionId: string;
  flowId?: unknown;
  flow_id?: unknown;
  failureKind?: TransportFailureKind;
  state: QuotationDeliveryState;
  providerAcceptanceId?: unknown;
  provider_acceptance_id?: unknown;
  publicError?: unknown;
  public_error?: unknown;
}

export interface PrepareQuotationDeliveryInput extends ReserveQuotationDeliveryInput {
  maxPdfBytes?: number;
}

export interface QuotationDeliveryRepository {
  reserve(input: ReserveQuotationDeliveryInput): Promise<QuotationDelivery>;
  reserveDelivery(input: ReserveQuotationDeliveryInput): Promise<QuotationDelivery>;
  recordState(input: RecordQuotationDeliveryStateInput): Promise<QuotationDelivery>;
  recordDeliveryState(input: RecordQuotationDeliveryStateInput): Promise<QuotationDelivery>;
  claimTransport(revisionId: string, flowId?: string): Promise<QuotationDelivery | null>;
  getByRevision(revisionId: string, flowId?: string): Promise<QuotationDelivery | null>;
  readDeliveryByRevision(revisionId: string, flowId?: string): Promise<QuotationDelivery | null>;
  prepareDeliveryDocument(revisionId: string): Promise<PreparedDeliveryDocument>;
  prepareDeliveryImages(revisionId: string): Promise<PreparedDeliveryImage[]>;
  prepareDelivery(input: PrepareQuotationDeliveryInput): Promise<PreparedQuotationDelivery>;
  prepareQuotationDelivery(input: PrepareQuotationDeliveryInput): Promise<PreparedQuotationDelivery>;
}

export interface PreparedDeliveryDocument {
  pdf: Buffer;
  pdfSize: number;
  pdfSignature: string;
  validUntil: Date;
}

export interface PreparedDeliveryImage {
  webp: Buffer;
  webpSize: number;
  webpSignature: string;
  page: number;
  pageCount: number;
  validUntil: Date;
}

export interface PreparedQuotationDelivery extends PreparedDeliveryDocument {
  delivery: QuotationDelivery;
}

export interface QuotationDeliveryRepositoryOptions {
  now?: () => Date;
  randomId?: () => string;
  renderPdf?: (html: string) => Promise<Buffer>;
  renderDocument?: QuotationDocumentRenderer;
  maxPdfBytes?: number;
  beforeStateUpdate?: () => Promise<void>;
}

function asDate(value: Date | string | null | undefined, fallback: Date): Date {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? new Date(fallback) : new Date(date.getTime());
}

function uuid(value: unknown, label: string): string {
  const result = String(value || '').trim();
  if (!UUID.test(result)) throw new QuotationDeliveryInputError(`${label} inválido.`);
  return result;
}

function phone(value: unknown): string {
  const result = normalizeWhatsappPhone(value);
  if (!result) throw new QuotationDeliveryInputError('Telefone do destinatário inválido.');
  return result;
}

function stripControlCharacters(value: string, replacement = ''): string {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? replacement : character;
  }).join('');
}

function flow(value: unknown): string {
  const result = String(value || '').trim();
  if (!result || result.length > 120 || stripControlCharacters(result) !== result) {
    throw new QuotationDeliveryInputError('Fluxo de entrega inválido.');
  }
  return result;
}

function safePublicError(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new QuotationDeliveryInputError('Erro público inválido.');
  const result = stripControlCharacters(value, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  return result || null;
}

function safeAcceptanceId(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new QuotationDeliveryInputError('Identificador de aceitação inválido.');
  const result = stripControlCharacters(value).trim().slice(0, 255);
  if (result && !/^[A-Za-z0-9._:-]+$/.test(result)) throw new QuotationDeliveryInputError('Identificador de aceitação inválido.');
  return result || null;
}

function validUntil(revision: typeof quoteRevisions.$inferSelect): Date {
  const issuedAt = revision.issuedAt || revision.createdAt;
  const result = asDate(issuedAt, new Date(0));
  result.setUTCDate(result.getUTCDate() + revision.validadeDias);
  return result;
}

function retention(now: Date, days: number): Date {
  const result = new Date(now.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function validPdfLimit(value: unknown, fallback: number, rejectInvalid = false): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_QUOTATION_PDF_BYTES) {
    if (rejectInvalid) throw new QuotationDeliveryInputError('Limite de PDF inválido.');
    return fallback;
  }
  return value;
}

function isKnownError(error: unknown): boolean {
  return error instanceof QuotationDeliveryInputError
    || error instanceof QuotationDeliveryConflictError
    || error instanceof QuotationDeliveryNotFoundError
    || error instanceof QuotationDeliveryRepositoryError;
}

function toDelivery(row: typeof quotationDeliveries.$inferSelect, now: Date): QuotationDelivery {
  const resumableUntil = asDate(row.resumableUntil, retention(now, RESUMABLE_DAYS));
  const state = legacyDeliveryState(row.state);
  const readOnly = now.getTime() >= resumableUntil.getTime() && state !== 'completed';
  const diagnosticsExpiresAt = asDate(row.diagnosticsExpiresAt, retention(now, DIAGNOSTIC_DAYS));
  return {
    id: row.id,
    revisionId: row.revisionId,
    phone: row.phone,
    flowId: row.flowId,
    state,
    providerAcceptanceId: row.providerAcceptanceId || null,
    publicError: now.getTime() >= diagnosticsExpiresAt.getTime() ? null : row.publicError || null,
    diagnosticsExpiresAt,
    resumableUntil,
    createdAt: asDate(row.createdAt, now),
    updatedAt: asDate(row.updatedAt, now),
    readOnly,
  };
}

async function readRow(db: DeliveryDatabase, revisionId: string, flowId?: string) {
  const where = flowId
    ? and(eq(quotationDeliveries.revisionId, revisionId), eq(quotationDeliveries.flowId, flowId))
    : eq(quotationDeliveries.revisionId, revisionId);
  const rows = await db.select().from(quotationDeliveries).where(where).limit(flowId ? 1 : 2);
  if (!flowId && rows.length > 1) {
    throw new QuotationDeliveryConflictError('O fluxo da entrega é obrigatório quando a revisão possui mais de uma entrega.');
  }
  return rows[0] || null;
}

async function assertEmittedRevision(db: DeliveryDatabase, revisionId: string, now: Date) {
  const [revision] = await db.select().from(quoteRevisions)
    .where(eq(quoteRevisions.id, revisionId)).limit(1);
  if (!revision) throw new QuotationDeliveryNotFoundError();
  let status: ReturnType<typeof canonicalQuotationStatus>;
  try { status = canonicalQuotationStatus(revision.status); } catch { throw new QuotationDeliveryConflictError('A revisão do orçamento possui estado inválido.'); }
  if (!isIssuedQuotationStatus(status)) throw new QuotationDeliveryConflictError('Somente revisões emitidas podem ser entregues.');
  if (now.getTime() >= validUntil(revision).getTime()) throw new QuotationDeliveryConflictError('A revisão do orçamento está vencida. Emita uma nova revisão.');
  return revision;
}

async function reserveInDatabase(
  db: DeliveryDatabase,
  input: ReserveQuotationDeliveryInput,
  now: Date,
  randomId: () => string,
): Promise<QuotationDelivery> {
  const revisionId = uuid(input.revisionId, 'Identificador da revisão');
  const normalizedPhone = phone(input.phone);
  const normalizedFlow = flow(input.flowId);
  await db.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${revisionId}, 0))
  `);
  await assertEmittedRevision(db, revisionId, now);
  const existing = await readRow(db, revisionId);
  if (existing) {
    if (existing.phone !== normalizedPhone || existing.flowId !== normalizedFlow) {
      throw new QuotationDeliveryConflictError(
        'A revisão já possui uma entrega. Para alterar o destinatário ou fluxo, crie uma nova revisão.'
      );
    }
    return toDelivery(existing, now);
  }
  const id = randomId();
  if (!UUID.test(id)) throw new QuotationDeliveryRepositoryError();
  const [inserted] = await db.insert(quotationDeliveries).values({
    id,
    revisionId,
    phone: normalizedPhone,
    flowId: normalizedFlow,
    flowName: normalizedFlow,
    state: 'queued',
    providerAcceptanceId: null,
    publicError: null,
    diagnosticsExpiresAt: retention(now, DIAGNOSTIC_DAYS),
    resumableUntil: retention(now, RESUMABLE_DAYS),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: [quotationDeliveries.revisionId, quotationDeliveries.flowId] }).returning();
  const row = inserted || await readRow(db, revisionId, normalizedFlow);
  if (!row) throw new QuotationDeliveryRepositoryError();
  if (row.phone !== normalizedPhone || row.flowId !== normalizedFlow) {
    throw new QuotationDeliveryConflictError('A revisão já possui uma entrega. Para alterar o destinatário ou fluxo, crie uma nova revisão.');
  }
  return toDelivery(row, now);
}

export function createPostgresQuotationDeliveryRepository(
  getDb: DatabaseProvider = getDatabase,
  options: QuotationDeliveryRepositoryOptions = {},
): QuotationDeliveryRepository {
  const now = options.now || (() => new Date());
  const randomId = options.randomId || randomUUID;
  const renderPdf = options.renderPdf || renderQuotationPdf;
  const renderDocument = options.renderDocument || renderQuotationDocument;
  const maxPdfBytes = validPdfLimit(options.maxPdfBytes, MAX_QUOTATION_PDF_BYTES);

  async function reserve(input: ReserveQuotationDeliveryInput): Promise<QuotationDelivery> {
    try { return await getDb().transaction((tx) => reserveInDatabase(tx, input, asDate(now(), new Date()), randomId)); }
    catch (error) {
      if (isKnownError(error)) throw error;
      console.error(`[quotation-delivery] reserve failed (${error instanceof Error ? error.name : typeof error})`);
      throw new QuotationDeliveryRepositoryError();
    }
  }

  async function recordState(input: RecordQuotationDeliveryStateInput): Promise<QuotationDelivery> {
    const revisionId = uuid(input?.revisionId, 'Identificador da revisão');
    const flowIdInput = input.flowId ?? input.flow_id;
    const flowId = flowIdInput === undefined ? undefined : flow(flowIdInput);
    if (input.failureKind !== undefined && !['transient_pre_transport', 'permanent_pre_transport', 'ambiguous'].includes(input.failureKind)) {
      throw new QuotationDeliveryInputError('Tipo de falha do transporte inválido.');
    }
    if (!DELIVERY_STATES.includes(input?.state)) throw new QuotationDeliveryInputError('Estado de entrega inválido.');
    const providerAcceptanceId = safeAcceptanceId(input.providerAcceptanceId ?? input.provider_acceptance_id);
    const publicError = safePublicError(input.publicError ?? input.public_error);
    const current = asDate(now(), new Date());
    try {
      return await getDb().transaction(async (tx) => {
        const row = await readRow(tx, revisionId, flowId);
        if (!row) throw new QuotationDeliveryNotFoundError('Entrega da revisão não encontrada.');
        const currentDelivery = toDelivery(row, current);
        if (currentDelivery.readOnly) throw new QuotationDeliveryConflictError('O prazo de retomada desta entrega expirou. Crie uma nova revisão.');
        const safePreTransportRetry = currentDelivery.state === 'transporting'
          && input.state === 'retryable'
          && (input.failureKind === 'transient_pre_transport' || input.failureKind === 'permanent_pre_transport');
        if (!canRecordQuotationDeliveryState(currentDelivery.state, input.state) && !safePreTransportRetry) {
          throw new QuotationDeliveryConflictError('O estado durável desta entrega bloqueia nova tentativa de transporte. Consulte a entrega antes de continuar.');
        }
        if (options.beforeStateUpdate) await options.beforeStateUpdate();
        const affected = await tx.update(quotationDeliveries).set({
          state: storageDeliveryState(input.state),
          providerAcceptanceId: providerAcceptanceId ?? row.providerAcceptanceId,
          publicError,
          deliveredAt: input.state === 'completed' ? current : undefined,
          updatedAt: current,
        }).where(and(
          eq(quotationDeliveries.revisionId, revisionId),
          eq(quotationDeliveries.flowId, row.flowId),
          eq(quotationDeliveries.updatedAt, row.updatedAt),
        )).returning({ id: quotationDeliveries.id });
        if (affected.length !== 1) throw new QuotationDeliveryConflictError('A entrega foi alterada por outra tentativa. Consulte o estado atual.');
        const updated = await readRow(tx, revisionId, row.flowId);
        if (!updated) throw new QuotationDeliveryRepositoryError();
        return toDelivery(updated, current);
      });
    } catch (error) {
      if (isKnownError(error)) throw error;
      console.error(`[quotation-delivery] state failed (${error instanceof Error ? error.name : typeof error})`);
      throw new QuotationDeliveryRepositoryError();
    }
  }

  async function claimTransport(revisionIdInput: string, flowIdInput?: string): Promise<QuotationDelivery | null> {
    const revisionId = uuid(revisionIdInput, 'Identificador da revisão');
    const flowId = flowIdInput === undefined ? undefined : flow(flowIdInput);
    const current = asDate(now(), new Date());
    try {
      return await getDb().transaction(async (tx) => {
        const row = await readRow(tx, revisionId, flowId);
        if (!row) return null;
        const delivery = toDelivery(row, current);
        if (delivery.readOnly || blocksTransport(delivery.state)) return null;
        const [claimed] = await tx.update(quotationDeliveries).set({ state: 'processing', updatedAt: current })
          .where(and(
            eq(quotationDeliveries.revisionId, revisionId),
            eq(quotationDeliveries.flowId, row.flowId),
            eq(quotationDeliveries.updatedAt, row.updatedAt),
            inArray(quotationDeliveries.state, ['queued', 'retry_scheduled']),
          )).returning();
        return claimed ? toDelivery(claimed, current) : null;
      });
    } catch (error) {
      if (isKnownError(error)) throw error;
      throw new QuotationDeliveryRepositoryError();
    }
  }

  async function getByRevision(revisionIdInput: string, flowIdInput?: string): Promise<QuotationDelivery | null> {
    const revisionId = uuid(revisionIdInput, 'Identificador da revisão');
    const flowId = flowIdInput === undefined ? undefined : flow(flowIdInput);
    const current = asDate(now(), new Date());
    try {
      return await getDb().transaction(async (tx) => {
        const row = await readRow(tx, revisionId, flowId);
        if (!row) return null;
        if (row.publicError && row.diagnosticsExpiresAt && current.getTime() >= asDate(row.diagnosticsExpiresAt, current).getTime()) {
          await tx.update(quotationDeliveries).set({ publicError: null, updatedAt: row.updatedAt }).where(and(
            eq(quotationDeliveries.id, row.id),
            eq(quotationDeliveries.revisionId, revisionId),
            eq(quotationDeliveries.flowId, row.flowId),
          ));
          row.publicError = null;
        }
        return toDelivery(row, current);
      });
    } catch (error) {
      if (isKnownError(error)) throw error;
      console.error(`[quotation-delivery] read failed (${error instanceof Error ? error.name : typeof error})`);
      throw new QuotationDeliveryRepositoryError();
    }
  }

  async function loadDeliveryQuotation(
    revisionId: string,
    current: Date,
  ): Promise<{ revision: typeof quoteRevisions.$inferSelect; html: string }> {
    try {
      const snapshot = await readQuotationTemplateSnapshot(getDb(), revisionId);
      if (!snapshot || snapshot.revision.id !== revisionId) {
        throw new QuotationDeliveryNotFoundError();
      }
      const { revision } = snapshot;
      let status: ReturnType<typeof canonicalQuotationStatus>;
      try { status = canonicalQuotationStatus(revision.status); }
      catch { throw new QuotationDeliveryConflictError('A revisão do orçamento possui estado inválido.'); }
      if (!isIssuedQuotationStatus(status)) throw new QuotationDeliveryConflictError('Somente revisões emitidas podem ser entregues.');
      if (current.getTime() >= validUntil(revision).getTime()) {
        throw new QuotationDeliveryConflictError('A revisão do orçamento está vencida. Emita uma nova revisão.');
      }
      if (
        revision.templateVersionId &&
        (!snapshot.templateVersion || snapshot.templateVersion.sourceHash !== revision.templateHash)
      ) {
        throw new QuotationDeliveryConflictError('O snapshot do template da revisão não está disponível.');
      }
      return { revision, html: renderDocument(snapshot).html };
    } catch (error) {
      if (isKnownError(error)) throw error;
      throw new QuotationDeliveryRepositoryError();
    }
  }

  async function prepareDeliveryDocumentWithLimit(
    revisionId: string,
    limit: number,
    current: Date,
  ): Promise<PreparedDeliveryDocument> {
    const prepared = await loadDeliveryQuotation(revisionId, current);
    try {
      const pdf = await renderPdf(prepared.html);
      if (!Buffer.isBuffer(pdf) || pdf.length > limit || !isValidPdfBuffer(pdf)) {
        throw new QuotationDeliveryPdfError('O PDF da revisão é inválido. Tente novamente.');
      }
      return {
        pdf,
        pdfSize: pdf.length,
        pdfSignature: quotationPdfChecksum(pdf),
        validUntil: validUntil(prepared.revision),
      };
    } catch (error) {
      if (error instanceof QuotationDeliveryPdfError) throw error;
      throw new QuotationDeliveryPdfError();
    }
  }

  async function prepareDeliveryDocument(revisionIdInput: string): Promise<PreparedDeliveryDocument> {
    const revisionId = uuid(revisionIdInput, 'Identificador da revisão');
    const current = asDate(now(), new Date());
    try {
      return await prepareDeliveryDocumentWithLimit(revisionId, maxPdfBytes, current);
    } catch (error) {
      if (isKnownError(error)) throw error;
      console.error(`[quotation-delivery] document failed (${error instanceof Error ? error.name : typeof error})`);
      throw new QuotationDeliveryRepositoryError();
    }
  }

  async function prepareDeliveryImages(revisionIdInput: string): Promise<PreparedDeliveryImage[]> {
    const revisionId = uuid(revisionIdInput, 'Identificador da revisão');
    const current = asDate(now(), new Date());
    const prepared = await loadDeliveryQuotation(revisionId, current);
    try {
      const images = await renderQuotationWebpHtml(prepared.html);
      if (
        !Array.isArray(images) ||
        images.length === 0 ||
        images.length > 100 ||
        images.some(
          (image) =>
            !Buffer.isBuffer(image) ||
            image.length === 0 ||
            image.length > MAX_QUOTATION_WEBP_BYTES ||
            !isValidWebpBuffer(image),
        )
      ) {
        throw new QuotationDeliveryImageError('A imagem da revisão é inválida. Tente novamente.');
      }
      return images.map((webp, index) => ({
        webp,
        webpSize: webp.length,
        webpSignature: quotationWebpChecksum(webp),
        page: index + 1,
        pageCount: images.length,
        validUntil: validUntil(prepared.revision),
      }));
    } catch (error) {
      if (error instanceof QuotationDeliveryImageError) throw error;
      throw new QuotationDeliveryImageError();
    }
  }

  async function prepareDelivery(input: PrepareQuotationDeliveryInput): Promise<PreparedQuotationDelivery> {
    const current = asDate(now(), new Date());
    const revisionId = uuid(input?.revisionId, 'Identificador da revisão');
    const limit = validPdfLimit(input.maxPdfBytes, maxPdfBytes, input.maxPdfBytes !== undefined);
    const delivery = await reserve({ revisionId, phone: input.phone, flowId: input.flowId });
    if (blocksTransport(delivery.state)) {
      throw new QuotationDeliveryConflictError('A entrega já está ativa, concluída ou em reconciliação. Não reenvie automaticamente.');
    }
    const document = await prepareDeliveryDocumentWithLimit(revisionId, limit, current);
    return { delivery, ...document };
  }

  return {
    reserve,
    reserveDelivery: reserve,
    recordState,
    recordDeliveryState: recordState,
    claimTransport,
    getByRevision,
    readDeliveryByRevision: getByRevision,
    prepareDeliveryDocument,
    prepareDeliveryImages,
    prepareDelivery,
    prepareQuotationDelivery: prepareDelivery,
  };
}

export const createQuotationDeliveryRepository = createPostgresQuotationDeliveryRepository;
