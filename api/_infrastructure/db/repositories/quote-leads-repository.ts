import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';

import { createHttpError } from '../../../_shared/http-error.js';
import { getDatabase, type AppDatabase } from '../client.js';
import { ensureFirstContactAction } from './opportunity-actions-repository.js';
import { crmDeals, quoteLeads, quotations } from '../schema.js';
import {
  formatQuoteLeadText,
  mergeQuoteLead,
  normalizeQuoteLeadInput,
  quoteLeadIdentityKey,
  type QuoteLead,
  type QuoteLeadAttribution,
  type QuoteLeadStatus,
} from '../../../_modules/quote-leads-pure.js';

export { quoteLeadIdentityKey } from '../../../_modules/quote-leads-pure.js';
export type { QuoteLeadStatus } from '../../../_modules/quote-leads-pure.js';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const MAX_SEARCH_LENGTH = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_SANITY_ID = /^[A-Za-z0-9_.-]{1,255}$/;

export type QuoteLeadInput = Record<string, unknown>;

export interface QuoteLeadListOptions {
  status?: QuoteLeadStatus | 'all';
  source?: string;
  q?: string;
  limit?: number;
}

export type QuoteLeadPatch = Partial<QuoteLead> & {
  status?: QuoteLeadStatus;
  quotationId?: string | null;
};

export interface QuoteLeadRecord extends QuoteLead {
  identityKey: string;
  crmDealId: string | null;
  created?: boolean;
}

export interface QuoteLeadRepository {
  upsert(input: QuoteLeadInput): Promise<QuoteLeadRecord>;
  ingestSiteSubmission(input: QuoteLeadInput): Promise<QuoteLeadRecord>;
  findByExternalId(externalId: string, source?: string): Promise<QuoteLeadRecord | null>;
  /**
   * Original ingestion identity of an admission that carried no explicit
   * demand: the external key with `demand_id IS NULL`. The identity key is
   * unique, so this is exact — never a conversation-wide guess between
   * demands sharing a transport key.
   */
  findByExternalIdWithoutDemand(
    externalId: string,
    source?: string
  ): Promise<QuoteLeadRecord | null>;
  findByDemandId(demandId: string, source?: string): Promise<QuoteLeadRecord | null>;
  list(options?: QuoteLeadListOptions): Promise<Array<QuoteLeadRecord & { texto: string }>>;
  update(id: string, patch: QuoteLeadPatch): Promise<(QuoteLeadRecord & { texto: string }) | null>;
}

function siteSubmissionMetadata(
  raw: unknown
): { payloadFingerprint: string; originalCreatedAt: string } | null {
  if (!isRecord(raw) || !isRecord(raw.siteSubmission)) return null;
  const payloadFingerprint = cleanText(raw.siteSubmission.payloadFingerprint);
  const originalCreatedAt = cleanText(raw.siteSubmission.originalCreatedAt);
  return payloadFingerprint && originalCreatedAt ? { payloadFingerprint, originalCreatedAt } : null;
}

export interface QuoteLeadRepositoryOptions {
  now?: () => Date;
  idFactory?: () => string;
}

type DatabaseProvider = () => AppDatabase;
export type QuoteLeadTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type QuoteLeadRow = typeof quoteLeads.$inferSelect;
type CrmDealRow = typeof crmDeals.$inferSelect;
type Timestamp = Date | string;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeTimestamp(value: Timestamp | null | undefined, fallback = new Date()): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? new Date(fallback.getTime()) : date;
}

function isoTimestamp(value: Timestamp | null | undefined, fallback?: Date): string {
  return normalizeTimestamp(value, fallback).toISOString();
}

function nowDate(factory: () => Date): Date {
  return normalizeTimestamp(factory());
}

function strictAfter(candidate: Date, previous: Timestamp): Date {
  const prior = normalizeTimestamp(previous, new Date(0));
  return candidate.getTime() > prior.getTime() ? candidate : new Date(prior.getTime() + 1);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIST_LIMIT;
  return Math.max(1, Math.min(Math.floor(value), MAX_LIST_LIMIT));
}

function normalizedSearch(value: string | undefined): string {
  const search = cleanText(value);
  if (search.length > MAX_SEARCH_LENGTH) throw createHttpError(400, 'Busca muito longa.');
  return search;
}

