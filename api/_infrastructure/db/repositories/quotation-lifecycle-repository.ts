import { and, asc, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from '../client.js';
import { appendProductActivityEvents } from './product-activity-repository.js';
import {
  readPostgresQuotationDetail,
  QuoteManagementConflictError,
  QuoteManagementInputError,
  QuoteManagementNotFoundError,
  QuoteManagementRepositoryError,
  type QuoteDatabase,
  type QuoteDraftManagementDetail,
} from './quote-draft-management-repository.js';
import {
  createSalesOrderFromApprovedQuotation,
  SalesOrderConflictError,
  SalesOrderInputError,
  SalesOrderNotFoundError,
  SalesOrderRepositoryError,
} from './sales-orders-repository.js';
import { appSettings, quoteRevisionItems, quoteRevisions, quotations } from '../schema.js';
import { normalizeQuotationCompanyConfiguration } from '../../../_modules/quotation-company.js';
import { acquireQuotationWriteLock } from '../quotation-write-lock.js';
import { cancelQuotationFollowUpForFact } from './quotation-follow-up-facts.js';
import {
  assertQuotationTransition,
  canonicalQuotationStatus,
  isIssuedQuotationStatus,
  type QuotationStatus,
} from '../../../_modules/quotation-status.js';

type DatabaseProvider = () => AppDatabase;
type QuoteTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMERCIAL_STATES = new Set<QuotationStatus>(['rascunho', 'emitido', 'aprovado', 'perdido']);

export type QuotationCommercialStatus = QuotationStatus;

export interface SetQuotationStatusInput {
  status: 'emitido' | 'aprovado' | 'perdido';
  loss_reason?: unknown;
  concurrency_token: unknown;
  concurrencyToken?: unknown;
}

export interface CreateQuotationRevisionInput {
  source_revision_id: string;
  sourceRevisionId?: string;
  concurrency_token: unknown;
  concurrencyToken?: unknown;
}

export type SetQuotationStatusResult = QuoteDraftManagementDetail & {
  sales_order_id?: string;
};

export interface QuotationLifecycleRepository {
  setStatus(id: string, input: SetQuotationStatusInput): Promise<SetQuotationStatusResult>;
  createRevision(id: string, input: CreateQuotationRevisionInput): Promise<QuoteDraftManagementDetail>;
}

export interface QuotationLifecycleRepositoryOptions {
  now?: () => Date;
  randomId?: () => string;
  acquireWriteLock?: typeof acquireQuotationWriteLock;
  readDetail?: typeof readPostgresQuotationDetail;
}

// Drizzle's `or` expression is intentionally avoided in this helper's UUID
// branch because a malformed UUID must never be treated as an arbitrary
// business number.  The schema's business number is still accepted for normal
// requests and tests.
function quotationPredicate(id: string) {
  return UUID_PATTERN.test(id)
    ? eq(quotations.id, id)
    : eq(quotations.businessNumber, id);
}

function asDate(value: Date | string | null | undefined): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function tokenFor(value: Date | string | null | undefined): string {
  return asDate(value).toISOString();
}

function requiredToken(input: Record<string, unknown>): string {
  const candidate = input.concurrency_token ?? input.concurrencyToken;
  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) return candidate.toISOString();
  if (candidate === undefined || candidate === null || String(candidate).trim() === '') {
    throw new QuoteManagementConflictError('Token de concorrência obrigatório. Recarregue o orçamento.');
  }
  return String(candidate).trim();
}

function updatedAtFor(now: () => Date, previous: Date): Date {
  const candidate = now();
  if (!(candidate instanceof Date) || Number.isNaN(candidate.getTime()) || candidate.getTime() <= previous.getTime()) {
    return new Date(previous.getTime() + 1);
  }
  return candidate;
}

function duplicateConstraint(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (candidate.code !== '23505') return false;
  const text = `${String(candidate.constraint || '')} ${String(candidate.message || '')}`;
  return text.includes('quote_revisions_one_draft_per_quotation_unique')
    || text.includes('quote_revisions_quotation_version_unique');
}

function known(error: unknown): boolean {
  return error instanceof QuoteManagementInputError
    || error instanceof QuoteManagementNotFoundError
    || error instanceof QuoteManagementConflictError
    || error instanceof QuoteManagementRepositoryError;
}

