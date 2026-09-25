import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '../client.js';
import { crmDeals, quoteRevisionItems, quoteRevisions, quotations, quotationIssueRequests, quotationTemplates, quotationTemplateVersions } from '../schema.js';
import { acquireQuotationWriteLock } from '../quotation-write-lock.js';
import { appendProductActivityEvents } from './product-activity-repository.js';
import { renderQuotationDocument } from '../../../_modules/quotation-document.js';
import { renderQuotationPdf } from '../../../_modules/quotation-pdf-renderer.js';
import { isValidPdfBuffer } from '../../../_modules/quotation-document-storage.js';
import type { QuotationTemplateSnapshot } from './quotation-template-repository.js';
import { quotationConcurrencyToken } from './quote-draft-management-repository.js';
import {
  upsertCrmDealForQuotation,
  type UpsertCrmDealForQuotationOptions,
  type CrmDealUpsertInput,
  type CrmDatabase,
} from './crm-deals-repository.js';

type DatabaseProvider = () => AppDatabase;
export type QuotationIssueDatabase = AppDatabase;

/** Issue an existing persisted draft by reference: the revision identity,
 * the quotation concurrency token and the idempotency key are the whole
 * input. Commercial content is never accepted here — it is loaded from the
 * revision snapshot so re-sent browser fields cannot participate. */
export interface QuotationIssueInput {
  idempotencyKey: string;
  revisionId: string;
  concurrencyToken: string;
}

export interface QuotationIssueResult {
  quotationId: string;
  businessNumber: string;
  revisionId: string;
  revisionNumber: number;
  status: 'emitido';
  issuedAt: string;
  validUntil: string;
  pdfUrl: string;
}

export type QuotationIssueStatus =
  | { state: 'processing'; retryAfterMs: number }
  | { state: 'retryable'; error: string }
  | ({ state: 'completed' } & QuotationIssueResult);