function isQuoteLeadStatus(value: unknown): value is QuoteLeadStatus {
  return (
    value === 'new' ||
    value === 'incomplete' ||
    value === 'ready' ||
    value === 'reviewing' ||
    value === 'converted' ||
    value === 'discarded'
  );
}

function quotationReference(value: unknown): string | null {
  const normalized = cleanText(value);
  return normalized || null;
}

async function resolveQuotationId(
  database: QuoteLeadTransaction,
  value: unknown
): Promise<string | null> {
  const reference = quotationReference(value);
  if (!reference) return null;
  const [row] = await database
    .select({ id: quotations.id })
    .from(quotations)
    .where(
      isUuid(reference) ? eq(quotations.id, reference) : eq(quotations.businessNumber, reference)
    )
    .limit(1);
  if (!row) throw createHttpError(400, 'Orçamento não encontrado.');
  return row.id;
}

function ensureId(idFactory: () => string): string {
  const id = idFactory();
  if (!isUuid(id)) throw createHttpError(503, 'Não foi possível gerar o identificador do lead.');
  return id;
}

function normalizedInput(
  input: QuoteLeadInput,
  idFactory: () => string,
  timestamp: Date
): QuoteLead {
  if (!isRecord(input)) throw createHttpError(400, 'Envie os dados do lead em um objeto válido.');
  const suppliedId = cleanText(input.id);
  const id = isUuid(suppliedId) ? suppliedId : ensureId(idFactory);
  const prepared: Record<string, unknown> = { ...input, id };
  delete prepared.createdAt;
  delete prepared.updatedAt;
  const lead = normalizeQuoteLeadInput(prepared, {
    now: () => timestamp.toISOString(),
    id: () => id,
  });
  lead.id = id;
  lead.quotationId = quotationReference(input.quotationId ?? input.quotation_id);
  return lead;
}

function rowToRecord(row: QuoteLeadRow, created?: boolean): QuoteLeadRecord {
  const createdAt = isoTimestamp(row.createdAt);
  const updatedAt = isoTimestamp(row.updatedAt, new Date(createdAt));
  const normalized = normalizeQuoteLeadInput(
    {
      id: row.id,
      nome: row.nome || '',
      email: row.email || '',
      telefone: row.telefone || '',
      pedidoTexto: row.pedidoTexto || '',
      source: row.source,
      sourceDetail: row.sourceDetail || '',
      externalId: row.externalId || null,
      demandId: row.demandId || null,
      empresa: row.empresa || '',
      produto: row.produto || '',
      quantidade: row.quantidade || '',
      finalidade: row.finalidade || '',
      prazo: row.prazo || '',
      arte: row.arte || '',
      quotationId: row.quotationId,
      attribution: row.attribution,
      raw: row.raw,
    },
    { now: () => updatedAt, id: () => row.id }
  );

  return {
    ...normalized,
    id: row.id,
    status: isQuoteLeadStatus(row.status) ? row.status : normalized.status,
    attribution: (row.attribution as QuoteLeadAttribution | null) || normalized.attribution,
    raw: (row.raw as Record<string, unknown> | null) || undefined,
    quotationId: row.quotationId,
    identityKey: row.identityKey,
    crmDealId: row.crmDealId,
    createdAt,
    updatedAt,
    created,
  };
}

function rowValues(
  lead: QuoteLeadRecord,
  createdAt: Date,
  updatedAt: Date,
  includeIdentity = true
) {
  return {
    ...(includeIdentity ? { identityKey: lead.identityKey } : {}),
    nome: lead.nome || null,
    email: lead.email || null,
    telefone: lead.telefone || null,
    pedidoTexto: lead.pedidoTexto || null,
    source: lead.source || 'typebot',
    sourceDetail: lead.sourceDetail || null,
    externalId: lead.externalId || null,
    demandId: lead.demandId || null,
    empresa: lead.empresa || null,
    produto: lead.produto || null,
    quantidade: lead.quantidade || null,
    finalidade: lead.finalidade || null,
    prazo: lead.prazo || null,
    arte: lead.arte || null,
    attribution: lead.attribution ? { ...lead.attribution } : null,
    raw: lead.raw || null,
    status: lead.status,
    quotationId: lead.quotationId || null,
    createdAt,
    updatedAt,
  };
}

