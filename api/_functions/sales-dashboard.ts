// GET /api/sales-dashboard - aggregated local sales metrics.
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import {
  createPostgresSalesOrdersRepository,
  type DashboardPeriod,
  type SalesOrdersRepository,
} from '../_db/sales-orders-repository.js';

export interface SalesDashboardHandlerDependencies {
  repository?: Pick<SalesOrdersRepository, 'dashboard'>;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function queryValue(
  query: Record<string, string | undefined>,
  key: string,
  lowerCase = false
): string | undefined {
  const value = query[key];
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return lowerCase ? normalized.toLowerCase() : normalized;
}

function dashboardOptions(query: Record<string, string | undefined>): DashboardPeriod {
  return {
    period: queryValue(query, 'period', true),
    from: queryValue(query, 'from'),
    to: queryValue(query, 'to'),
  };
}

function logError(error: unknown): void {
  const value = error as { logMessage?: string; message?: string };
  console.error('[sales-dashboard]', value.logMessage || value.message || error);
}

export function createSalesDashboardHandler(
  dependencies: SalesDashboardHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresSalesOrdersRepository();
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
    try {
      return json(
        200,
        await repository.dashboard(dashboardOptions(event.queryStringParameters || {}))
      );
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

export const createHandler = createSalesDashboardHandler;
export const handler = createSalesDashboardHandler();
