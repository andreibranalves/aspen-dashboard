import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from './client.js';
import { appSettings, clients, productPricingTiers, products, quoteRevisionItems, quoteRevisions, quoteSequences, quotations, quotationIssueRequests, quotationTemplates, quotationTemplateVersions } from './schema.js';
import { acquireQuotationWriteLock } from './quotation-write-lock.js';
import { appendProductActivityEvents } from './product-activity-repository.js';
import { buildDraftQuotationSnapshot, DraftPreviewInputError, type DraftQuotationSnapshot } from '../_functions/lib/quotation-draft-snapshot.js';
import { getQuotationTemplate, renderQuotationTemplate } from '../_functions/lib/quotation-templates.js';
import { renderQuotationPdf } from '../_functions/lib/quotation-pdf-renderer.js';
import { isValidPdfBuffer } from '../_functions/lib/quotation-document-storage.js';
import { normalizeProductPricing, resolveProductPrice, formatMoneyCents, parseMoneyCents, parseScaledInteger, PricingUnavailableError, PricingValidationError } from '../_functions/pricing-core.js';
import { normalizeQuotationSections, type QuotationSectionsSnapshot } from './quotation-content.js';
import { resolveQuotationRevisionMetadata } from './quotation-revision-invariants.js';
import { convertQuoteLeadInTransaction } from './quote-leads-repository.js';

type DatabaseProvider = () => AppDatabase;
type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
export type QuotationIssueDatabase = AppDatabase | Transaction;

