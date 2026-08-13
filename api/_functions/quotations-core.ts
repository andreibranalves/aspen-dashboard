import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import {
  createPostgresQuoteDraftManagementRepository,
  normalizeQuotationListStatus,
  QuoteManagementConflictError,
  QuoteManagementInputError,
  QuoteManagementNotFoundError,
  QuoteManagementRepositoryError,
  type QuoteDraftManagementListOptions,
  type QuoteDraftManagementRepository,
  type QuoteDraftManagementUpdateInput,
} from '../_db/quote-draft-management-repository.js';
import {
  createPostgresQuotationLifecycleRepository,
  type CreateQuotationRevisionInput,
  type QuotationLifecycleRepository,
  type SetQuotationStatusInput,
} from '../_db/quotation-lifecycle-repository.js';
type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface QuotationsCoreDependencies {
  repository: QuoteDraftManagementRepository;
  lifecycleRepository?: QuotationLifecycleRepository;
}

const VALID_ORDER_BY = new Set([
  'creation desc',
  'creation asc',
  'transaction_date desc',
  'transaction_date asc',
  'valid_till desc',
  'valid_till asc',
  'name desc',
  'name asc',
  'grand_total desc',
  'grand_total asc',
  'updated_at desc',
  'updated_at asc',
]);

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeQuotationOutput<T>(value: T): T {
  if (!isRecord(value)) return value;
  const sanitized = { ...value };
  for (const key of Object.keys(sanitized)) {
    if (key.endsWith('_mode') || key === 'origin') delete sanitized[key];
  }
  return sanitized as T;
}

function parseJsonBody(event: FunctionEvent): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(event.body || '{}');
  } catch {
    throw new QuoteManagementInputError('JSON inválido.');
  }
  if (!isRecord(value)) throw new QuoteManagementInputError('Envie um payload válido.');
  return value;
}

function parsePositiveInt(raw: string | undefined, fallback: number, maximum?: number): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed === 0) return fallback;
  if (!Number.isInteger(parsed) || parsed < 1) throw new QuoteManagementInputError('Parâmetro de paginação inválido.');
  if (maximum !== undefined && parsed > maximum) throw new QuoteManagementInputError(`Limite máximo é ${maximum} registros por página.`);
  return parsed;
}

