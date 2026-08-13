import { and, asc, desc, eq, ilike, inArray, lte, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from './client.js';
import { crmDeals, quoteRevisions, quotations, salesOrders } from './schema.js';

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

export const CRM_PRUNE_TARGET_STATUS: CrmDealStatus = 'Orcamento Enviado';
export const CRM_PRUNE_LOST_STATUS: CrmDealStatus = 'Perdido';
export const CRM_PRUNE_THRESHOLD_DAYS = 30;
export const CRM_PRUNE_PROTECT_RECENT_DAYS = 7;
export const CRM_PRUNE_NEXT_STEP =
  'Marcado como perdido por limpeza de pipeline: sem resposta após 30 dias.';
export const CRM_PRUNE_LOST_REASON = 'Sem resposta após 30 dias.';

const DEFAULT_LIST_LIMIT = 500;
const MAX_LIST_LIMIT = 500;
const MAX_PRUNE_DEALS = 1000;
const MAX_PRUNE_REVISIONS = 5000;
const MAX_SEARCH_LENGTH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  nextStep: string | null;
  lostReason: string | null;
  createdAt: CrmTimestamp;
  updatedAt: CrmTimestamp;
  quotation?: string | null;
  quotationDate?: string | null;
  grandTotal?: number;
}

export interface CrmDealListOptions {
  search?: string;
  limit?: number;
}

export interface CrmDealStatusPatch {
  status: CrmDealStatus;
  followUpStage?: number | null;
}

export interface CrmDealUpsertInput {
  quotationId?: unknown;
  quotation_id?: unknown;
  quoteLeadId?: unknown;
  quote_lead_id?: unknown;
  clientId?: unknown;
  client_id?: unknown;
  id?: unknown;
  nome?: unknown;
  lead_name?: unknown;
  email?: unknown;
  telefone?: unknown;
  status?: unknown;
  followUpStage?: unknown;
  follow_up_stage?: unknown;
  nextStep?: unknown;
  next_step?: unknown;
  lostReason?: unknown;
  lost_reason?: unknown;
}

export interface CrmPruneCandidate {
  deal_id: string;
  lead_name: string;
  quotation: string;
  quotation_date: string;
  age_days: number;
  deal_modified: string;
  grand_total: number;
}

export interface CrmPruneResult {
  success: true;
  updated: number;
  skipped: number;
  skipped_deals: Array<{ deal_id: string; reason: string }>;
}

export interface CrmDealRepository {
  list(options: CrmDealListOptions): Promise<CrmDealRecord[]>;
  updateStatus(id: string, patch: CrmDealStatusPatch): Promise<CrmDealRecord | null>;
  upsertForQuotation(input: CrmDealUpsertInput): Promise<CrmDealRecord>;
  prune(ids: string[], now: Date): Promise<CrmPruneResult>;
  listPruneCandidates?(now: Date): Promise<CrmPruneCandidate[]>;
}

export interface CrmDealRepositoryOptions {
  now?: () => Date;
  idFactory?: () => string;
}

type DatabaseProvider = () => AppDatabase;
type CrmTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type CrmDatabase = AppDatabase | CrmTransaction;
type CrmDealRow = typeof crmDeals.$inferSelect;

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

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

function pruneQuotationCutoff(now: Date): Date {
  return addDays(now, -CRM_PRUNE_THRESHOLD_DAYS);
}

function isPruneQuotationOldEnough(createdAt: unknown, now: Date): boolean {
  const created = parseTimestamp(createdAt);
  return created !== null && created.getTime() <= pruneQuotationCutoff(now).getTime();
}

function dateOnly(value: unknown): string {
  return asValidDate(value, new Date(0)).toISOString().slice(0, 10);
}

function ageInDays(value: unknown, now: Date): number {
  const created = parseTimestamp(value);
  if (!created) return -1;
  return Math.floor((now.getTime() - created.getTime()) / DAY_MS);
}

