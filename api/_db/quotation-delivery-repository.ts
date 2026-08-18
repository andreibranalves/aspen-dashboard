import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from './client.js';
import {
  quoteRevisionItems,
  quoteRevisions,
  quotationDeliveries,
  quotationTemplateVersions,
  quotations,
} from './schema.js';
import { canonicalQuotationStatus, isIssuedQuotationStatus } from '../modules/quotation-status.js';
import {
  formatQuotationClientName,
  formatQuotationCurrency,
  formatQuotationDate,
  formatQuotationPhone,
  formatQuotationQuantity,
  renderQuotationTemplate,
  type QuotationTemplate,
  type QuotationTemplateViewModel,
} from '../modules/quotation-template-catalog.js';
import { renderQuotationPdf } from '../modules/quotation-pdf-renderer.js';
import { isValidPdfBuffer, quotationPdfChecksum } from '../modules/quotation-document-storage.js';
import { normalizeWhatsappPhone } from '../_functions/lib/whatsapp-conversations-store.js';
import { revisionSectionsSnapshot } from './quotation-revision-invariants.js';

type DatabaseProvider = () => AppDatabase;
type DeliveryDatabase = AppDatabase | Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
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
  claimTransport(revisionId: string): Promise<QuotationDelivery | null>;
  getByRevision(revisionId: string): Promise<QuotationDelivery | null>;
  readDeliveryByRevision(revisionId: string): Promise<QuotationDelivery | null>;
  prepareDelivery(input: PrepareQuotationDeliveryInput): Promise<PreparedQuotationDelivery>;
  prepareQuotationDelivery(input: PrepareQuotationDeliveryInput): Promise<PreparedQuotationDelivery>;
}

export interface PreparedQuotationDelivery {
  delivery: QuotationDelivery;
  pdf: Buffer;
  pdfSize: number;
  pdfSignature: string;
  validUntil: Date;
}

export interface QuotationDeliveryRepositoryOptions {
  now?: () => Date;
  randomId?: () => string;
  renderPdf?: (html: string) => Promise<Buffer>;
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
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_PDF_BYTES) {
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
  const resumableUntil = asDate(row.resumableUntil, now);
  const readOnly = now.getTime() >= resumableUntil.getTime()
    && row.state !== 'completed';
  return {
    id: row.id,
    revisionId: row.revisionId,
    phone: row.phone,
    flowId: row.flowId,
    state: row.state as QuotationDeliveryState,
    providerAcceptanceId: row.providerAcceptanceId || null,
    publicError: row.diagnosticsExpiresAt && now.getTime() >= asDate(row.diagnosticsExpiresAt, now).getTime()
      ? null
      : row.publicError || null,
    diagnosticsExpiresAt: asDate(row.diagnosticsExpiresAt, now),
    resumableUntil,
    createdAt: asDate(row.createdAt, now),
    updatedAt: asDate(row.updatedAt, now),
    readOnly,
  };
}

async function readRow(db: DeliveryDatabase, revisionId: string) {
  const [row] = await db.select().from(quotationDeliveries)
    .where(eq(quotationDeliveries.revisionId, revisionId)).limit(1);
  return row || null;
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
  await assertEmittedRevision(db, revisionId, now);
  const id = randomId();
  if (!UUID.test(id)) throw new QuotationDeliveryRepositoryError();
  const [inserted] = await db.insert(quotationDeliveries).values({
    id,
    revisionId,
    phone: normalizedPhone,
    flowId: normalizedFlow,
    state: 'pending',
    providerAcceptanceId: null,
    publicError: null,
    diagnosticsExpiresAt: retention(now, DIAGNOSTIC_DAYS),
    resumableUntil: retention(now, RESUMABLE_DAYS),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: quotationDeliveries.revisionId }).returning();
  const row = inserted || await readRow(db, revisionId);
  if (!row) throw new QuotationDeliveryRepositoryError();
  if (row.phone !== normalizedPhone || row.flowId !== normalizedFlow) {
    throw new QuotationDeliveryConflictError('A revisão já possui uma entrega. Para alterar o destinatário ou fluxo, crie uma nova revisão.');
  }
  return toDelivery(row, now);
}