function logError(operation: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[quotations-core] ${operation} failed (${kind})`);
}

function errorResponse(operation: string, error: unknown): FunctionResult {
  logError(operation, error);
  if (
    error instanceof QuoteManagementInputError ||
    error instanceof QuoteManagementNotFoundError ||
    error instanceof QuoteManagementConflictError ||
    error instanceof QuoteManagementRepositoryError
  ) {
    return json(error.statusCode, { error: error.message });
  }
  return json(503, { error: 'Não foi possível processar os orçamentos. Tente novamente.' });
}

function repositoryList(repository: QuoteDraftManagementRepository, options: QuoteDraftManagementListOptions) {
  const list = repository.list || repository.listDrafts;
  if (!list) throw new QuoteManagementRepositoryError();
  return list(options);
}

function repositoryGet(repository: QuoteDraftManagementRepository, id: string) {
  const get = repository.get || repository.getDraft;
  if (!get) throw new QuoteManagementRepositoryError();
  return get(id);
}

function repositoryUpdate(repository: QuoteDraftManagementRepository, id: string, input: QuoteDraftManagementUpdateInput) {
  const update = repository.update || repository.updateDraft;
  if (!update) throw new QuoteManagementRepositoryError();
  return update(id, input);
}

function repositoryDelete(repository: QuoteDraftManagementRepository, id: string) {
  const del = repository.delete;
  if (!del) throw new QuoteManagementRepositoryError('Exclusão não disponível.');
  return del(id);
}

function lifecycleRepository(dependencies: QuotationsCoreDependencies): QuotationLifecycleRepository {
  if (dependencies.lifecycleRepository) return dependencies.lifecycleRepository;
  const candidate = dependencies.repository as QuoteDraftManagementRepository & Partial<QuotationLifecycleRepository>;
  if (typeof candidate.setStatus === 'function' && typeof candidate.createRevision === 'function') {
    return candidate as unknown as QuotationLifecycleRepository;
  }
  return createPostgresQuotationLifecycleRepository();
}

export function createCoreHandler(
  dependencies: QuotationsCoreDependencies = { repository: createPostgresQuoteDraftManagementRepository() },
): Handler {
  return async function quotationsCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    const query = event.queryStringParameters || {};
    try {
      if (event.httpMethod === 'GET') {
        if (query.id) {
          const detail = await repositoryGet(dependencies.repository, query.id);
          if (!detail) throw new QuoteManagementNotFoundError();
          return json(200, sanitizeQuotationOutput(detail) as unknown as Record<string, unknown>);
        }
        const status = (query.status || '').trim();
        if (status && normalizeQuotationListStatus(status) === undefined) {
          throw new QuoteManagementInputError('Status inválido. Valores aceitos: Rascunho, Enviado, Aprovado ou Perdido.');
        }
        const orderBy = (query.order_by || '').trim().toLowerCase();
        if (orderBy && !VALID_ORDER_BY.has(orderBy)) throw new QuoteManagementInputError('Ordenação inválida.');
        const page = parsePositiveInt(query.page, 1);
        const limit = parsePositiveInt(query.limit, 50, 200);
        const result = await repositoryList(dependencies.repository, {
          page,
          limit,
          search: query.search?.trim() || undefined,
          status: status || undefined,
          orderBy: orderBy || undefined,
        });
        const compatibleResult = result as QuoteDraftManagementListOptions & {
          rows?: unknown[];
          data?: unknown[];
          statusSummary?: Record<string, number>;
          status_summary?: Record<string, number>;
          total?: number;
          page?: number;
          limit?: number;
        };
        const rows = compatibleResult.rows || compatibleResult.data || [];
        const resultPage = compatibleResult.page || page;
        const resultLimit = compatibleResult.limit || limit;
        const resultTotal = Number(compatibleResult.total || 0);
        return json(200, {
          data: rows.map((row) => sanitizeQuotationOutput(row)),
          pagination: {
            page: resultPage,
            limit: resultLimit,
            total: resultTotal,
            total_pages: Math.ceil(resultTotal / resultLimit) || 0,
          },
          status_summary: compatibleResult.statusSummary || compatibleResult.status_summary || {},
        });
      }

      if (event.httpMethod === 'PUT') {
        if (!query.id) throw new QuoteManagementInputError('ID do orçamento não informado.');
        const payload = parseJsonBody(event);
        const detail = await repositoryUpdate(dependencies.repository, query.id, payload as QuoteDraftManagementUpdateInput);
        return json(200, sanitizeQuotationOutput(detail) as unknown as Record<string, unknown>);
      }

      if (event.httpMethod === 'POST') {
        if (!query.id) throw new QuoteManagementInputError('ID do orçamento não informado.');
        const payload = parseJsonBody(event);
        const action = typeof payload.action === 'string' ? payload.action.trim() : '';
        const lifecycle = lifecycleRepository(dependencies);
        if (action === 'set_status') {
          const status = payload.status;
          if (status !== 'enviado' && status !== 'aprovado' && status !== 'perdido') {
            throw new QuoteManagementInputError('Status inválido. Use "enviado", "aprovado" ou "perdido".');
          }
          const detail = await lifecycle.setStatus(query.id, payload as unknown as SetQuotationStatusInput);
          return json(200, sanitizeQuotationOutput(detail) as unknown as Record<string, unknown>);
        }
        if (action === 'create_revision') {
          if (typeof payload.source_revision_id !== 'string' || !payload.source_revision_id.trim()) {
            throw new QuoteManagementInputError('Revisão de origem obrigatória.');
          }
          const detail = await lifecycle.createRevision(query.id, payload as unknown as CreateQuotationRevisionInput);
          return json(200, sanitizeQuotationOutput(detail) as unknown as Record<string, unknown>);
        }
        throw new QuoteManagementInputError('Ação de orçamento inválida.');
      }

      if (event.httpMethod === 'DELETE') {
        if (!query.id) throw new QuoteManagementInputError('ID do orçamento não informado.');
        const result = await repositoryDelete(dependencies.repository, query.id);
        return json(200, { success: true, ...result });
      }

      return json(405, { error: 'Método não permitido.' });
    } catch (error) {
      return errorResponse(event.httpMethod === 'GET' ? (query.id ? 'detail' : 'list') : event.httpMethod.toLowerCase(), error);
    }
  };
}

export const handler = createCoreHandler();
export const coreHandler = handler;