function isoTimestamp(value: unknown): string {
  return asValidDate(value, new Date(0)).toISOString();
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
    nextStep: row.nextStep,
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
  console.error('[crm-deals-repository]', error instanceof Error ? error.name : typeof error);
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

async function latestRevisionRows(
  database: CrmDatabase,
  quotationIds: string[]
): Promise<Array<typeof quoteRevisions.$inferSelect>> {
  if (quotationIds.length === 0) return [];
  return database
    .select()
    .from(quoteRevisions)
    .where(inArray(quoteRevisions.quotationId, quotationIds))
    .orderBy(asc(quoteRevisions.quotationId), desc(quoteRevisions.version))
    .limit(MAX_PRUNE_REVISIONS);
}

function latestByQuotation(rows: Array<typeof quoteRevisions.$inferSelect>) {
  const latest = new Map<string, typeof quoteRevisions.$inferSelect>();
  for (const row of rows) {
    if (!latest.has(row.quotationId)) latest.set(row.quotationId, row);
  }
  return latest;
}

async function activeOrdersFor(
  database: CrmDatabase,
  quotationIds: string[],
  revisionIds: string[]
) {
  if (quotationIds.length === 0 && revisionIds.length === 0) return [];
  const linkage = [
    quotationIds.length > 0 ? inArray(salesOrders.quotationId, quotationIds) : undefined,
    revisionIds.length > 0 ? inArray(salesOrders.quotationRevisionId, revisionIds) : undefined,
  ].filter(Boolean) as Array<ReturnType<typeof inArray>>;
  return database
    .select({
      quotationId: salesOrders.quotationId,
      quotationRevisionId: salesOrders.quotationRevisionId,
      status: salesOrders.status,
    })
    .from(salesOrders)
    .where(and(or(...linkage), ne(salesOrders.status, 'Cancelled')))
    .limit(MAX_PRUNE_DEALS);
}

async function pruneEligibility(
  transaction: CrmTransaction,
  deal: CrmDealRow,
  now: Date
): Promise<string | null> {
  if (deal.status !== CRM_PRUNE_TARGET_STATUS) return 'Status alterado após a listagem.';
  if (!deal.quotationId) return 'Orçamento não está mais elegível para limpeza.';
  if (deal.updatedAt > addDays(now, -CRM_PRUNE_PROTECT_RECENT_DAYS)) {
    return 'Deal atualizado após a listagem.';
  }

  const [quotation] = await transaction
    .select()
    .from(quotations)
    .where(eq(quotations.id, deal.quotationId))
    .for('update')
    .limit(1);
  if (!quotation) return 'Orçamento não está mais elegível para limpeza.';
  if (!isPruneQuotationOldEnough(quotation.createdAt, now)) {
    return 'Orçamento não está mais elegível para limpeza.';
  }

  const revisions = await transaction
    .select({ id: quoteRevisions.id })
    .from(quoteRevisions)
    .where(eq(quoteRevisions.quotationId, quotation.id))
    .limit(MAX_PRUNE_REVISIONS);
  const orders = await activeOrdersFor(
    transaction,
    [quotation.id],
    revisions.map((revision) => revision.id)
  );
  if (orders.length > 0) return 'Pedido criado após a listagem.';
  return null;
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
          nextStep: crmDeals.nextStep,
          lostReason: crmDeals.lostReason,
          createdAt: crmDeals.createdAt,
          updatedAt: crmDeals.updatedAt,
          quotationBusinessNumber: quotations.businessNumber,
        };
        const order = [desc(crmDeals.updatedAt), desc(crmDeals.createdAt), asc(crmDeals.id)];
        const rows = normalized
          ? await database
              .select(fields)
              .from(crmDeals)
              .leftJoin(quotations, eq(crmDeals.quotationId, quotations.id))
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
          nextStep: row.nextStep,
          lostReason: row.lostReason,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          quotation: row.quotationBusinessNumber || null,
        }));
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async updateStatus(id: string, patch: CrmDealStatusPatch): Promise<CrmDealRecord | null> {
      const dealId = normalizedId(id, 'deal_id');
      const status = normalizedStatus(patch?.status);
      const followUpStage = normalizedFollowUpStage(patch?.followUpStage);
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
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
              lostReason: status === CRM_PRUNE_LOST_STATUS ? CRM_PRUNE_LOST_REASON : null,
              updatedAt,
            })
            .where(eq(crmDeals.id, dealId));
          return dealWithQuotation(transaction, dealId);
        });
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async upsertForQuotation(input: CrmDealUpsertInput): Promise<CrmDealRecord> {
      const quotationId = normalizedId(input?.quotationId ?? input?.quotation_id, 'quotation_id');
      const nameValue = input?.nome ?? input?.lead_name;
      const emailValue = normalizedEmail(input?.email);
      const phoneValue = normalizedPhone(input?.telefone);
      const clientId = input?.clientId ?? input?.client_id;
      const quoteLeadId = input?.quoteLeadId ?? input?.quote_lead_id;
      const statusValue = input?.status === undefined ? undefined : normalizedStatus(input.status);
      const followUpStage = normalizedFollowUpStage(input?.followUpStage ?? input?.follow_up_stage);
      const nextStep = optionalText(input?.nextStep ?? input?.next_step, 'Próxima ação', 500);
      const lostReason = optionalText(
        input?.lostReason ?? input?.lost_reason,
        'Motivo da perda',
        500
      );
      const normalizedClientId =
        clientId === undefined || clientId === null ? null : normalizedId(clientId, 'client_id');
      const normalizedQuoteLeadId =
        quoteLeadId === undefined || quoteLeadId === null
          ? null
          : normalizedId(quoteLeadId, 'quote_lead_id');
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
          const [existing] = await transaction
            .select()
            .from(crmDeals)
            .where(
              and(eq(crmDeals.quotationId, quotationId), ne(crmDeals.status, CRM_PRUNE_LOST_STATUS))
            )
            .for('update')
            .limit(1);
          const timestamp = nowFrom(now);
          if (existing) {
            const status = statusValue || existing.status;
            const updatedAt = strictlyAfter(timestamp, existing.updatedAt);
            await transaction
              .update(crmDeals)
              .set({
                ...(nameValue === undefined ? {} : { nome: requiredName(nameValue) }),
                ...(emailValue === undefined ? {} : { email: emailValue }),
                ...(phoneValue === undefined ? {} : { telefone: phoneValue }),
                ...(normalizedClientId === null && clientId === undefined
                  ? {}
                  : { clientId: normalizedClientId }),
                ...(normalizedQuoteLeadId === null && quoteLeadId === undefined
                  ? {}
                  : { quoteLeadId: normalizedQuoteLeadId }),
                ...(statusValue === undefined ? {} : { status }),
                ...(followUpStage === undefined ? {} : { followUpStage }),
                ...(nextStep === undefined ? {} : { nextStep }),
                ...(lostReason === undefined ? {} : { lostReason }),
                lostReason:
                  status === CRM_PRUNE_LOST_STATUS ? lostReason || CRM_PRUNE_LOST_REASON : null,
                updatedAt,
              })
              .where(eq(crmDeals.id, existing.id));
            const updated = await dealWithQuotation(transaction, existing.id);
            if (!updated) throw new CrmDealRepositoryError();
            return updated;
          }

          const nome = requiredName(nameValue);
          const status = statusValue || CRM_PRUNE_TARGET_STATUS;
          const createdAt = timestamp;
          const id = normalizedId(input?.id === undefined ? idFactory() : input.id, 'id');
          const [created] = await transaction
            .insert(crmDeals)
            .values({
              id,
              quoteLeadId: normalizedQuoteLeadId,
              clientId: normalizedClientId,
              quotationId,
              nome,
              email: emailValue === undefined ? null : emailValue,
              telefone: phoneValue === undefined ? null : phoneValue,
              status,
              followUpStage: followUpStage ?? 0,
              nextStep: nextStep === undefined ? null : nextStep,
              lostReason:
                status === CRM_PRUNE_LOST_STATUS
                  ? lostReason || CRM_PRUNE_LOST_REASON
                  : lostReason === undefined
                    ? null
                    : lostReason,
              createdAt,
              updatedAt: createdAt,
            })
            .onConflictDoNothing()
            .returning();
          const winner =
            created ||
            (
              await transaction
                .select()
                .from(crmDeals)
                .where(
                  and(eq(crmDeals.quotationId, quotationId), ne(crmDeals.status, CRM_PRUNE_LOST_STATUS))
                )
                .limit(1)
            )[0];
          if (!winner) throw new CrmDealRepositoryError();
          const saved = await dealWithQuotation(transaction, winner.id);
          if (!saved) throw new CrmDealRepositoryError();
          return saved;
        });
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async listPruneCandidates(nowValue: Date): Promise<CrmPruneCandidate[]> {
      const nowAt = asValidDate(nowValue);
      const oldEnough = pruneQuotationCutoff(nowAt);
      const protectedAfter = addDays(nowAt, -CRM_PRUNE_PROTECT_RECENT_DAYS);
      try {
        const database = getDb();
        const deals = await database
          .select()
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.status, CRM_PRUNE_TARGET_STATUS),
              lte(crmDeals.updatedAt, protectedAfter)
            )
          )
          .orderBy(asc(crmDeals.updatedAt), asc(crmDeals.id))
          .limit(MAX_PRUNE_DEALS);
        const dealByQuotation = new Map(
          deals.filter((deal) => deal.quotationId).map((deal) => [deal.quotationId as string, deal])
        );
        const quotationIds = [...dealByQuotation.keys()];
        if (quotationIds.length === 0) return [];

        const quotationRows = await database
          .select()
          .from(quotations)
          .where(and(inArray(quotations.id, quotationIds), lte(quotations.createdAt, oldEnough)))
          .limit(MAX_PRUNE_DEALS);
        if (quotationRows.length === 0) return [];

        const eligibleQuotationIds = quotationRows.map((quotation) => quotation.id);
        const revisionRows = await latestRevisionRows(database, eligibleQuotationIds);
        const latestRevisions = latestByQuotation(revisionRows);
        const revisionToQuotation = new Map(
          revisionRows.map((revision) => [revision.id, revision.quotationId])
        );
        const orders = await activeOrdersFor(database, eligibleQuotationIds, [
          ...revisionToQuotation.keys(),
        ]);
        const linkedQuotationIds = new Set<string>();
        for (const order of orders) {
          if (order.quotationId) linkedQuotationIds.add(order.quotationId);
          if (order.quotationRevisionId) {
            const quotationId = revisionToQuotation.get(order.quotationRevisionId);
            if (quotationId) linkedQuotationIds.add(quotationId);
          }
        }

        return quotationRows
          .filter((quotation) => isPruneQuotationOldEnough(quotation.createdAt, nowAt))
          .filter((quotation) => !linkedQuotationIds.has(quotation.id))
          .map((quotation) => {
            const deal = dealByQuotation.get(quotation.id)!;
            const revision = latestRevisions.get(quotation.id);
            return {
              deal_id: deal.id,
              lead_name: deal.nome || 'Sem nome',
              quotation: quotation.businessNumber,
              quotation_date: dateOnly(quotation.createdAt),
              age_days: ageInDays(quotation.createdAt, nowAt),
              deal_modified: isoTimestamp(deal.updatedAt),
              grand_total: Number(revision?.total || 0),
            };
          })
          .filter((candidate) => candidate.age_days >= CRM_PRUNE_THRESHOLD_DAYS)
          .sort((a, b) => b.age_days - a.age_days || a.deal_id.localeCompare(b.deal_id));
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async prune(ids: string[], nowValue: Date): Promise<CrmPruneResult> {
      const selected = Array.from(new Set(ids.map(cleanString).filter(Boolean)));
      if (selected.length === 0)
        throw new CrmDealInputError('Selecione ao menos uma oportunidade para limpar.');
      if (selected.length > MAX_PRUNE_DEALS) {
        throw new CrmDealInputError('Selecione no máximo 1000 oportunidades por limpeza.');
      }
      const nowAt = asValidDate(nowValue);
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
          let updated = 0;
          const skippedDeals: Array<{ deal_id: string; reason: string }> = [];
          for (const dealId of selected) {
            const [deal] = await transaction
              .select()
              .from(crmDeals)
              .where(eq(crmDeals.id, dealId))
              .for('update')
              .limit(1);
            if (!deal) {
              skippedDeals.push({
                deal_id: dealId,
                reason: 'Deal não está mais elegível para limpeza.',
              });
              continue;
            }
            const reason = await pruneEligibility(transaction, deal, nowAt);
            if (reason) {
              skippedDeals.push({ deal_id: dealId, reason });
              continue;
            }
            await transaction
              .update(crmDeals)
              .set({
                status: CRM_PRUNE_LOST_STATUS,
                lostReason: CRM_PRUNE_LOST_REASON,
                nextStep: CRM_PRUNE_NEXT_STEP,
                updatedAt: strictlyAfter(nowAt, deal.updatedAt),
              })
              .where(eq(crmDeals.id, dealId));
            updated += 1;
          }
          return {
            success: true,
            updated,
            skipped: skippedDeals.length,
            skipped_deals: skippedDeals,
          };
        });
      } catch (error) {
        return safeRepositoryError(error);
      }
    },
  };

  return repository;
}

export const createCrmDealRepository = createPostgresCrmDealRepository;
export const createPostgresCrmDealsRepository = createPostgresCrmDealRepository;
