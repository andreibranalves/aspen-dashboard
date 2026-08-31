// GET /api/sales-orders - local sales order list and detail.
import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createHttpError } from '../_shared/http-error.js';
import {
  createPostgresSalesOrdersRepository,
  SALES_ORDER_STATUSES,
  type SalesOrderListOptions,
  type SalesOrderProgressInput,
  type SalesOrdersRepository,
} from '../_infrastructure/db/repositories/sales-orders-repository.js';

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
function parseProgressBody(body: string): SalesOrderProgressInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body || '');
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createHttpError(400, 'Envie um payload válido.');
  }
  const input = parsed as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.length === 0 ||
    keys.some((key) => key !== 'per_billed' && key !== 'per_delivered')
  ) {
    throw createHttpError(
      400,
      'Informe per_billed ou per_delivered com um percentual inteiro de 0 a 100.'
    );
  }
  for (const key of ['per_billed', 'per_delivered'] as const) {
    if (input[key] === undefined) continue;
    if (!Number.isInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > 100) {
      throw createHttpError(400, `${key} deve ser um percentual inteiro entre 0 e 100.`);
    }
  }
  return {
    ...(input.per_billed === undefined ? {} : { per_billed: input.per_billed as number }),
    ...(input.per_delivered === undefined
      ? {}
      : { per_delivered: input.per_delivered as number }),
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
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'PATCH') {
      return {
        ...json(405, { error: 'Método não permitido.' }),
        headers: { 'Content-Type': 'application/json', Allow: 'GET, PATCH' },
      };
    }
    try {
      const query = event.queryStringParameters || {};
      if (!query.id) {
        if (event.httpMethod === 'PATCH') {
          throw createHttpError(400, 'ID do pedido é obrigatório.');
        }
        return json(200, await repository.list(listOptions(query)));
      }
      if (event.httpMethod === 'PATCH') {
        return json(200, await repository.update(query.id, parseProgressBody(event.body)));
      }
      const detail = await repository.get(query.id);
      if (!detail) throw createHttpError(404, 'Pedido de Venda não encontrado.');
      return json(200, detail);
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
