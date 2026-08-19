// POST /api/sales-order-from-quotation - transactional local conversion.
import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createHttpError } from '../_shared/http-error.js';
import {
  createPostgresSalesOrdersRepository,
  type SalesOrdersRepository,
} from '../_infrastructure/db/repositories/sales-orders-repository.js';

export interface SalesOrderFromQuotationHandlerDependencies {
  repository?: SalesOrdersRepository;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function payloadFrom(body: string | undefined): Record<string, unknown> {
  try {
    const value = JSON.parse(body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('payload');
    return value as Record<string, unknown>;
  } catch {
    throw createHttpError(400, 'JSON inválido');
  }
}

function logError(error: unknown): void {
  const value = error as { logMessage?: string; message?: string };
  console.error('[sales-order-from-quotation]', value.logMessage || value.message || error);
}

export function createSalesOrderFromQuotationHandler(
  dependencies: SalesOrderFromQuotationHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresSalesOrdersRepository();
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
    try {
      const payload = payloadFrom(event.body);
      const quotationId =
        typeof payload.quotation_id === 'string' ? payload.quotation_id.trim() : '';
      if (!quotationId) {
        throw createHttpError(400, 'Informe o orçamento para gerar o pedido de venda.');
      }
      const result = await repository.createFromQuotation(quotationId);
      return json(200, {
        success: true,
        quotation_id: quotationId,
        sales_order_id: result.id,
        sales_order_status: result.status,
        docstatus: result.docstatus,
        already_exists: result.alreadyExists,
        crm_updated: result.crmUpdated,
      });
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

export const createHandler = createSalesOrderFromQuotationHandler;
export const handler = createSalesOrderFromQuotationHandler();
