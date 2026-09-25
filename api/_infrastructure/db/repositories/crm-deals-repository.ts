import { and, asc, desc, eq, ilike, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from '../client.js';
import {
  crmDeals,
  crmPipelineStages,
  quoteLeads,
  quoteRevisions,
  quotations,
} from '../schema.js';
import { cancelQuotationFollowUpForFact } from './quotation-follow-up-facts.js';
import { safeErrorSummary } from '../../../_shared/safe-error.js';

export const CRM_PIPELINE = [
  'Novo Lead',
  'Contato Feito',
  'Orcamento Enviado',
  'Em Negociacao',
  'Arte Aprovada',
  'Pedido Fechado',
  'Perdido',
] as const;

export type CrmDealStatus = (typeof CRM_PIPELINE)[number];
export type CrmTimestamp = Date | string;

export const CRM_ISSUED_STATUS: CrmDealStatus = 'Orcamento Enviado';
export const CRM_LOST_STATUS: CrmDealStatus = 'Perdido';

const DEFAULT_LIST_LIMIT = 500;
const MAX_LIST_LIMIT = 500;
const MAX_SEARCH_LENGTH = 200;

export class CrmDealInputError extends Error {
  readonly statusCode = 400;
  readonly logMessage: string;

  constructor(message: string) {
    super(message);
    this.name = 'CrmDealInputError';
    this.logMessage = message;
  }
}

export class CrmDealRepositoryError extends Error {
  readonly statusCode = 503;
  readonly logMessage: string;

  constructor(message = 'Não foi possível acessar as oportunidades locais.') {
    super(message);
    this.name = 'CrmDealRepositoryError';
    this.logMessage = message;
  }
}

export interface CrmDealRecord {
  id: string;
  quoteLeadId: string | null;
  clientId: string | null;
  quotationId: string | null;
  nome: string;
  email: string | null;
  telefone: string | null;
  status: string;
  followUpStage: number;
  lostReason: string | null;
  createdAt: CrmTimestamp;
  updatedAt: CrmTimestamp;
  quotation?: string | null;
  leadSource?: string | null;
}

export interface CrmDealListOptions {
  search?: string;
  limit?: number;
}

export interface CrmDealStatusPatch {
  status: string;
  followUpStage?: number | null;
}

export interface CrmDealUpsertInput {
  quotationId?: unknown;
  quotation_id?: unknown;
  quoteLeadId?: unknown;
  quote_lead_id?: unknown;
  clientId?: unknown;
  client_id?: unknown;
  /** Demanda persistida na proposta. Quando informada, é a identidade da
   * oportunidade: o upsert resolve esse registro e nunca infere outro por
   * cliente, telefone ou pela ponteiro legado `quotation_id`. */
  opportunityId?: unknown;
  opportunity_id?: unknown;
  id?: unknown;
  nome?: unknown;
  lead_name?: unknown;
  email?: unknown;
  telefone?: unknown;
  status?: unknown;
  followUpStage?: unknown;
  follow_up_stage?: unknown;
  lostReason?: unknown;
  lost_reason?: unknown;
}

export interface CrmDealRepository {
  list(options: CrmDealListOptions): Promise<CrmDealRecord[]>;
  updateStatus(id: string, patch: CrmDealStatusPatch): Promise<CrmDealRecord | null>;
  upsertForQuotation(input: CrmDealUpsertInput): Promise<CrmDealRecord>;
}

export interface CrmDealRepositoryOptions {
  now?: () => Date;
  idFactory?: () => string;
}

type DatabaseProvider = () => AppDatabase;
export type CrmTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
export type CrmDatabase = AppDatabase | CrmTransaction;
type CrmDealRow = typeof crmDeals.$inferSelect;
type QuoteLeadRow = typeof quoteLeads.$inferSelect;

export interface UpsertCrmDealForQuotationOptions {
  now?: Date;
  idFactory?: () => string;
  /**
   * Which fact is allowed to advance the commercial stage. The document alone
   * (`document`, the default) never sets `Orcamento Enviado`: issuing a quotation
   * proves the PDF exists, not that the customer received it. Only the provider
   * acceptance of a real dispatch (`provider_acceptance`) authorizes the stage.
   */
  promoteStage?: 'document' | 'provider_acceptance';
}

function parseTimestamp(value: unknown): Date | null {
  const candidate = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function asValidDate(value: unknown, fallback = new Date()): Date {
  return parseTimestamp(value) || new Date(fallback.getTime());
}

function nowFrom(factory: () => Date): Date {
  return asValidDate(factory());
}

function strictlyAfter(candidate: Date, previous: unknown): Date {
  const prior = asValidDate(previous, new Date(0));
  return candidate.getTime() > prior.getTime() ? candidate : new Date(prior.getTime() + 1);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown, label: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new CrmDealInputError(`${label} deve ser texto.`);
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new CrmDealInputError(`${label} deve ter no máximo ${max} caracteres.`);
  }
  return normalized || null;
}

function requiredName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CrmDealInputError('Nome da oportunidade é obrigatório.');
  }
  const normalized = value.trim();
  if (normalized.length > 200) {
    throw new CrmDealInputError('Nome da oportunidade deve ter no máximo 200 caracteres.');
  }
  return normalized;
}

