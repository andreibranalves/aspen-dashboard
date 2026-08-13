// GET /api/sales-orders - local sales order list and detail.
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { createHttpError } from '../_lib/http-error.js';
import {
  createPostgresSalesOrdersRepository,
  SALES_ORDER_STATUSES,
  type SalesOrderListOptions,
  type SalesOrdersRepository,
} from '../_db/sales-orders-repository.js';

export interface SalesOrdersHandlerDependencies {
  repository?: SalesOrdersRepository;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parsePage(value: string | undefined): number {
  const page = parseInt(value || '', 10);
  if (Number.isNaN(page) || page === 0) return 1;
  if (page < 1) throw createHttpError(400, 'Página inválida.');
  return page;
}

function parseLimit(value: string | undefined): number {
  const limit = parseInt(value || '', 10);
  if (Number.isNaN(limit) || limit === 0) return 25;
  if (limit < 1) throw createHttpError(400, 'Limite inválido.');
  if (limit > 200) {
    throw createHttpError(400, 'Limite máximo é 200 registros por página.');
  }
  return limit;
}

function validateStatus(value: string | undefined): string | undefined {
  const status = (value || '').trim();
  if (!status) return undefined;
  const valid = SALES_ORDER_STATUSES.some(
    (candidate) => candidate.toLowerCase() === status.toLowerCase()
  );
  if (!valid) {
    throw createHttpError(
      400,
      'Status inválido. Valores aceitos: ' + SALES_ORDER_STATUSES.join(', ')
    );
  }
  return status;
}

function listOptions(query: Record<string, string | undefined>): SalesOrderListOptions {
  return {
    page: parsePage(query.page),
    limit: parseLimit(query.limit),
    period: (query.period || '').trim().toLowerCase() || undefined,
    status: validateStatus(query.status),
    search: (query.search || '').trim() || undefined,
    from: (query.from || '').trim() || undefined,
    to: (query.to || '').trim() || undefined,
  };
}

function logError(error: unknown): void {
  const value = error as { logMessage?: string; message?: string };
  console.error('[sales-orders]', value.logMessage || value.message || error);
}

export function createSalesOrdersHandler(
  dependencies: SalesOrdersHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresSalesOrdersRepository();
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
    try {
      const query = event.queryStringParameters || {};
      if (query.id) {
        const detail = await repository.get(query.id);
        if (!detail) throw createHttpError(404, 'Pedido de Venda não encontrado.');
        return json(200, detail);
      }
      return json(200, await repository.list(listOptions(query)));
    } catch (error) {
      logError(error);
      const statusCode = Number.isInteger((error as { statusCode?: unknown })?.statusCode)
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
      return json(statusCode, {
        error: statusCode === 500 ? 'Erro interno.' : (error as Error).message,
      });
    }
  };
}

export const createHandler = createSalesOrdersHandler;
export const handler = createSalesOrdersHandler();