function mapSalesOrderError(error: unknown): never {
  if (error instanceof SalesOrderInputError || error instanceof SalesOrderConflictError) {
    throw new QuoteManagementConflictError(error.message);
  }
  if (error instanceof SalesOrderNotFoundError) {
    throw new QuoteManagementNotFoundError(error.message);
  }
  if (error instanceof SalesOrderRepositoryError) {
    throw new QuoteManagementRepositoryError(error.message);
  }
  throw error;
}

async function lockedQuotation(tx: QuoteTransaction, id: string) {
  const normalized = String(id || '').trim();
  if (!normalized) throw new QuoteManagementInputError('ID do orçamento não informado.');
  const [quotation] = await tx
    .select()
    .from(quotations)
    .where(quotationPredicate(normalized))
    .for('update')
    .limit(1);
  if (!quotation) throw new QuoteManagementNotFoundError();
  return quotation;
}

async function latestRevision(tx: QuoteDatabase, quotationId: string) {
  const [revision] = await tx
    .select()
    .from(quoteRevisions)
    .where(eq(quoteRevisions.quotationId, quotationId))
    .orderBy(desc(quoteRevisions.version))
    .limit(1);
  return revision || null;
}

function assertToken(quotation: typeof quotations.$inferSelect, token: string): void {
  if (token !== tokenFor(quotation.updatedAt)) {
    throw new QuoteManagementConflictError('O orçamento foi alterado por outro usuário. Recarregue antes de continuar.');
  }
}

function assertStatusInput(status: unknown): asserts status is 'emitido' | 'aprovado' | 'perdido' {
  if (status !== 'emitido' && status !== 'aprovado' && status !== 'perdido') {
    throw new QuoteManagementInputError('Status inválido. Use "emitido", "aprovado" ou "perdido".');
  }
}

function assertRevisionSourceId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new QuoteManagementInputError('Identificador da revisão de origem inválido.');
  }
  return value.trim();
}

/**
 * Lifecycle-only persistence.  Draft content remains owned by the draft
 * repository; this repository changes status metadata or creates an immutable
 * copied revision while holding the aggregate row lock.
 */