function normalizedEmail(value: unknown, label = 'Email'): string | null | undefined {
  const normalized = optionalText(value, label, 254);
  return normalized === undefined || normalized === null ? normalized : normalized.toLowerCase();
}

function normalizedPhone(value: unknown): string | null | undefined {
  const normalized = optionalText(value, 'Telefone', 32);
  if (normalized === undefined || normalized === null) return normalized;
  const digits = normalized.replace(/\D/g, '');
  if (!digits) return null;
  if (!/^\d{10,15}$/.test(digits)) {
    throw new CrmDealInputError('Telefone deve conter entre 10 e 15 dígitos.');
  }
  return digits;
}

function normalizedId(value: unknown, label: string): string {
  const normalized = cleanString(value);
  if (!normalized) throw new CrmDealInputError(`${label} é obrigatório.`);
  return normalized;
}

function normalizedStatus(value: unknown): CrmDealStatus {
  if (typeof value !== 'string' || !CRM_PIPELINE.includes(value as CrmDealStatus)) {
    throw new CrmDealInputError('Status inválido.');
  }
  return value as CrmDealStatus;
}

function normalizedStageKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 32) {
    throw new CrmDealInputError('Status inválido.');
  }
  return value.trim();
}

function normalizedFollowUpStage(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647) {
    throw new CrmDealInputError('Estágio de follow-up inválido.');
  }
  return value;
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isFinite(value) || value < 1) throw new CrmDealInputError('Limite inválido.');
  return Math.min(Math.floor(value), MAX_LIST_LIMIT);
}