function revisionViewModel(
  revision: typeof quoteRevisions.$inferSelect,
  items: Array<typeof quoteRevisionItems.$inferSelect>,
  now: Date,
): QuotationTemplateViewModel {
  const until = validUntil(revision);
  const money = formatQuotationCurrency;
  const itemView = items.sort((a, b) => a.position - b.position).map((item) => ({
    id: item.id,
    position: item.position,
    sku: item.produtoSku,
    item_code: item.produtoSku,
    nome: item.produtoNome,
    name: item.produtoNome,
    descricao: item.produtoDescricao,
    description: item.produtoDescricao,
    unidade: item.produtoUnidade,
    unit: item.produtoUnidade,
    qty: Number(item.quantidade),
    quantidade: Number(item.quantidade),
    quantity: formatQuotationQuantity(item.quantidade),
    unit_price: money(item.precoAplicado),
    applied_unit_price: item.precoAplicado,
    preco_aplicado: item.precoAplicado,
    line_total: money(item.totalLinha),
    total_linha: item.totalLinha,
    display: { unit_price: money(item.precoAplicado), line_total: money(item.totalLinha) },
  }));
  const subtotal = money(revision.subtotal);
  const freight = money(revision.frete);
  const total = money(revision.total);
  const client = {
    name: formatQuotationClientName(revision.clienteNome),
    nome: formatQuotationClientName(revision.clienteNome),
    document: revision.clienteDocumento || '',
    documento: revision.clienteDocumento || '',
    email: revision.clienteEmail || '',
    phone: formatQuotationPhone(revision.clienteTelefone),
    address: [revision.clienteEndereco, revision.clienteNumero, revision.clienteBairro, revision.clienteMunicipio, revision.clienteUf, revision.clienteCep].filter(Boolean).join(', '),
  };
  const sectionsSnapshot = revisionSectionsSnapshot(revision);
  const pagamento = sectionsSnapshot.pagamento.current as unknown as Record<string, unknown>;
  const condicoes = sectionsSnapshot.condicoes_gerais.current as unknown as Record<string, unknown>;
  const prazo = sectionsSnapshot.prazo_producao.current as unknown as Record<string, unknown>;
  const paymentBody = String(pagamento.body_html ?? pagamento.body ?? '');
  const conditionsBody = String(condicoes.body_html ?? condicoes.body ?? '');
  const productionDeadline = String(prazo.value ?? revision.prazoProducao ?? '');
  const sections = {
    prazo_producao: { value: productionDeadline, enabled: prazo.enabled === true, title: String(prazo.title ?? '') },
    pagamento: { body_html: paymentBody, enabled: pagamento.enabled === true, title: String(pagamento.title ?? '') },
    condicoes_gerais: { body_html: conditionsBody, enabled: condicoes.enabled === true, title: String(condicoes.title ?? '') },
  };
  const terms = {
    pagamento: paymentBody,
    entrega: revision.entrega,
    production_deadline: productionDeadline,
    observations: conditionsBody,
  };
  const issuedAt = asDate(revision.issuedAt || revision.createdAt, now);
  return {
    quote_number: '', quotation_name: '', quote_id: revision.quotationId, revision: revision.version,
    revision_number: revision.version, status: 'emitido', status_canonical: 'emitido', revision_status: 'emitido',
    quote_date: issuedAt.toISOString().slice(0, 10), date: issuedAt.toISOString().slice(0, 10),
    validity_date: until.toISOString().slice(0, 10), validity: until.toISOString().slice(0, 10), validity_days: revision.validadeDias,
    client, client_snapshot: client, items: itemView, items_snapshot: itemView, terms, terms_snapshot: terms,
    secoes: sections,
    sections_snapshot: sections,
    subtotal: revision.subtotal, freight: revision.frete, frete: revision.frete, total: revision.total,
    display: { quote_date: formatQuotationDate(issuedAt), validity_date: formatQuotationDate(until), subtotal, freight, total },
  };
}