function safeError(error: unknown): never {
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 0;
  if (statusCode >= 400 && statusCode < 500) throw error;
  if (statusCode === 503) throw error;
  console.error('[quote-leads-repository]', error instanceof Error ? error.name : typeof error);
  throw createHttpError(503, 'Não foi possível acessar a fila de leads.');
}

async function selectLeadForUpdate(
  database: QuoteLeadTransaction | AppDatabase,
  identityKey: string
): Promise<QuoteLeadRow | null> {
  const [row] = await database
    .select()
    .from(quoteLeads)
    .where(eq(quoteLeads.identityKey, identityKey))
    .for('update')
    .limit(1);
  return row || null;
}

async function selectDealForUpdate(
  database: QuoteLeadTransaction,
  leadId: string,
  dealId: string | null
): Promise<CrmDealRow | null> {
  if (dealId) {
    const [linked] = await database
      .select()
      .from(crmDeals)
      .where(eq(crmDeals.id, dealId))
      .for('update')
      .limit(1);
    if (linked) return linked;
  }
  const [byLead] = await database
    .select()
    .from(crmDeals)
    .where(eq(crmDeals.quoteLeadId, leadId))
    .for('update')
    .limit(1);
  return byLead || null;
}

async function ensureDeal(
  database: QuoteLeadTransaction,
  lead: QuoteLeadRecord,
  now: Date,
  idFactory: () => string
): Promise<string> {
  const initialDemand = lead.pedidoTexto || null;
  const existing = await selectDealForUpdate(database, lead.id, lead.crmDealId);
  if (existing) {
    const updatedAt = strictAfter(now, existing.updatedAt);
    await database
      .update(crmDeals)
      .set({
        nome: lead.nome || existing.nome || 'Sem nome',
        email: lead.email || null,
        telefone: lead.telefone || null,
        // The opportunity records the demand that opened it. A later request
        // for the same identity must not silently redefine that demand.
        demandSummary: existing.demandSummary || initialDemand,
        updatedAt,
      })
      .where(eq(crmDeals.id, existing.id));
    await ensureFirstContactAction(database, {
      opportunityId: existing.id,
      dueAt: now,
      idFactory: () => ensureId(idFactory),
    });
    return existing.id;
  }

  const id = ensureId(idFactory);
  const [created] = await database
    .insert(crmDeals)
    .values({
      id,
      quoteLeadId: lead.id,
      nome: lead.nome || 'Sem nome',
      email: lead.email || null,
      telefone: lead.telefone || null,
      status: 'Novo Lead',
      followUpStage: 0,
      nextStep: null,
      demandSummary: initialDemand,
      lostReason: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) throw createHttpError(503, 'Não foi possível criar a oportunidade local.');
  await ensureFirstContactAction(database, {
    opportunityId: created.id,
    dueAt: now,
    idFactory: () => ensureId(idFactory),
  });
  return created.id;
}

async function updateDealSnapshot(
  database: QuoteLeadTransaction,
  lead: QuoteLeadRecord,
  now: Date
): Promise<void> {
  const deal = await selectDealForUpdate(database, lead.id, lead.crmDealId);
  if (!deal) return;
  await database
    .update(crmDeals)
    .set({
      nome: lead.nome || deal.nome || 'Sem nome',
      email: lead.email || null,
      telefone: lead.telefone || null,
      // Same rule as ensureDeal: only an empty initial demand is filled in.
      demandSummary: deal.demandSummary || lead.pedidoTexto || null,
      updatedAt: strictAfter(now, deal.updatedAt),
    })
    .where(eq(crmDeals.id, deal.id));
}

function cleanMergeInput(current: QuoteLeadRecord, patch: QuoteLeadPatch): QuoteLeadInput {
  const input: QuoteLeadInput = {
    ...current,
    ...patch,
    id: current.id,
    attribution: undefined,
  };
  if (patch.quotationId !== undefined) input.quotationId = patch.quotationId;
  return input;
}

/**
 * Marks a lead as converted inside an already-open quotation transaction.
 * The caller owns the transaction so a PDF or quotation write failure rolls
 * this update back with the commercial aggregate.
 */
export async function convertQuoteLeadInTransaction(
  transaction: QuoteLeadTransaction,
  leadId: string,
  quotationId: string,
  timestamp: Date
): Promise<void> {
  if (!isUuid(leadId)) throw createHttpError(400, 'Identificador do lead inválido.');
  if (!isUuid(quotationId)) throw createHttpError(400, 'Identificador do orçamento inválido.');
  const [lead] = await transaction
    .select()
    .from(quoteLeads)
    .where(eq(quoteLeads.id, leadId))
    .for('update')
    .limit(1);
  if (!lead) throw createHttpError(404, 'Lead de orçamento não encontrado.');
  if (lead.status === 'discarded')
    throw createHttpError(409, 'Lead de orçamento descartado não pode ser convertido.');
  const updatedAt = strictAfter(timestamp, lead.updatedAt);
  await transaction
    .update(quoteLeads)
    .set({ status: 'converted', quotationId, updatedAt })
    .where(eq(quoteLeads.id, leadId));
}

export function createPostgresQuoteLeadRepository(
  getDb: DatabaseProvider = getDatabase,
  options: QuoteLeadRepositoryOptions = {}
): QuoteLeadRepository {
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;

  const repository: QuoteLeadRepository = {
    async findByExternalId(externalId: string, source?: string): Promise<QuoteLeadRecord | null> {
      const normalizedExternalId = cleanText(externalId);
      const normalizedSource = source === undefined ? '' : cleanText(source);
      if (!normalizedExternalId || (source !== undefined && !normalizedSource)) return null;
      try {
        const database = getDb();
        const filters = [eq(quoteLeads.externalId, normalizedExternalId)];
        if (normalizedSource) filters.push(eq(quoteLeads.source, normalizedSource));
        const rows = await database
          .select()
          .from(quoteLeads)
          .where(and(...filters))
          .orderBy(asc(quoteLeads.id))
          .limit(2);
        if (rows.length > 1) {
          if (normalizedSource === 'whatsapp') {
            throw createHttpError(409, 'Identificador externo do WhatsApp ambíguo.');
          }
          return null;
        }
        return rows[0] ? rowToRecord(rows[0]) : null;
      } catch (error) {
        return safeError(error);
      }
    },

    async findByDemandId(demandId: string, source?: string): Promise<QuoteLeadRecord | null> {
      const normalizedDemandId = cleanText(demandId);
      const normalizedSource = source === undefined ? '' : cleanText(source);
      if (!normalizedDemandId) return null;
      try {
        const database = getDb();
        const filters = [eq(quoteLeads.demandId, normalizedDemandId)];
        if (normalizedSource) filters.push(eq(quoteLeads.source, normalizedSource));
        const rows = await database
          .select()
          .from(quoteLeads)
          .where(and(...filters))
          .orderBy(asc(quoteLeads.id))
          .limit(2);
        if (rows.length > 1) {
          throw createHttpError(409, 'Identidade de demanda ambígua.');
        }
        return rows[0] ? rowToRecord(rows[0]) : null;
      } catch (error) {
        return safeError(error);
      }
    },

    async findByExternalIdWithoutDemand(
      externalId: string,
      source?: string
    ): Promise<QuoteLeadRecord | null> {
      const normalizedExternalId = cleanText(externalId);
      const normalizedSource = source === undefined ? '' : cleanText(source);
      if (!normalizedExternalId || (source !== undefined && !normalizedSource)) return null;
      try {
        const database = getDb();
        const filters = [
          eq(quoteLeads.externalId, normalizedExternalId),
          isNull(quoteLeads.demandId),
        ];
        if (normalizedSource) filters.push(eq(quoteLeads.source, normalizedSource));
        const [row] = await database
          .select()
          .from(quoteLeads)
          .where(and(...filters))
          .limit(1);
        return row ? rowToRecord(row) : null;
      } catch (error) {
        return safeError(error);
      }
    },

    async upsert(input: QuoteLeadInput): Promise<QuoteLeadRecord> {
      const timestamp = nowDate(now);
      const incoming = normalizedInput(input, idFactory, timestamp);
      const identityKey = quoteLeadIdentityKey(incoming);
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
          incoming.quotationId = await resolveQuotationId(transaction, incoming.quotationId);
          const incomingRecord = {
            ...incoming,
            identityKey,
            crmDealId: null,
          } as QuoteLeadRecord;
          const [inserted] = await transaction
            .insert(quoteLeads)
            .values({
              ...rowValues(incomingRecord, timestamp, timestamp),
              id: incoming.id,
            } as never)
            .onConflictDoNothing({ target: quoteLeads.identityKey })
            .returning();

          const row = await selectLeadForUpdate(transaction, identityKey);
          if (!row) throw createHttpError(503, 'Não foi possível salvar o lead de orçamento.');

          let lead = rowToRecord(row, Boolean(inserted));
          if (!inserted) {
            // A demand id is a durable identity bound to the conversation that
            // first admitted it. A different conversation reusing the same id is
            // a conflict, never a merge: keep the original lead, contact,
            // opportunity and action untouched.
            if (
              incoming.demandId &&
              row.demandId === incoming.demandId &&
              row.externalId &&
              incoming.externalId &&
              row.externalId !== incoming.externalId
            ) {
              throw createHttpError(409, 'Esta demanda já está vinculada a outra conversa.');
            }
            const merged = {
              ...mergeQuoteLead(lead, incoming, timestamp.toISOString()),
              id: lead.id,
              quotationId: incoming.quotationId || lead.quotationId || null,
              identityKey,
              crmDealId: lead.crmDealId,
            } as QuoteLeadRecord;
            const updatedAt = strictAfter(timestamp, row.updatedAt);
            await transaction
              .update(quoteLeads)
              .set(rowValues(merged, normalizeTimestamp(row.createdAt), updatedAt))
              .where(eq(quoteLeads.id, row.id));
            const [updated] = await transaction
              .select()
              .from(quoteLeads)
              .where(eq(quoteLeads.id, row.id))
              .limit(1);
            if (!updated)
              throw createHttpError(503, 'Não foi possível atualizar o lead de orçamento.');
            lead = rowToRecord(updated, false);
          }

          const dealId = await ensureDeal(transaction, lead, timestamp, idFactory);
          if (lead.crmDealId !== dealId) {
            await transaction
              .update(quoteLeads)
              .set({ crmDealId: dealId, updatedAt: normalizeTimestamp(lead.updatedAt) })
              .where(eq(quoteLeads.id, lead.id));
            lead.crmDealId = dealId;
          }
          return { ...lead, created: Boolean(inserted) };
        });
      } catch (error) {
        return safeError(error);
      }
    },

    async ingestSiteSubmission(input: QuoteLeadInput): Promise<QuoteLeadRecord> {
      const timestamp = nowDate(now);
      const externalId = cleanText(input.externalId);
      const payloadFingerprint = cleanText(input.payloadFingerprint);
      const originalCreatedAt = cleanText(input.originalCreatedAt);
      const originalDate = new Date(originalCreatedAt);
      if (
        !SAFE_SANITY_ID.test(externalId) ||
        !SHA256_PATTERN.test(payloadFingerprint) ||
        !Number.isFinite(originalDate.getTime()) ||
        originalDate.toISOString() !== originalCreatedAt
      ) {
        throw createHttpError(400, 'Identidade durável da solicitação é obrigatória.');
      }
      const incoming = normalizedInput(
        {
          ...input,
          source: 'site_form',
          externalId,
          raw: {
            siteSubmission: {
              payloadFingerprint,
              originalCreatedAt,
              consent: isRecord(input.consent) ? input.consent : null,
              primaryAdIdentifier: cleanText(input.gclid)
                ? 'gclid'
                : cleanText(input.wbraid)
                  ? 'wbraid'
                  : cleanText(input.gbraid)
                    ? 'gbraid'
                    : null,
            },
          },
        },
        idFactory,
        timestamp
      );
      const identityKey = quoteLeadIdentityKey(incoming);
      try {
        return await getDb().transaction(async (transaction) => {
          const incomingRecord = {
            ...incoming,
            identityKey,
            crmDealId: null,
          } as QuoteLeadRecord;
          const [inserted] = await transaction
            .insert(quoteLeads)
            .values({
              ...rowValues(incomingRecord, timestamp, timestamp),
              id: incoming.id,
            } as never)
            .onConflictDoNothing({ target: quoteLeads.identityKey })
            .returning();
          const row = await selectLeadForUpdate(transaction, identityKey);
          if (!row) throw createHttpError(503, 'Não foi possível salvar o lead de orçamento.');

          const existingMetadata = siteSubmissionMetadata(row.raw);
          if (!inserted && existingMetadata?.payloadFingerprint !== payloadFingerprint) {
            throw createHttpError(409, 'A submissão já existe com conteúdo diferente.');
          }
          const lead = rowToRecord(row, Boolean(inserted));
          const dealId = await ensureDeal(transaction, lead, timestamp, idFactory);
          if (lead.crmDealId !== dealId) {
            await transaction
              .update(quoteLeads)
              .set({ crmDealId: dealId, updatedAt: normalizeTimestamp(lead.updatedAt) })
              .where(eq(quoteLeads.id, lead.id));
            lead.crmDealId = dealId;
          }
          return { ...lead, created: Boolean(inserted) };
        });
      } catch (error) {
        return safeError(error);
      }
    },

    async list(
      options: QuoteLeadListOptions = {}
    ): Promise<Array<QuoteLeadRecord & { texto: string }>> {
      const status = options.status || 'new';
      const source = cleanText(options.source || 'all');
      const search = normalizedSearch(options.q);
      const limit = normalizedLimit(options.limit);
      try {
        const database = getDb();
        const filters: SQL[] = [];
        if (status !== 'all') filters.push(eq(quoteLeads.status, status));
        if (source && source !== 'all') filters.push(eq(quoteLeads.source, source));
        if (search) {
          const pattern = `%${escapeLike(search.toLowerCase())}%`;
          const searchFilter = or(
            ilike(quoteLeads.nome, pattern),
            ilike(quoteLeads.email, pattern),
            ilike(quoteLeads.telefone, pattern),
            ilike(quoteLeads.pedidoTexto, pattern)
          );
          if (searchFilter) filters.push(searchFilter);
        }
        const rows = await database
          .select()
          .from(quoteLeads)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(desc(quoteLeads.updatedAt), desc(quoteLeads.createdAt), asc(quoteLeads.id))
          .limit(limit);
        return rows.map((row) => {
          const lead = rowToRecord(row);
          return { ...lead, texto: formatQuoteLeadText(lead) };
        });
      } catch (error) {
        return safeError(error);
      }
    },

    async update(
      id: string,
      patch: QuoteLeadPatch
    ): Promise<(QuoteLeadRecord & { texto: string }) | null> {
      if (!isUuid(id)) return null;
      if (!isRecord(patch)) throw createHttpError(400, 'Dados de atualização inválidos.');
      const timestamp = nowDate(now);
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
          const [row] = await transaction
            .select()
            .from(quoteLeads)
            .where(eq(quoteLeads.id, id))
            .for('update')
            .limit(1);
          if (!row) return null;

          const current = rowToRecord(row);
          const normalized = normalizedInput(cleanMergeInput(current, patch), () => id, timestamp);
          const mergedBase = mergeQuoteLead(current, normalized, timestamp.toISOString());
          const merged = {
            ...mergedBase,
            id,
            identityKey: quoteLeadIdentityKey(mergedBase),
            crmDealId: current.crmDealId,
          } as QuoteLeadRecord;
          if (Object.prototype.hasOwnProperty.call(patch, 'quotationId')) {
            merged.quotationId = await resolveQuotationId(transaction, patch.quotationId);
          } else {
            merged.quotationId = current.quotationId;
          }
          const updatedAt = strictAfter(timestamp, row.updatedAt);
          await transaction
            .update(quoteLeads)
            .set(rowValues(merged, normalizeTimestamp(row.createdAt), updatedAt))
            .where(eq(quoteLeads.id, id));
          const [updated] = await transaction
            .select()
            .from(quoteLeads)
            .where(eq(quoteLeads.id, id))
            .limit(1);
          if (!updated) return null;
          const saved = rowToRecord(updated);
          await updateDealSnapshot(transaction, saved, timestamp);
          return { ...saved, texto: formatQuoteLeadText(saved) };
        });
      } catch (error) {
        return safeError(error);
      }
    },
  };

  return repository;
}

export const createQuoteLeadRepository = createPostgresQuoteLeadRepository;
export const createPostgresQuoteLeadsRepository = createPostgresQuoteLeadRepository;