export class QuotationIssueInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = 'QuotationIssueInputError'; }
}
export class QuotationIssueConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) { super(message); this.name = 'QuotationIssueConflictError'; }
}
export class QuotationIssueRepositoryError extends Error {
  readonly statusCode = 503;
  constructor(message = 'Não foi possível emitir o orçamento. Tente novamente.') { super(message); this.name = 'QuotationIssueRepositoryError'; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Matches the Function's `maxDuration` (vercel.json): the PDF renders outside
 * any lock, so only an attempt the platform already killed may lose its lease. */
const LEASE_MS = 60_000;
/** Commercial outcomes that close prospecting. An issued proposal must never
 * officialize into a demand that already lost or closed while it was edited. */
const CLOSED_OPPORTUNITY_STATUSES = ['Pedido Fechado', 'Perdido'] as const;

export function quotationIssueFingerprint(input: Pick<QuotationIssueInput, 'revisionId'>): string {
  return createHash('sha256').update(JSON.stringify({ revisionId: String(input.revisionId || '').trim() })).digest('hex');
}
function date(value: unknown, fallback: Date): Date {
  const parsed = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : new Date(parsed);
}
function iso(value: unknown, fallback: Date): string { return date(value, fallback).toISOString(); }
function requiredUuid(value: unknown, invalidMessage: string): string {
  const id = String(value || '').trim();
  if (!UUID.test(id)) throw new QuotationIssueInputError(invalidMessage);
  return id;
}
function issueResult(quotation: typeof quotations.$inferSelect, revision: typeof quoteRevisions.$inferSelect): QuotationIssueResult {
  const issuedAt = iso(revision.issuedAt || quotation.issuedAt || revision.createdAt, new Date(0));
  const until = new Date(issuedAt);
  until.setUTCDate(until.getUTCDate() + revision.validadeDias);
  return { quotationId: quotation.id, businessNumber: quotation.businessNumber, revisionId: revision.id, revisionNumber: revision.version, status: 'emitido', issuedAt, validUntil: until.toISOString().slice(0, 10), pdfUrl: `/api/quotation-preview?id=${encodeURIComponent(quotation.id)}&format=pdf` };
}
function publicError(error: unknown): string {
  if (error instanceof QuotationIssueInputError || error instanceof QuotationIssueConflictError || error instanceof QuotationIssueRepositoryError) return error.message;
  if (error instanceof Error && error.message.toLowerCase().includes('pdf')) return 'Não foi possível gerar o PDF do orçamento. Tente novamente.';
  return 'Não foi possível emitir o orçamento. Tente novamente.';
}

export interface QuotationIssueRepositoryOptions {
  now?: () => Date;
  idFactory?: () => string;
  leaseMs?: number;
  renderPdf?: (html: string) => Promise<Buffer>;
  database?: DatabaseProvider;
  upsertCrmDeal?: (
    database: CrmDatabase,
    input: CrmDealUpsertInput,
    options?: UpsertCrmDealForQuotationOptions
  ) => Promise<unknown>;
}

export type QuotationIssueLeaseDecision = 'claim' | 'replay' | 'active' | 'conflict';
export function quotationIssueFailureOwnershipMatches(
  state: string,
  leaseExpiresAt: Date | string | null | undefined,
  updatedAt: Date | string | null | undefined,
  claimedLeaseExpiresAt: Date,
  claimedUpdatedAt: Date
): boolean {
  return state === 'processing'
    && date(leaseExpiresAt, claimedLeaseExpiresAt).getTime() === claimedLeaseExpiresAt.getTime()
    && date(updatedAt, claimedUpdatedAt).getTime() === claimedUpdatedAt.getTime();
}
export function quotationIssueLeaseDecision(
  state: string,
  storedFingerprint: string,
  fingerprint: string,
  leaseExpiresAt: Date | string | null | undefined,
  now: Date
): QuotationIssueLeaseDecision {
  if (storedFingerprint !== fingerprint) return 'conflict';
  if (state === 'completed') return 'replay';
  if (state === 'processing' && date(leaseExpiresAt, now).getTime() > now.getTime()) return 'active';
  return 'claim';
}

async function readRequest(db: QuotationIssueDatabase, key: string) {
  const [row] = await db.select().from(quotationIssueRequests).where(eq(quotationIssueRequests.idempotencyKey, key)).limit(1);
  return row || null;
}

interface IssuableDraft {
  quotation: typeof quotations.$inferSelect;
  revision: typeof quoteRevisions.$inferSelect;
  items: (typeof quoteRevisionItems.$inferSelect)[];
  templateVersion: QuotationTemplateSnapshot['templateVersion'];
}

/** Load and validate the draft being issued. The unlocked read feeds the PDF
 * render; the write transaction repeats it with `forUpdate`, because anything
 * may have changed while the PDF was rendering. */
async function readIssuableDraft(db: QuotationIssueDatabase, revisionId: string, concurrencyToken: string, forUpdate: boolean): Promise<IssuableDraft> {
  const revisionRows = db.select().from(quoteRevisions).where(eq(quoteRevisions.id, revisionId)).limit(1).$dynamic();
  const [revision] = await (forUpdate ? revisionRows.for('update') : revisionRows);
  if (!revision) throw new QuotationIssueConflictError('Revisão do orçamento não encontrada.');
  const quotationRows = db.select().from(quotations).where(eq(quotations.id, revision.quotationId)).limit(1).$dynamic();
  const [quotation] = await (forUpdate ? quotationRows.for('update') : quotationRows);
  if (!quotation) throw new QuotationIssueConflictError('Orçamento de origem não encontrado.');
  if (revision.status !== 'rascunho') throw new QuotationIssueConflictError('Este orçamento não está mais em rascunho e não pode ser emitido novamente.');
  // The concurrency token is the quotation's updatedAt. A stale token
  // means another user changed the draft after this page was loaded.
  if (quotationConcurrencyToken(quotation.updatedAt) !== concurrencyToken.trim()) {
    throw new QuotationIssueConflictError('O orçamento foi alterado por outro usuário. Recarregue antes de emitir.');
  }
  // The demand can be closed between saving and issuing, including while the
  // PDF renders. The locked read revalidates it before flipping status.
  if (quotation.opportunityId) {
    const opportunityRows = db.select().from(crmDeals).where(eq(crmDeals.id, quotation.opportunityId)).limit(1).$dynamic();
    const [opportunity] = await (forUpdate ? opportunityRows.for('update') : opportunityRows);
    if (!opportunity) {
      throw new QuotationIssueConflictError(
        'A oportunidade vinculada a este orçamento não foi encontrada.'
      );
    }
    if (CLOSED_OPPORTUNITY_STATUSES.includes(opportunity.status as (typeof CLOSED_OPPORTUNITY_STATUSES)[number])) {
      throw new QuotationIssueConflictError(
        'Não é possível emitir um orçamento vinculado a uma oportunidade encerrada. Crie uma nova proposta para este cliente.'
      );
    }
    if (opportunity.clientId && opportunity.clientId !== quotation.clientId) {
      throw new QuotationIssueConflictError(
        'A oportunidade vinculada não pertence ao cliente deste orçamento.'
      );
    }
  }
  const items = await db.select().from(quoteRevisionItems).where(eq(quoteRevisionItems.revisionId, revision.id)).orderBy(asc(quoteRevisionItems.position));
  if (items.length === 0) throw new QuotationIssueInputError('Informe o cliente e ao menos um item antes de emitir o orçamento.');
  let templateVersion: QuotationTemplateSnapshot['templateVersion'] = null;
  if (revision.templateVersionId) {
    const rows = await db.select({ version: quotationTemplateVersions, model: quotationTemplates }).from(quotationTemplateVersions)
      .innerJoin(quotationTemplates, eq(quotationTemplateVersions.templateId, quotationTemplates.id))
      .where(eq(quotationTemplateVersions.id, revision.templateVersionId)).limit(1);
    templateVersion = rows[0] ? { ...rows[0].version, template: rows[0].model } : null;
  }
  return { quotation, revision, items, templateVersion };
}

function issuedDocument(draft: IssuableDraft, issuedAt: Date) {
  const quotation = { ...draft.quotation, status: 'emitido' as const, issuedAt, updatedAt: issuedAt };
  const revision = { ...draft.revision, status: 'emitido' as const, issuedAt };
  // Legacy revisions without a stored version render through their
  // immutable key/hash pair, exactly like the persisted preview seam.
  const html = renderQuotationDocument({ quotation, revision, companySnapshot: revision.companySnapshot, templateVersion: draft.templateVersion, sectionsSnapshot: revision.sectionsSnapshot, items: draft.items }).html;
  return { quotation, revision, html };
}

export function createQuotationIssueRepository(getDb: DatabaseProvider = getDatabase, options: QuotationIssueRepositoryOptions = {}): { issue(input: QuotationIssueInput): Promise<QuotationIssueResult>; read(idempotencyKey: string): Promise<QuotationIssueStatus | null> } {
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;
  const renderPdf = options.renderPdf || renderQuotationPdf;
  const leaseMs = options.leaseMs || LEASE_MS;
  const database = options.database || getDb;
  const upsertCrmDeal = options.upsertCrmDeal || upsertCrmDealForQuotation;

  async function read(idempotencyKey: string): Promise<QuotationIssueStatus | null> {
    const key = requiredUuid(idempotencyKey, 'Chave Idempotency-Key inválida.');
    const row = await readRequest(database(), key);
    if (!row) return null;
    if (row.state === 'processing') return { state: 'processing', retryAfterMs: Math.max(0, date(row.leaseExpiresAt, now()).getTime() - now().getTime()) };
    if (row.state === 'retryable') return { state: 'retryable', error: row.publicError || 'Não foi possível emitir o orçamento. Tente novamente.' };
    if (!row.quotationId || !row.revisionId) throw new QuotationIssueConflictError('Este orçamento foi excluído.');
    const [quotation] = await database().select().from(quotations).where(eq(quotations.id, row.quotationId)).limit(1);
    const [revision] = await database().select().from(quoteRevisions).where(eq(quoteRevisions.id, row.revisionId)).limit(1);
    if (!quotation || !revision) return { state: 'retryable', error: 'Não foi possível recuperar a emissão. Tente novamente.' };
    return { state: 'completed', ...issueResult(quotation, revision) };
  }

  async function issue(input: QuotationIssueInput): Promise<QuotationIssueResult> {
    const key = requiredUuid(input?.idempotencyKey, 'Chave Idempotency-Key inválida.');
    const fingerprint = quotationIssueFingerprint(input);
    const started = date(now(), new Date());
    let requestId = idFactory();
    let claimedLeaseExpiresAt: Date | undefined;
    let claimedUpdatedAt: Date | undefined;
    if (!UUID.test(requestId)) throw new QuotationIssueRepositoryError('Não foi possível gerar a tentativa de emissão.');
    try {
      await database().transaction(async (tx) => {
        let row = await readRequest(tx, key);
        let inserted = false;
        if (!row) {
          const [created] = await tx.insert(quotationIssueRequests).values({ id: requestId, idempotencyKey: key, fingerprint, state: 'processing', leaseExpiresAt: new Date(started.getTime() + leaseMs), createdAt: started, updatedAt: started }).onConflictDoNothing({ target: quotationIssueRequests.idempotencyKey }).returning();
          if (created) {
            row = created;
            inserted = true;
          } else {
            row = await readRequest(tx, key);
          }
        }
        if (!row) throw new QuotationIssueRepositoryError();
        const decision = inserted ? 'claim' : quotationIssueLeaseDecision(row.state, row.fingerprint, fingerprint, row.leaseExpiresAt, started);
        if (decision === 'conflict') throw new QuotationIssueConflictError('A chave de idempotência já foi usada com conteúdo diferente.');
        if (decision === 'replay') {
          if (!row.quotationId || !row.revisionId) throw new QuotationIssueConflictError('Este orçamento foi excluído.');
          return;
        }
        if (decision === 'active') throw new QuotationIssueConflictError('A emissão desta chave já está em processamento. Tente novamente em instantes.');
        requestId = row.id;
        claimedLeaseExpiresAt = new Date(started.getTime() + leaseMs);
        claimedUpdatedAt = started;
        if (!inserted) await tx.update(quotationIssueRequests).set({ state: 'processing', publicError: null, leaseExpiresAt: claimedLeaseExpiresAt, updatedAt: claimedUpdatedAt }).where(eq(quotationIssueRequests.id, row.id));
      });
    } catch (error) {
      if (error instanceof QuotationIssueConflictError || error instanceof QuotationIssueRepositoryError) throw error;
      throw new QuotationIssueRepositoryError();
    }

    try {
      // Rendering the PDF takes seconds. Do it from an unlocked, consistent
      // read so no quotation lock, row lock or pooled connection is held
      // meanwhile; the write transaction below repeats every check.
      let prepared: { issuedAt: Date; html: string } | undefined;
      if (claimedLeaseExpiresAt) {
        const revisionId = requiredUuid(input.revisionId, 'Revisão do orçamento inválida.');
        const draft = await database().transaction(
          (tx) => readIssuableDraft(tx, revisionId, input.concurrencyToken, false),
          { isolationLevel: 'repeatable read', accessMode: 'read only' }
        );
        const issuedAt = date(now(), started);
        const { html } = issuedDocument(draft, issuedAt);
        let pdf: Buffer;
        try { pdf = await renderPdf(html); } catch {
          throw new QuotationIssueRepositoryError('Não foi possível gerar o PDF do orçamento. Tente novamente.');
        }
        if (!Buffer.isBuffer(pdf) || !isValidPdfBuffer(pdf)) throw new QuotationIssueRepositoryError('O gerador retornou um PDF inválido. Tente novamente.');
        prepared = { issuedAt, html };
      }
      const result = await database().transaction(async (tx) => {
        await acquireQuotationWriteLock(tx);
        const request = await readRequest(tx, key);
        if (!request || request.fingerprint !== fingerprint) throw new QuotationIssueConflictError('A chave de idempotência já foi usada com conteúdo diferente.');
        if (request.state === 'completed' && request.quotationId && request.revisionId) {
          const [q] = await tx.select().from(quotations).where(eq(quotations.id, request.quotationId)).limit(1);
          const [r] = await tx.select().from(quoteRevisions).where(eq(quoteRevisions.id, request.revisionId)).limit(1);
          if (q && r) return issueResult(q, r);
        }
        if (!prepared || request.state !== 'processing' || !claimedLeaseExpiresAt || !claimedUpdatedAt || date(request.leaseExpiresAt, started).getTime() !== claimedLeaseExpiresAt.getTime() || date(request.updatedAt, started).getTime() !== claimedUpdatedAt.getTime()) {
          throw new QuotationIssueConflictError('A emissão desta chave já foi retomada por outra tentativa. Consulte o estado da emissão.');
        }
        const draft = await readIssuableDraft(tx, requiredUuid(input.revisionId, 'Revisão do orçamento inválida.'), input.concurrencyToken, true);
        const { quotation, revision, html } = issuedDocument(draft, prepared.issuedAt);
        // The token matched, yet the document differs from the one whose PDF
        // was validated: a write outside the draft flow changed it meanwhile.
        if (html !== prepared.html) throw new QuotationIssueConflictError('O orçamento foi alterado por outro usuário. Recarregue antes de emitir.');
        const { issuedAt } = prepared;
        await tx.update(quotations).set({ status: 'emitido', issuedAt, updatedAt: issuedAt }).where(eq(quotations.id, quotation.id));
        await tx.update(quoteRevisions).set({ status: 'emitido', issuedAt }).where(eq(quoteRevisions.id, revision.id));
        await upsertCrmDeal(tx, {
          quotationId: quotation.id,
          clientId: quotation.clientId,
          opportunityId: quotation.opportunityId,
          nome: revision.clienteNome,
          email: revision.clienteEmail,
          telefone: revision.clienteTelefone,
        }, { now: issuedAt, idFactory });
        const skus = [...new Set(draft.items.map((item) => item.productSku))];
        await appendProductActivityEvents(tx, skus.map((sku) => ({ sku, tipo: 'orcamento' as const, texto: `Orçamento ${quotation.businessNumber} emitido`, reference_id: `orcamento:${quotation.id}:${sku}`, created_at: issuedAt })));
        await tx.update(quotationIssueRequests).set({ state: 'completed', quotationId: quotation.id, revisionId: revision.id, leaseExpiresAt: null, publicError: null, updatedAt: issuedAt }).where(eq(quotationIssueRequests.id, request.id));
        return issueResult(quotation, revision);
      });
      return result;
    } catch (error) {
      const message = publicError(error);
      if (!(error instanceof QuotationIssueInputError) && !(error instanceof QuotationIssueConflictError) && !(error instanceof QuotationIssueRepositoryError)) console.error(`[quotation-issue] failed (${error instanceof Error ? error.name : typeof error})`);
      try {
        if (claimedLeaseExpiresAt && claimedUpdatedAt) {
          await database().update(quotationIssueRequests).set({ state: 'retryable', publicError: message, leaseExpiresAt: null, updatedAt: date(now(), started) }).where(and(eq(quotationIssueRequests.idempotencyKey, key), eq(quotationIssueRequests.state, 'processing'), eq(quotationIssueRequests.leaseExpiresAt, claimedLeaseExpiresAt), eq(quotationIssueRequests.updatedAt, claimedUpdatedAt)));
        }
      } catch { /* preserve original failure */ }
      if (error instanceof QuotationIssueInputError || error instanceof QuotationIssueConflictError) throw error;
      if (error instanceof QuotationIssueRepositoryError) throw error;
      throw new QuotationIssueRepositoryError(message);
    }
  }
  return { issue, read };
}

export const createPostgresQuotationIssueRepository = createQuotationIssueRepository;
export const quotationIssueFingerprintCanonical = quotationIssueFingerprint;