export interface QuotationIssueInput {
  idempotencyKey: string;
  draft: unknown;
  sourceLeadId?: string;
  sourceQuotationId?: string;
  sourceRevisionId?: string;
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
const LEASE_MS = 30_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((out, key) => {
    if (!['idempotencyKey', 'idempotency_key', 'createdAt', 'updatedAt', 'timestamp', 'uiState', 'ui_state'].includes(key)) out[key] = canonicalize((value as Record<string, unknown>)[key]);
    return out;
  }, {});
}
export function quotationIssueFingerprint(input: QuotationIssueInput): string {
  return createHash('sha256').update(JSON.stringify(canonicalize({
    draft: input.draft,
    sourceLeadId: input.sourceLeadId || null,
    sourceQuotationId: input.sourceQuotationId || null,
    sourceRevisionId: input.sourceRevisionId || null,
  }))).digest('hex');
}
function date(value: unknown, fallback: Date): Date {
  const parsed = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : new Date(parsed);
}
function iso(value: unknown, fallback: Date): string { return date(value, fallback).toISOString(); }
function validUuid(value: unknown): string {
  const id = String(value || '').trim();
  if (!UUID.test(id)) throw new QuotationIssueInputError('Chave Idempotency-Key inválida.');
  return id;
}
function validityDays(value: unknown, fallback: unknown): number {
  const days = Number(value ?? fallback);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new QuotationIssueInputError('Validade do orçamento deve estar entre 1 e 365 dias.');
  }
  return days;
}
function sectionsSnapshot(value: unknown): QuotationSectionsSnapshot | null {
  const root = record(value);
  if (root.schema_version !== 1) return null;
  const valid = ['prazo_producao', 'pagamento', 'condicoes_gerais'].every((key) => {
    const section = record(root[key]);
    const current = record(section.current);
    const base = record(section.base);
    return typeof current.enabled === 'boolean' && typeof current.title === 'string'
      && typeof base.enabled === 'boolean' && typeof base.title === 'string';
  });
  return valid ? value as QuotationSectionsSnapshot : null;
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
  buildSnapshot?: typeof buildDraftQuotationSnapshot;
  convertLead?: typeof convertQuoteLeadInTransaction;
  database?: DatabaseProvider;
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

async function reserveNumber(tx: Transaction, year: number): Promise<string> {
  const [row] = await tx.insert(quoteSequences).values({ year, lastNumber: 1 }).onConflictDoUpdate({ target: quoteSequences.year, set: { lastNumber: sql`${quoteSequences.lastNumber} + 1` } }).returning({ lastNumber: quoteSequences.lastNumber });
  const number = Number(row?.lastNumber || 0);
  if (number < 1 || number > 9999) throw new QuotationIssueConflictError('A numeração anual de orçamentos atingiu o limite.');
  return `ORC-${year}${String(number).padStart(4, '0')}`;
}

async function readRequest(db: QuotationIssueDatabase, key: string) {
  const [row] = await db.select().from(quotationIssueRequests).where(eq(quotationIssueRequests.idempotencyKey, key)).limit(1);
  return row || null;
}

export function createQuotationIssueRepository(getDb: DatabaseProvider = getDatabase, options: QuotationIssueRepositoryOptions = {}): { issue(input: QuotationIssueInput): Promise<QuotationIssueResult>; read(idempotencyKey: string): Promise<QuotationIssueStatus | null> } {
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;
  const renderPdf = options.renderPdf || renderQuotationPdf;
  const buildSnapshot = options.buildSnapshot || buildDraftQuotationSnapshot;
  const convertLead = options.convertLead || convertQuoteLeadInTransaction;
  const leaseMs = options.leaseMs || LEASE_MS;
  const database = options.database || getDb;

  async function read(idempotencyKey: string): Promise<QuotationIssueStatus | null> {
    const key = validUuid(idempotencyKey);
    const row = await readRequest(database(), key);
    if (!row) return null;
    if (row.state === 'processing') return { state: 'processing', retryAfterMs: Math.max(0, date(row.leaseExpiresAt, now()).getTime() - now().getTime()) };
    if (row.state === 'retryable') return { state: 'retryable', error: row.publicError || 'Não foi possível emitir o orçamento. Tente novamente.' };
    if (!row.quotationId || !row.revisionId) return { state: 'retryable', error: 'Não foi possível emitir o orçamento. Tente novamente.' };
    const [quotation] = await database().select().from(quotations).where(eq(quotations.id, row.quotationId)).limit(1);
    const [revision] = await database().select().from(quoteRevisions).where(eq(quoteRevisions.id, row.revisionId)).limit(1);
    if (!quotation || !revision) return { state: 'retryable', error: 'Não foi possível recuperar a emissão. Tente novamente.' };
    return { state: 'completed', ...issueResult(quotation, revision) };
  }

  async function issue(input: QuotationIssueInput): Promise<QuotationIssueResult> {
    const key = validUuid(input?.idempotencyKey);
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
        if (decision === 'replay' && row.quotationId && row.revisionId) return;
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
      const result = await database().transaction(async (tx) => {
        await acquireQuotationWriteLock(tx);
        const request = await readRequest(tx, key);
        if (!request || request.fingerprint !== fingerprint) throw new QuotationIssueConflictError('A chave de idempotência já foi usada com conteúdo diferente.');
        if (request.state === 'completed' && request.quotationId && request.revisionId) {
          const [q] = await tx.select().from(quotations).where(eq(quotations.id, request.quotationId)).limit(1);
          const [r] = await tx.select().from(quoteRevisions).where(eq(quoteRevisions.id, request.revisionId)).limit(1);
          if (q && r) return issueResult(q, r);
        }
        if (request.state !== 'processing' || !claimedLeaseExpiresAt || !claimedUpdatedAt || date(request.leaseExpiresAt, started).getTime() !== claimedLeaseExpiresAt.getTime() || date(request.updatedAt, started).getTime() !== claimedUpdatedAt.getTime()) {
          throw new QuotationIssueConflictError('A emissão desta chave já foi retomada por outra tentativa. Consulte o estado da emissão.');
        }
        const inputDraft = record(input.draft);
        const extracted = record(inputDraft.extracted || inputDraft);
        const [settingsRow] = await tx.select().from(appSettings).where(eq(appSettings.singletonId, 1)).limit(1);
        const settings = settingsRow || { validadeDias: 15, pagamento: '', entrega: '', fretePadrao: '0.00', observacoes: '', templatePadrao: 'padrao', quotationSections: null };
        const items = Array.isArray(extracted.items) ? extracted.items : [];
        if (!String(extracted.nome || '').trim() || items.length === 0) throw new QuotationIssueInputError('Informe o cliente e ao menos um item antes de emitir o orçamento.');
        const skus = [...new Set(items.map((item) => String(record(item).item_code || record(item).sku || '').trim()).filter(Boolean))];
        const productRows = await tx.select().from(products).where(and(inArray(products.sku, skus), eq(products.ativo, true)));
        const productBySku = new Map(productRows.map((p) => [p.sku, p]));
        if (skus.some((sku) => !productBySku.has(sku))) throw new QuotationIssueConflictError('Um ou mais produtos não estão disponíveis. Atualize os preços e tente novamente.');
        const tiers = await tx.select().from(productPricingTiers).where(inArray(productPricingTiers.productSku, skus)).orderBy(asc(productPricingTiers.productSku), asc(productPricingTiers.minimumQuantity));
        const tiersBySku = new Map<string, typeof tiers>();
        for (const tier of tiers) tiersBySku.set(tier.productSku, [...(tiersBySku.get(tier.productSku) || []), tier]);
        let subtotal = 0n;
        const resolved: Array<Record<string, unknown>> = [];
        for (const raw of items) {
          const item = record(raw); const sku = String(item.item_code || item.sku || '').trim();
          const quantity = String(item.qty ?? item.quantidade ?? '0');
          const pricing = normalizeProductPricing({ preco_base: productBySku.get(sku)!.precoBase, precos: (tiersBySku.get(sku) || []).map((x) => ({ minimum_quantity: String(x.minimumQuantity), unit_price: String(x.unitPrice) })) });
          let resolution; try { resolution = resolveProductPrice(pricing, quantity, extracted.urgente === true); } catch (error) { if (error instanceof PricingValidationError || error instanceof PricingUnavailableError) throw new QuotationIssueConflictError(`Preço indisponível para o produto "${sku}".`); throw error; }
          if (item.manual_rate !== true && item.rate !== undefined) {
            let seen: bigint;
            try { seen = parseMoneyCents(item.rate, `Preço do item`); } catch { throw new QuotationIssueInputError('Preço do item inválido.'); }
            if (seen !== resolution.rate_cents) throw new QuotationIssueConflictError(`O preço do produto "${sku}" foi atualizado. Atualize o orçamento e tente novamente.`);
          }
          const applied = item.manual_rate === true ? parseMoneyCents(item.rate, `Preço manual do item`) : resolution.rate_cents;
          const total = (parseScaledInteger(quantity, 3, 'Quantidade') * applied + 500n) / 1000n;
          subtotal += total;
          resolved.push({ sku, quantity, item, product: productBySku.get(sku)!, resolution, applied, total });
        }
        const freight = parseMoneyCents(extracted.frete ?? settings.fretePadrao ?? '0.00', 'Frete', true);
        const total = subtotal + freight;
        const issuedAt = date(now(), started);
        let sourceRevision = input.sourceRevisionId ? (await tx.select().from(quoteRevisions).where(eq(quoteRevisions.id, input.sourceRevisionId)).for('update').limit(1))[0] : null;
        if (input.sourceRevisionId && !sourceRevision) throw new QuotationIssueConflictError('Revisão de origem não encontrada.');
        let sourceQuotation = sourceRevision ? (await tx.select().from(quotations).where(eq(quotations.id, sourceRevision.quotationId)).for('update').limit(1))[0] : null;
        if (input.sourceQuotationId) {
          const [requestedQuotation] = await tx.select().from(quotations).where(eq(quotations.id, input.sourceQuotationId)).for('update').limit(1);
          if (!requestedQuotation) throw new QuotationIssueConflictError('Orçamento de origem não encontrado.');
          if (sourceRevision && sourceRevision.quotationId !== requestedQuotation.id) throw new QuotationIssueConflictError('A revisão de origem não pertence ao orçamento informado.');
          sourceQuotation = requestedQuotation;
        }
        if (sourceRevision && sourceQuotation && sourceRevision.quotationId !== sourceQuotation.id) throw new QuotationIssueConflictError('A revisão de origem não pertence ao orçamento informado.');
        if (sourceQuotation && !input.sourceRevisionId) sourceRevision = (await tx.select().from(quoteRevisions).where(eq(quoteRevisions.quotationId, sourceQuotation.id)).orderBy(desc(quoteRevisions.version)).for('update').limit(1))[0] || null;
        const reviewedValidityDays = validityDays(extracted.validade_dias, sourceRevision?.validadeDias ?? settings.validadeDias);
        const payment = String(extracted.pagamento ?? sourceRevision?.pagamento ?? settings.pagamento ?? '').trim();
        const deliveryTerms = String(extracted.entrega ?? sourceRevision?.entrega ?? settings.entrega ?? '');
        const observations = String(extracted.observacoes ?? sourceRevision?.observacoes ?? settings.observacoes ?? '');
        if (!payment) throw new QuotationIssueConflictError('Pagamento deve ser informado antes de emitir o orçamento.');
        const quotationId = sourceQuotation?.id || idFactory();
        const businessNumber = sourceQuotation?.businessNumber || await reserveNumber(tx, issuedAt.getUTCFullYear());
        const sourceDraft = sourceRevision?.status === 'rascunho' ? sourceRevision : null;
        const version = sourceDraft ? sourceDraft.version : sourceRevision ? sourceRevision.version + 1 : 1;
        const revisionId = sourceDraft?.id || idFactory(); const clientId = sourceQuotation?.clientId || idFactory();
        if (![quotationId, revisionId, clientId].every((id) => UUID.test(id))) throw new QuotationIssueRepositoryError('Não foi possível gerar os identificadores do orçamento.');
        const selectedTemplateKey = String(extracted.template_key || sourceRevision?.templatePadrao || settings.templatePadrao || 'padrao').trim();
        const selectedTemplateVersionId = String(extracted.template_version_id || '').trim();
        const requestedSections = extracted.secoes ?? extracted.sections_snapshot;
        const suppliedSnapshot = sectionsSnapshot(requestedSections);
        if (requestedSections !== undefined && !suppliedSnapshot) {
          throw new QuotationIssueInputError('Snapshot de seções do orçamento inválido.');
        }
        const persistedSections = sourceRevision?.sectionsSnapshot;
        const sourceSnapshot = persistedSections == null ? null : sectionsSnapshot(persistedSections);
        if (persistedSections != null && !sourceSnapshot) {
          throw new QuotationIssueRepositoryError('Snapshot persistido de seções do orçamento inválido.');
        }
        const currentSections = suppliedSnapshot || sourceSnapshot;
        let normalizedSections: ReturnType<typeof normalizeQuotationSections>;
        try {
          normalizedSections = normalizeQuotationSections(currentSections
            ? {
                schema_version: currentSections.schema_version,
                prazo_producao: currentSections.prazo_producao.current,
                pagamento: currentSections.pagamento.current,
                condicoes_gerais: currentSections.condicoes_gerais.current,
              }
            : settings.quotationSections, {
            pagamento: payment,
            entrega: deliveryTerms,
            observacoes: observations,
          });
        } catch (error) {
          if (requestedSections !== undefined) {
            throw new QuotationIssueInputError(error instanceof Error ? error.message : 'Snapshot de seções do orçamento inválido.');
          }
          throw error;
        }
        const sections: QuotationSectionsSnapshot = {
          schema_version: 1,
          prazo_producao: {
            base: sourceSnapshot?.prazo_producao.base || normalizedSections.prazo_producao,
            current: normalizedSections.prazo_producao,
          },
          pagamento: {
            base: sourceSnapshot?.pagamento.base || normalizedSections.pagamento,
            current: normalizedSections.pagamento,
          },
          condicoes_gerais: {
            base: sourceSnapshot?.condicoes_gerais.base || normalizedSections.condicoes_gerais,
            current: normalizedSections.condicoes_gerais,
          },
        };
        const pdfDraft = {
          ...record(input.draft),
          extracted: {
            ...extracted,
            pagamento: payment,
            entrega: deliveryTerms,
            observacoes: observations,
            template_key: selectedTemplateKey,
            urgente: false,
            items: resolved.map((resolvedItem) => ({
              ...record(resolvedItem.item),
              rate: Number(resolvedItem.applied as bigint) / 100,
              manual_rate: true,
            })),
          },
        };
        let snapshot: DraftQuotationSnapshot;
        try {
          snapshot = await buildSnapshot(pdfDraft, {
            now: () => issuedAt,
            resolveTemplate: async (key) => {
              const rows = await tx.select({
                key: quotationTemplates.key,
                name: quotationTemplates.name,
                source: quotationTemplateVersions.source,
                hash: quotationTemplateVersions.sourceHash,
                id: quotationTemplateVersions.id,
              }).from(quotationTemplateVersions)
                .innerJoin(quotationTemplates, eq(quotationTemplateVersions.templateId, quotationTemplates.id))
                .where(selectedTemplateVersionId
                  ? and(eq(quotationTemplateVersions.id, selectedTemplateVersionId), eq(quotationTemplates.key, key))
                  : eq(quotationTemplates.key, key))
                .orderBy(desc(quotationTemplateVersions.version)).limit(1);
              const selected = rows[0];
              return selected
                ? { key: selected.key, name: selected.name, is_default: selected.key === settings.templatePadrao, source: selected.source, hash: selected.hash }
                : selectedTemplateVersionId ? null : getQuotationTemplate(key);
            },
          });
        } catch (error) {
          if (error instanceof DraftPreviewInputError) throw new QuotationIssueInputError(error.message);
          throw error;
        }
        const paymentSection = sections.pagamento.current;
        const conditionsSection = sections.condicoes_gerais.current;
        const deadlineSection = sections.prazo_producao.current;
        const viewModel = {
          ...snapshot.viewModel,
          quote_number: businessNumber, quotation_name: businessNumber, quote_id: quotationId,
          revision: version, revision_number: version, status: 'emitido', status_canonical: 'emitido', revision_status: 'emitido',
          subtotal: formatMoneyCents(subtotal), total: formatMoneyCents(total), freight: formatMoneyCents(freight), frete: formatMoneyCents(freight),
          validity_days: reviewedValidityDays,
          validity_date: new Date(issuedAt.getTime() + reviewedValidityDays * 86400000).toISOString().slice(0, 10),
          validity: new Date(issuedAt.getTime() + reviewedValidityDays * 86400000).toISOString().slice(0, 10),
          terms: { pagamento: payment, entrega: deliveryTerms, production_deadline: String(extracted.prazo_producao || ''), observations },
          terms_snapshot: { pagamento: payment, entrega: deliveryTerms, production_deadline: String(extracted.prazo_producao || ''), observations },
          secoes: {
            prazo_producao: { ...deadlineSection, value: String(extracted.prazo_producao || '') },
            pagamento: { ...paymentSection, body_html: paymentSection.body },
            condicoes_gerais: { ...conditionsSection, body_html: conditionsSection.body },
          },
          sections_snapshot: sections,
        };
        let pdf: Buffer;
        try {
          pdf = await renderPdf(renderQuotationTemplate(snapshot.template, viewModel));
        } catch {
          throw new QuotationIssueRepositoryError('Não foi possível gerar o PDF do orçamento. Tente novamente.');
        }
        if (!Buffer.isBuffer(pdf) || !isValidPdfBuffer(pdf)) throw new QuotationIssueRepositoryError('O gerador retornou um PDF inválido. Tente novamente.');
        if (!sourceQuotation) {
          await tx.insert(clients).values({ id: clientId, nome: String(extracted.nome).trim(), documento: extracted.cnpj ? String(extracted.cnpj).trim() : null, email: extracted.email ? String(extracted.email).trim().toLowerCase() : null, telefone: extracted.telefone ? String(extracted.telefone).replace(/\D/g, '') : null, arquivado: false, createdAt: issuedAt, updatedAt: issuedAt });
          await tx.insert(quotations).values({ id: quotationId, businessNumber, clientId, status: 'emitido', issuedAt, createdAt: issuedAt, updatedAt: issuedAt });
        } else await tx.update(quotations).set({ status: 'emitido', issuedAt, updatedAt: issuedAt }).where(eq(quotations.id, quotationId));
        const metadata = selectedTemplateVersionId
          ? { templateVersionId: selectedTemplateVersionId }
          : await resolveQuotationRevisionMetadata(tx, { templatePadrao: selectedTemplateKey, templateHash: snapshot.template.hash, pagamento: payment, entrega: deliveryTerms, observacoes: observations, prazoProducao: String(extracted.prazo_producao || '') });
        const revisionValues = {
          quotationId,
          version,
          status: 'emitido' as const,
          issuedAt,
          validadeDias: reviewedValidityDays,
          pagamento: payment,
          entrega: deliveryTerms,
          fretePadrao: settings.fretePadrao,
          frete: formatMoneyCents(freight),
          observacoes: observations,
          prazoProducao: String(extracted.prazo_producao || ''),
          templatePadrao: selectedTemplateKey,
          templateHash: snapshot.template.hash,
          templateVersionId: metadata.templateVersionId,
          sectionsSnapshot: sections,
          clienteNome: String(extracted.nome).trim(),
          clienteDocumento: extracted.cnpj ? String(extracted.cnpj).trim() : null,
          clienteEmail: extracted.email ? String(extracted.email).trim().toLowerCase() : null,
          clienteTelefone: extracted.telefone ? String(extracted.telefone).replace(/\D/g, '') : null,
          subtotal: formatMoneyCents(subtotal),
          total: formatMoneyCents(total),
        };
        if (sourceDraft) {
          await tx.update(quoteRevisions).set(revisionValues).where(eq(quoteRevisions.id, revisionId));
          await tx.delete(quoteRevisionItems).where(eq(quoteRevisionItems.revisionId, revisionId));
        } else {
          await tx.insert(quoteRevisions).values({ id: revisionId, createdAt: issuedAt, ...revisionValues });
        }
        await tx.insert(quoteRevisionItems).values(resolved.map((item, position) => { const product = item.product as typeof products.$inferSelect; const resolution = item.resolution as { source: string; minimum_quantity: string; rate: string }; return { id: idFactory(), revisionId, position, productSku: product.sku, quantidade: String(item.quantity), produtoSku: product.sku, produtoNome: String((item.item as Record<string, unknown>).item_name || product.nome), produtoDescricao: product.descricao, produtoUnidade: product.unidade, produtoCategoria: product.categoria, produtoMarca: product.marca, precoFonte: resolution.source === 'tier' ? 'tier' : 'base', precoMinimoFaixa: resolution.minimum_quantity, precoSugerido: resolution.rate, precoAplicado: formatMoneyCents(item.applied as bigint), diferencaPreco: formatMoneyCents((item.applied as bigint) - parseMoneyCents(resolution.rate, 'Preço')), totalLinha: formatMoneyCents(item.total as bigint), manualRate: (item.item as Record<string, unknown>).manual_rate === true }; }));
        await appendProductActivityEvents(tx, skus.map((sku) => ({ sku, tipo: 'orcamento' as const, texto: `Orçamento ${businessNumber} emitido`, reference_id: `orcamento:${quotationId}:${sku}`, created_at: issuedAt })));
        if (input.sourceLeadId) await convertLead(tx, input.sourceLeadId, quotationId, issuedAt);
        await tx.update(quotationIssueRequests).set({ state: 'completed', quotationId, revisionId, leaseExpiresAt: null, publicError: null, updatedAt: issuedAt }).where(eq(quotationIssueRequests.id, request.id));
        return { quotationId, businessNumber, revisionId, revisionNumber: version, status: 'emitido' as const, issuedAt: issuedAt.toISOString(), validUntil: new Date(issuedAt.getTime() + reviewedValidityDays * 86400000).toISOString().slice(0, 10), pdfUrl: `/api/quotation-preview?id=${encodeURIComponent(quotationId)}&format=pdf` };
      });
      return result;
    } catch (error) {
      const message = publicError(error);
      if (!(error instanceof QuotationIssueInputError) && !(error instanceof QuotationIssueConflictError) && !(error instanceof QuotationIssueRepositoryError)) console.error(`[quotation-issue] failed (${error instanceof Error ? error.message : typeof error})`);
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