function normalizedSearch(value: string | undefined): string {
  const normalized = (value || '').trim();
  if (normalized.length > MAX_SEARCH_LENGTH) throw new CrmDealInputError('Busca muito longa.');
  return normalized;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function mapRow(row: CrmDealRow, quotation: string | null = null): CrmDealRecord {
  return {
    id: row.id,
    quoteLeadId: row.quoteLeadId,
    clientId: row.clientId,
    quotationId: row.quotationId,
    nome: row.nome,
    email: row.email,
    telefone: row.telefone,
    status: row.status,
    followUpStage: row.followUpStage,
    lostReason: row.lostReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    quotation,
  };
}

function safeRepositoryError(error: unknown): never {
  if (error instanceof CrmDealInputError || error instanceof CrmDealRepositoryError) {
    throw error;
  }
  console.error('[crm-deals-repository]', safeErrorSummary(error));
  throw new CrmDealRepositoryError();
}

async function dealWithQuotation(database: CrmDatabase, id: string): Promise<CrmDealRecord | null> {
  const [row] = await database.select().from(crmDeals).where(eq(crmDeals.id, id)).limit(1);
  if (!row) return null;
  const [quotation] = row.quotationId
    ? await database
        .select({ businessNumber: quotations.businessNumber })
        .from(quotations)
        .where(eq(quotations.id, row.quotationId))
        .limit(1)
    : [];
  return mapRow(row, quotation?.businessNumber || null);
}

const ISSUED_STAGE_INDEX = CRM_PIPELINE.indexOf(CRM_ISSUED_STATUS);

function nextIssuanceStatus(
  existingStatus: string,
  statusValue: CrmDealStatus | undefined,
  promoteStage: 'document' | 'provider_acceptance'
): CrmDealStatus | undefined {
  if (existingStatus === CRM_LOST_STATUS) return undefined;
  if (statusValue !== undefined) return statusValue;
  // The document was created, nothing was dispatched: the stage is left exactly
  // where the operator put it.
  if (promoteStage !== 'provider_acceptance') return undefined;
  const currentIndex = CRM_PIPELINE.indexOf(existingStatus as CrmDealStatus);
  if (currentIndex >= 0 && currentIndex < ISSUED_STAGE_INDEX) return CRM_ISSUED_STATUS;
  return undefined;
}

async function selectLeadForQuotation(
  database: CrmDatabase,
  quotationId: string
): Promise<QuoteLeadRow | null> {
  const [lead] = await database
    .select()
    .from(quoteLeads)
    .where(eq(quoteLeads.quotationId, quotationId))
    .orderBy(asc(quoteLeads.id))
    .for('update')
    .limit(1);
  return lead || null;
}

async function selectDealForLead(
  database: CrmDatabase,
  lead: QuoteLeadRow
): Promise<CrmDealRow | null> {
  if (lead.crmDealId) {
    const [linked] = await database
      .select()
      .from(crmDeals)
      .where(eq(crmDeals.id, lead.crmDealId))
      .for('update')
      .limit(1);
    if (linked) return linked;
  }
  const [byLead] = await database
    .select()
    .from(crmDeals)
    .where(eq(crmDeals.quoteLeadId, lead.id))
    .orderBy(desc(crmDeals.updatedAt), asc(crmDeals.id))
    .for('update')
    .limit(1);
  return byLead || null;
}

/**
 * Resolves the demand explicitly carried by the proposal. Unlike the legacy
 * search by `quotation_id` or lead, this is an identity lookup: it never picks
 * a candidate by client, phone or recency, so an established demand cannot be
 * shadowed by a stale legacy pointer.
 */
async function selectDemandById(
  database: CrmDatabase,
  opportunityId: string
): Promise<CrmDealRow> {
  const [deal] = await database
    .select()
    .from(crmDeals)
    .where(eq(crmDeals.id, opportunityId))
    .for('update')
    .limit(1);
  if (!deal) throw new CrmDealInputError('A oportunidade informada não foi encontrada.');
  return deal;
}

async function resolveExistingDeal(
  database: CrmDatabase,
  quotationId: string,
  lead: QuoteLeadRow | null
): Promise<CrmDealRow | null> {
  const [active] = await database
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.quotationId, quotationId), ne(crmDeals.status, CRM_LOST_STATUS)))
    .for('update')
    .limit(1);
  if (active) return active;

  const [lost] = await database
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.quotationId, quotationId), eq(crmDeals.status, CRM_LOST_STATUS)))
    .orderBy(desc(crmDeals.updatedAt), desc(crmDeals.createdAt), asc(crmDeals.id))
    .for('update')
    .limit(1);
  if (lost) return lost;

  if (!lead) return null;
  const leadDeal = await selectDealForLead(database, lead);
  if (!leadDeal) return null;
  if (leadDeal.quotationId && leadDeal.quotationId !== quotationId) return null;
  return leadDeal;
}

async function syncLeadDealLink(
  database: CrmDatabase,
  lead: QuoteLeadRow | null,
  dealId: string,
  timestamp: Date
): Promise<void> {
  if (!lead) return;
  if (lead.crmDealId && lead.crmDealId !== dealId) return;
  if (lead.crmDealId === dealId) return;
  await database
    .update(quoteLeads)
    .set({ crmDealId: dealId, updatedAt: strictlyAfter(timestamp, lead.updatedAt) })
    .where(eq(quoteLeads.id, lead.id));
}