export function createPostgresQuotationLifecycleRepository(
  getDb: DatabaseProvider = getDatabase,
  options: QuotationLifecycleRepositoryOptions = {},
): QuotationLifecycleRepository {
  const now = options.now || (() => new Date());
  const randomId = options.randomId || randomUUID;
  const acquireWriteLock = options.acquireWriteLock || acquireQuotationWriteLock;
  const readDetail = options.readDetail || readPostgresQuotationDetail;

  const repository: QuotationLifecycleRepository = {
    async setStatus(id: string, rawInput: SetQuotationStatusInput): Promise<SetQuotationStatusResult> {
      if (!rawInput || typeof rawInput !== 'object') throw new QuoteManagementInputError('Envie um payload válido.');
      const input = rawInput as unknown as Record<string, unknown>;
      const status = input.status;
      assertStatusInput(status);
      const token = requiredToken(input);
      try {
        const detail = await getDb().transaction(async (tx) => {
          await acquireWriteLock(tx);
          const quotation = await lockedQuotation(tx, id);
          assertToken(quotation, token);
          const revision = await latestRevision(tx, quotation.id);
          if (!revision) {
            throw new QuoteManagementConflictError('A revisão atual do orçamento não está disponível.');
          }
          const sourceStatus = canonicalQuotationStatus(quotation.status);
          const revisionStatus = canonicalQuotationStatus(revision.status);
          try {
            assertQuotationTransition(sourceStatus, status, typeof input.loss_reason === 'string' ? input.loss_reason : undefined);
          } catch (error) {
            throw new QuoteManagementConflictError(error instanceof Error ? error.message : 'Transição comercial inválida.');
          }
          if (status === 'emitido') {
            if (sourceStatus !== 'rascunho' || revisionStatus !== 'rascunho') {
              throw new QuoteManagementConflictError('Somente o agregado e a revisão em rascunho podem ser emitidos.');
            }
          } else {
            if (sourceStatus !== 'emitido') {
              throw new QuoteManagementConflictError('Somente orçamentos emitidos podem ser marcados como aprovados ou perdidos.');
            }
            if (revisionStatus !== 'emitido') {
              throw new QuoteManagementConflictError('A revisão emitida não está mais disponível para alteração comercial.');
            }
          }
          const updatedAt = updatedAtFor(now, asDate(quotation.updatedAt));
          const lossReason = status === 'perdido' ? String(input.loss_reason).trim() : null;
          await tx.update(quoteRevisions).set({ status }).where(eq(quoteRevisions.id, revision.id));
          await tx.update(quotations).set({ status, lossReason, updatedAt }).where(eq(quotations.id, quotation.id));
          if (status !== 'emitido') {
            await cancelQuotationFollowUpForFact(tx, quotation.id, 'quotation_not_issued', updatedAt);
          }
          let salesOrderId: string | undefined;
          if (status === 'aprovado') {
            try {
              const order = await createSalesOrderFromApprovedQuotation(
                tx,
                { id: quotation.id, clientId: quotation.clientId, status: 'aprovado' },
                { now: updatedAt, idFactory: randomId },
              );
              salesOrderId = order.id;
            } catch (error) {
              mapSalesOrderError(error);
            }
          }
          const refreshed = await readDetail(tx, quotation.businessNumber, now);
          if (!refreshed) throw new QuoteManagementRepositoryError();
          return salesOrderId ? { ...refreshed, sales_order_id: salesOrderId } : refreshed;
        });
        return detail;
      } catch (error) {
        if (
          error instanceof SalesOrderInputError
          || error instanceof SalesOrderConflictError
          || error instanceof SalesOrderNotFoundError
          || error instanceof SalesOrderRepositoryError
        ) {
          mapSalesOrderError(error);
        }
        if (known(error)) throw error;
        console.error(`[quotation-lifecycle] set status failed (${error instanceof Error ? error.name : typeof error})`);
        throw new QuoteManagementRepositoryError('Não foi possível atualizar o estado comercial. Tente novamente.');
      }
    },

    async createRevision(id: string, rawInput: CreateQuotationRevisionInput): Promise<QuoteDraftManagementDetail> {
      if (!rawInput || typeof rawInput !== 'object') throw new QuoteManagementInputError('Envie um payload válido.');
      const input = rawInput as unknown as Record<string, unknown>;
      const sourceRevisionId = assertRevisionSourceId(input.source_revision_id ?? input.sourceRevisionId);
      const token = requiredToken(input);
      try {
        const detail = await getDb().transaction(async (tx) => {
          await acquireWriteLock(tx);
          const quotation = await lockedQuotation(tx, id);
          assertToken(quotation, token);

          const [existingDraft] = await tx
            .select({ id: quoteRevisions.id })
            .from(quoteRevisions)
            .where(and(eq(quoteRevisions.quotationId, quotation.id), eq(quoteRevisions.status, 'rascunho')))
            .limit(1);
          if (existingDraft) {
            throw new QuoteManagementConflictError('Já existe uma revisão em rascunho para este orçamento.');
          }

          const [source] = await tx
            .select()
            .from(quoteRevisions)
            .where(and(eq(quoteRevisions.id, sourceRevisionId), eq(quoteRevisions.quotationId, quotation.id)))
            .limit(1);
          if (!source) throw new QuoteManagementNotFoundError('Revisão de origem não encontrada neste orçamento.');
          if (!isIssuedQuotationStatus(source.status)) {
            throw new QuoteManagementConflictError('Somente uma revisão já emitida pode originar uma nova revisão.');
          }

          const revisions = await tx
            .select({ version: quoteRevisions.version })
            .from(quoteRevisions)
            .where(eq(quoteRevisions.quotationId, quotation.id))
            .orderBy(desc(quoteRevisions.version));
          const version = (revisions[0]?.version || 0) + 1;
          const createdAt = updatedAtFor(now, asDate(quotation.updatedAt));
          const revisionId = randomId();
          if (!UUID_PATTERN.test(revisionId)) throw new QuoteManagementRepositoryError('Não foi possível gerar a revisão do orçamento.');

          const [settings] = await tx
            .select({ companyConfiguration: appSettings.companyConfiguration })
            .from(appSettings)
            .where(eq(appSettings.singletonId, 1))
            .limit(1);
          const companySnapshot = normalizeQuotationCompanyConfiguration(settings?.companyConfiguration);

          await tx.insert(quoteRevisions).values({
            id: revisionId,
            quotationId: quotation.id,
            version,
            status: 'rascunho',
            validadeDias: source.validadeDias,
            entrega: source.entrega,
            productionDays: source.productionDays,
            surchargePercent: source.surchargePercent,
            fretePadrao: source.fretePadrao,
            frete: source.frete,
            templatePadrao: source.templatePadrao,
            templateHash: source.templateHash,
            templateVersionId: source.templateVersionId,
            sectionsSnapshot: structuredClone(source.sectionsSnapshot),
            companySnapshot,
            clienteNome: source.clienteNome,
            clienteDocumento: source.clienteDocumento,
            clienteEmail: source.clienteEmail,
            clienteTelefone: source.clienteTelefone,
            clienteEndereco: source.clienteEndereco,
            clienteNumero: source.clienteNumero,
            clienteBairro: source.clienteBairro,
            clienteComplemento: source.clienteComplemento,
            clienteMunicipio: source.clienteMunicipio,
            clienteUf: source.clienteUf,
            clienteCep: source.clienteCep,
            clienteNotas: source.clienteNotas,
            subtotal: source.subtotal,
            total: source.total,
            createdAt,
          });

          const sourceItems = await tx
            .select()
            .from(quoteRevisionItems)
            .where(eq(quoteRevisionItems.revisionId, source.id))
            .orderBy(asc(quoteRevisionItems.position));
          if (sourceItems.length > 0) {
            await tx.insert(quoteRevisionItems).values(sourceItems.map((item) => ({
              id: randomId(),
              revisionId,
              position: item.position,
              productSku: item.productSku,
              quantidade: item.quantidade,
              produtoSku: item.produtoSku,
              produtoNome: item.produtoNome,
              produtoDescricao: item.produtoDescricao,
              produtoUnidade: item.produtoUnidade,
              produtoCategoria: item.produtoCategoria,
              produtoMarca: item.produtoMarca,
              notas: item.notas,
              precoFonte: item.precoFonte,
              precoMinimoFaixa: item.precoMinimoFaixa,
              precoSugerido: item.precoSugerido,
              precoAplicado: item.precoAplicado,
              diferencaPreco: item.diferencaPreco,
              totalLinha: item.totalLinha,
              manualRate: item.manualRate,
            })));
          }
          await appendProductActivityEvents(
            tx,
            [...new Set(sourceItems.map((item) => item.produtoSku || item.productSku))].map((sku) => ({
              sku,
              tipo: 'orcamento' as const,
              texto: `Orçamento ${quotation.businessNumber} atualizado`,
              reference_id: `orcamento:${quotation.id}:${revisionId}:${sku}`,
              created_at: createdAt,
            })),
          );
          await cancelQuotationFollowUpForFact(tx, quotation.id, 'quotation_not_issued', createdAt);
          await tx.update(quotations).set({ status: 'rascunho', updatedAt: createdAt }).where(eq(quotations.id, quotation.id));
          const refreshed = await readDetail(tx, quotation.businessNumber, now);
          if (!refreshed) throw new QuoteManagementRepositoryError();
          return refreshed;
        });
        return detail;
      } catch (error) {
        if (duplicateConstraint(error)) {
          throw new QuoteManagementConflictError('Já existe uma revisão em rascunho ou a versão foi criada por outro usuário. Recarregue o orçamento.');
        }
        if (known(error)) throw error;
        console.error(`[quotation-lifecycle] create revision failed (${error instanceof Error ? error.name : typeof error})`);
        throw new QuoteManagementRepositoryError('Não foi possível criar a nova revisão. Tente novamente.');
      }
    },
  };
  return repository;
}

export const createQuotationLifecycleRepository = createPostgresQuotationLifecycleRepository;
export const createPostgresQuotationLifecycle = createPostgresQuotationLifecycleRepository;
export const QuotationLifecycleInputError = QuoteManagementInputError;
export const QuotationLifecycleNotFoundError = QuoteManagementNotFoundError;
export const QuotationLifecycleConflictError = QuoteManagementConflictError;
export const QuotationLifecycleRepositoryError = QuoteManagementRepositoryError;
export { COMMERCIAL_STATES };