export function createPostgresQuotationDeliveryRepository(
  getDb: DatabaseProvider = getDatabase,
  options: QuotationDeliveryRepositoryOptions = {},
): QuotationDeliveryRepository {
  const now = options.now || (() => new Date());
  const randomId = options.randomId || randomUUID;
  const renderPdf = options.renderPdf || renderQuotationPdf;
  const maxPdfBytes = validPdfLimit(options.maxPdfBytes, MAX_PDF_BYTES);

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
    if (!DELIVERY_STATES.includes(input?.state)) throw new QuotationDeliveryInputError('Estado de entrega inválido.');
    const providerAcceptanceId = safeAcceptanceId(input.providerAcceptanceId ?? input.provider_acceptance_id);
    const publicError = safePublicError(input.publicError ?? input.public_error);
    const current = asDate(now(), new Date());
    try {
      return await getDb().transaction(async (tx) => {
        const row = await readRow(tx, revisionId);
        if (!row) throw new QuotationDeliveryNotFoundError('Entrega da revisão não encontrada.');
        const currentDelivery = toDelivery(row, current);
        if (currentDelivery.readOnly) throw new QuotationDeliveryConflictError('O prazo de retomada desta entrega expirou. Crie uma nova revisão.');
        if (!canRecordQuotationDeliveryState(currentDelivery.state, input.state)) {
          throw new QuotationDeliveryConflictError('O estado durável desta entrega bloqueia nova tentativa de transporte. Consulte a entrega antes de continuar.');
        }
        if (options.beforeStateUpdate) await options.beforeStateUpdate();
        const affected = await tx.update(quotationDeliveries).set({
          state: input.state,
          providerAcceptanceId: providerAcceptanceId ?? row.providerAcceptanceId,
          publicError,
          updatedAt: current,
        }).where(and(eq(quotationDeliveries.revisionId, revisionId), eq(quotationDeliveries.updatedAt, row.updatedAt)))
          .returning({ id: quotationDeliveries.id });
        if (affected.length !== 1) throw new QuotationDeliveryConflictError('A entrega foi alterada por outra tentativa. Consulte o estado atual.');
        const updated = await readRow(tx, revisionId);
        if (!updated) throw new QuotationDeliveryRepositoryError();
        return toDelivery(updated, current);
      });
    } catch (error) {
      if (isKnownError(error)) throw error;
      console.error(`[quotation-delivery] state failed (${error instanceof Error ? error.name : typeof error})`);
      throw new QuotationDeliveryRepositoryError();
    }
  }

  async function claimTransport(revisionIdInput: string): Promise<QuotationDelivery | null> {
    const revisionId = uuid(revisionIdInput, 'Identificador da revisão');
    const current = asDate(now(), new Date());
    try {
      return await getDb().transaction(async (tx) => {
        const row = await readRow(tx, revisionId);
        if (!row) return null;
        const delivery = toDelivery(row, current);
        if (delivery.readOnly || blocksTransport(delivery.state)) return null;
        const [claimed] = await tx.update(quotationDeliveries).set({ state: 'transporting', updatedAt: current })
          .where(and(eq(quotationDeliveries.revisionId, revisionId), eq(quotationDeliveries.updatedAt, row.updatedAt), inArray(quotationDeliveries.state, ['pending', 'retryable'])))
          .returning();
        return claimed ? toDelivery(claimed, current) : null;
      });
    } catch (error) {
      if (isKnownError(error)) throw error;
      throw new QuotationDeliveryRepositoryError();
    }
  }

  async function getByRevision(revisionIdInput: string): Promise<QuotationDelivery | null> {
    const revisionId = uuid(revisionIdInput, 'Identificador da revisão');
    const current = asDate(now(), new Date());
    try {
      return await getDb().transaction(async (tx) => {
        const row = await readRow(tx, revisionId);
        if (!row) return null;
        if (row.publicError && row.diagnosticsExpiresAt && current.getTime() >= asDate(row.diagnosticsExpiresAt, current).getTime()) {
          await tx.update(quotationDeliveries).set({ publicError: null, updatedAt: row.updatedAt }).where(eq(quotationDeliveries.id, row.id));
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

  async function prepareDelivery(input: PrepareQuotationDeliveryInput): Promise<PreparedQuotationDelivery> {
    const current = asDate(now(), new Date());
    const revisionId = uuid(input?.revisionId, 'Identificador da revisão');
    const limit = validPdfLimit(input.maxPdfBytes, maxPdfBytes, input.maxPdfBytes !== undefined);
    const delivery = await reserve({ revisionId, phone: input.phone, flowId: input.flowId });
    if (blocksTransport(delivery.state)) {
      throw new QuotationDeliveryConflictError('A entrega já está ativa, concluída ou em reconciliação. Não reenvie automaticamente.');
    }
    let revision: typeof quoteRevisions.$inferSelect;
    let template: QuotationTemplate;
    let viewModel: QuotationTemplateViewModel;
    try {
      const [loadedRevision] = await getDb().select().from(quoteRevisions).where(eq(quoteRevisions.id, revisionId)).limit(1);
      if (!loadedRevision) throw new QuotationDeliveryNotFoundError();
      revision = loadedRevision;
      const [version] = await getDb().select().from(quotationTemplateVersions).where(eq(quotationTemplateVersions.id, revision.templateVersionId || '')).limit(1);
      if (!version || version.sourceHash !== revision.templateHash) throw new QuotationDeliveryConflictError('O snapshot do template da revisão não está disponível.');
      const items = await getDb().select().from(quoteRevisionItems).where(eq(quoteRevisionItems.revisionId, revisionId));
      template = { key: revision.templatePadrao, name: revision.templatePadrao, is_default: false, source: version.source, hash: version.sourceHash };
      viewModel = revisionViewModel(revision, items, current);
      const [quotation] = await getDb().select({ businessNumber: quotations.businessNumber })
        .from(quotations).where(eq(quotations.id, revision.quotationId)).limit(1);
      if (!quotation) throw new QuotationDeliveryNotFoundError();
      viewModel.quote_number = quotation.businessNumber;
      viewModel.quotation_name = quotation.businessNumber;
    } catch (error) {
      if (isKnownError(error)) throw error;
      throw new QuotationDeliveryRepositoryError();
    }
    try {
      const pdf = await renderPdf(renderQuotationTemplate(template, viewModel));
      if (!Buffer.isBuffer(pdf) || pdf.length > limit || !isValidPdfBuffer(pdf)) throw new QuotationDeliveryPdfError('O PDF da revisão é inválido. Tente novamente.');
      return { delivery, pdf, pdfSize: pdf.length, pdfSignature: quotationPdfChecksum(pdf), validUntil: validUntil(revision) };
    } catch (error) {
      if (error instanceof QuotationDeliveryPdfError) throw error;
      throw new QuotationDeliveryPdfError();
    }
  }

  return {
    reserve,
    reserveDelivery: reserve,
    recordState,
    recordDeliveryState: recordState,
    claimTransport,
    getByRevision,
    readDeliveryByRevision: getByRevision,
    prepareDelivery,
    prepareQuotationDelivery: prepareDelivery,
  };
}

export const createQuotationDeliveryRepository = createPostgresQuotationDeliveryRepository;