/** Persist a CRM deal using an already-open database/transaction. */
export async function upsertCrmDealForQuotation(
  database: CrmDatabase,
  input: CrmDealUpsertInput,
  options: UpsertCrmDealForQuotationOptions = {}
): Promise<CrmDealRecord> {
  const quotationId = normalizedId(input?.quotationId ?? input?.quotation_id, 'quotation_id');
  const nameValue = input?.nome ?? input?.lead_name;
  const emailValue = normalizedEmail(input?.email);
  const phoneValue = normalizedPhone(input?.telefone);
  const clientId = input?.clientId ?? input?.client_id;
  const quoteLeadId = input?.quoteLeadId ?? input?.quote_lead_id;
  const statusValue = input?.status === undefined ? undefined : normalizedStatus(input.status);
  const followUpStage = normalizedFollowUpStage(input?.followUpStage ?? input?.follow_up_stage);
  const lostReason = optionalText(input?.lostReason ?? input?.lost_reason, 'Motivo da perda', 500);
  const normalizedClientId =
    clientId === undefined || clientId === null ? null : normalizedId(clientId, 'client_id');
  const normalizedQuoteLeadId =
    quoteLeadId === undefined || quoteLeadId === null
      ? null
      : normalizedId(quoteLeadId, 'quote_lead_id');
  const opportunityValue = input?.opportunityId ?? input?.opportunity_id;
  const normalizedOpportunityId =
    opportunityValue === undefined || opportunityValue === null
      ? null
      : normalizedId(opportunityValue, 'opportunity_id');
  const timestamp = asValidDate(options.now);
  const makeId = options.idFactory || randomUUID;
  const promoteStage = options.promoteStage || 'document';

  const lead = await selectLeadForQuotation(database, quotationId);
  const viaOpportunity = normalizedOpportunityId !== null;
  const existing = viaOpportunity
    ? await selectDemandById(database, normalizedOpportunityId)
    : await resolveExistingDeal(database, quotationId, lead);
  if (existing && viaOpportunity && existing.clientId && normalizedClientId && existing.clientId !== normalizedClientId) {
    throw new CrmDealInputError('A oportunidade informada não pertence a este cliente.');
  }
  const quoteLeadPatch =
    quoteLeadId !== undefined
      ? { quoteLeadId: normalizedQuoteLeadId }
      : existing?.quoteLeadId
        ? {}
        : lead?.id
          ? { quoteLeadId: lead.id }
          : {};

  // Follow-up eligibility follows the stage the deal actually ends with, but
  // only a call that asserted the commercial stage may revoke it: the
  // document-only upsert leaves the stage untouched and has no eligibility to
  // re-evaluate.
  const stageAsserted = statusValue !== undefined || promoteStage === 'provider_acceptance';

  if (existing) {
    const nextStatus = nextIssuanceStatus(existing.status, statusValue, promoteStage);
    const status =
      existing.status === CRM_LOST_STATUS ? existing.status : (nextStatus ?? existing.status);
    const updatedAt = strictlyAfter(timestamp, existing.updatedAt);
    const identityPatch = {
      ...(nameValue === undefined ? {} : { nome: requiredName(nameValue) }),
      ...(emailValue === undefined ? {} : { email: emailValue }),
      ...(phoneValue === undefined ? {} : { telefone: phoneValue }),
      ...(normalizedClientId === null && clientId === undefined
        ? {}
        : { clientId: normalizedClientId }),
      ...quoteLeadPatch,
      // The legacy single pointer is never rewritten when the demand is the
      // authority: it cannot drive the cardinality nor shadow the new link.
      ...(viaOpportunity ? {} : { quotationId }),
      updatedAt,
    };
    if (existing.status === CRM_LOST_STATUS) {
      await database.update(crmDeals).set(identityPatch).where(eq(crmDeals.id, existing.id));
    } else {
      await database
        .update(crmDeals)
        .set({
          ...identityPatch,
          ...(nextStatus === undefined ? {} : { status: nextStatus }),
          ...(followUpStage === undefined ? {} : { followUpStage }),
          lostReason: status === CRM_LOST_STATUS ? (lostReason ?? null) : null,
        })
        .where(eq(crmDeals.id, existing.id));
    }
    if (stageAsserted && status !== CRM_ISSUED_STATUS) {
      await cancelQuotationFollowUpForFact(database, quotationId, 'crm_not_eligible', updatedAt);
    }
    await syncLeadDealLink(database, lead, existing.id, timestamp);
    const updated = await dealWithQuotation(database, existing.id);
    if (!updated) throw new CrmDealRepositoryError();
    return updated;
  }

  const nome = requiredName(nameValue);
  // No stage is invented for a brand-new deal: without an asserted stage the
  // pipeline default applies and the deal waits there until the provider
  // accepts a real dispatch.
  const status =
    statusValue || (promoteStage === 'provider_acceptance' ? CRM_ISSUED_STATUS : undefined);
  const id = normalizedId(input?.id === undefined ? makeId() : input.id, 'id');
  const insertQuoteLeadId = quoteLeadId !== undefined ? normalizedQuoteLeadId : lead?.id || null;
  const [created] = await database
    .insert(crmDeals)
    .values({
      id,
      quoteLeadId: insertQuoteLeadId,
      clientId: normalizedClientId,
      quotationId,
      nome,
      email: emailValue === undefined ? null : emailValue,
      telefone: phoneValue === undefined ? null : phoneValue,
      ...(status === undefined ? {} : { status }),
      followUpStage: followUpStage ?? 0,
      lostReason: lostReason ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .returning();
  const winner =
    created ||
    (
      await database
        .select()
        .from(crmDeals)
        .where(
          and(eq(crmDeals.quotationId, quotationId), ne(crmDeals.status, CRM_LOST_STATUS))
        )
        .limit(1)
    )[0];
  if (!winner) throw new CrmDealRepositoryError();
  if (stageAsserted && winner.status !== CRM_ISSUED_STATUS) {
    await cancelQuotationFollowUpForFact(database, quotationId, 'crm_not_eligible', timestamp);
  }
  await syncLeadDealLink(database, lead, winner.id, timestamp);
  const saved = await dealWithQuotation(database, winner.id);
  if (!saved) throw new CrmDealRepositoryError();
  return saved;
}

/**
 * Advances the commercial stage of the deal behind a revision once WhatsApp
 * accepted the complete dispatch of that revision. Issuing the document no
 * longer calls this: the stage means the provider accepted the quotation, not
 * that a PDF was generated.
 *
 * Idempotent by construction: `upsertCrmDealForQuotation` only advances deals
 * that are still before `Orcamento Enviado` and never revives `Perdido`, so a
 * repeated receipt, a resolution or a replayed callback changes nothing.
 */
export async function promoteDealOnProviderAcceptance(
  database: CrmDatabase,
  input: { revisionId: string },
  options: { now?: Date; idFactory?: () => string } = {}
): Promise<void> {
  const revisionId = normalizedId(input?.revisionId, 'revision_id');
  const [row] = await database
    .select({
      quotationId: quoteRevisions.quotationId,
      nome: quoteRevisions.clienteNome,
      email: quoteRevisions.clienteEmail,
      telefone: quoteRevisions.clienteTelefone,
      clientId: quotations.clientId,
      opportunityId: quotations.opportunityId,
    })
    .from(quoteRevisions)
    .innerJoin(quotations, eq(quotations.id, quoteRevisions.quotationId))
    .where(eq(quoteRevisions.id, revisionId))
    .limit(1);
  if (!row) throw new CrmDealRepositoryError();
  await upsertCrmDealForQuotation(
    database,
    {
      quotationId: row.quotationId,
      clientId: row.clientId,
      opportunityId: row.opportunityId,
      nome: row.nome,
      email: row.email,
      telefone: row.telefone,
    },
    { ...options, promoteStage: 'provider_acceptance' }
  );
}

export function createPostgresCrmDealRepository(
  getDb: DatabaseProvider = getDatabase,
  options: CrmDealRepositoryOptions = {}
): CrmDealRepository {
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;

  const repository: CrmDealRepository = {
    async list({ search, limit } = {}): Promise<CrmDealRecord[]> {
      const normalized = normalizedSearch(search);
      const boundedLimit = normalizedLimit(limit);
      try {
        const database = getDb();
        const fields = {
          id: crmDeals.id,
          quoteLeadId: crmDeals.quoteLeadId,
          clientId: crmDeals.clientId,
          quotationId: crmDeals.quotationId,
          nome: crmDeals.nome,
          email: crmDeals.email,
          telefone: crmDeals.telefone,
          status: crmDeals.status,
          followUpStage: crmDeals.followUpStage,
          lostReason: crmDeals.lostReason,
          createdAt: crmDeals.createdAt,
          updatedAt: crmDeals.updatedAt,
          quotationBusinessNumber: quotations.businessNumber,
          leadSource: quoteLeads.source,
        };
        const order = [desc(crmDeals.updatedAt), desc(crmDeals.createdAt), asc(crmDeals.id)];
        const rows = normalized
          ? await database
              .select(fields)
              .from(crmDeals)
              .leftJoin(quotations, eq(crmDeals.quotationId, quotations.id))
              .leftJoin(quoteLeads, eq(crmDeals.quoteLeadId, quoteLeads.id))
              .where(
                or(
                  ilike(crmDeals.nome, `%${escapeLike(normalized)}%`),
                  ilike(crmDeals.email, `%${escapeLike(normalized)}%`),
                  ilike(crmDeals.telefone, `%${escapeLike(normalized)}%`),
                  ilike(quotations.businessNumber, `%${escapeLike(normalized)}%`)
                )
              )
              .orderBy(...order)
              .limit(boundedLimit)
          : await database
              .select(fields)
              .from(crmDeals)
              .leftJoin(quotations, eq(crmDeals.quotationId, quotations.id))
              .leftJoin(quoteLeads, eq(crmDeals.quoteLeadId, quoteLeads.id))
              .orderBy(...order)
              .limit(boundedLimit);
        return rows.map((row) => ({
          id: row.id,
          quoteLeadId: row.quoteLeadId,
          clientId: row.clientId,
          quotationId: row.quotationId,
          nome: row.nome,
          email: row.email,
          telefone: row.telefone,
          status: row.status,
          followUpStage: row.followUpStage,
          lostReason: row.lostReason,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          quotation: row.quotationBusinessNumber || null,
          leadSource: row.leadSource || null,
        }));
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async updateStatus(id: string, patch: CrmDealStatusPatch): Promise<CrmDealRecord | null> {
      const dealId = normalizedId(id, 'deal_id');
      const status = normalizedStageKey(patch?.status);
      const followUpStage = normalizedFollowUpStage(patch?.followUpStage);
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
          const [stage] = await transaction
            .select({ key: crmPipelineStages.key })
            .from(crmPipelineStages)
            .where(eq(crmPipelineStages.key, status))
            .limit(1);
          if (!stage) throw new CrmDealInputError('Status inválido.');
          const [current] = await transaction
            .select()
            .from(crmDeals)
            .where(eq(crmDeals.id, dealId))
            .for('update')
            .limit(1);
          if (!current) return null;
          const updatedAt = strictlyAfter(nowFrom(now), current.updatedAt);
          await transaction
            .update(crmDeals)
            .set({
              status,
              ...(followUpStage === undefined ? {} : { followUpStage }),
              lostReason: null,
              updatedAt,
            })
            .where(eq(crmDeals.id, dealId));
          if (status !== CRM_ISSUED_STATUS) {
            await cancelQuotationFollowUpForFact(
              transaction,
              current.quotationId,
              'crm_not_eligible',
              updatedAt
            );
          }
          return dealWithQuotation(transaction, dealId);
        });
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async upsertForQuotation(input: CrmDealUpsertInput): Promise<CrmDealRecord> {
      try {
        const database = getDb();
        return await database.transaction((transaction) =>
          upsertCrmDealForQuotation(transaction, input, {
            now: nowFrom(now),
            idFactory,
          })
        );
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

  };

  return repository;
}

export const createCrmDealRepository = createPostgresCrmDealRepository;
export const createPostgresCrmDealsRepository = createPostgresCrmDealRepository;
