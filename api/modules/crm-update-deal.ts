import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createHttpError } from '../_shared/http-error.js';
import {
  createPostgresCrmDealRepository,
  type CrmDealRepository,
  type CrmDealStatus,
} from '../_db/crm-deals-repository.js';

export interface CrmUpdateDealHandlerDependencies {
  repository?: CrmDealRepository;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parsePayload(body: string | undefined): Record<string, unknown> {
  try {
    const value = JSON.parse(body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('payload');
    }
    return value as Record<string, unknown>;
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
}

export function createCrmUpdateDealHandler(
  dependencies: CrmUpdateDealHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresCrmDealRepository();
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (event.httpMethod !== 'PUT' && event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido.' });
    }
    try {
      const payload = parsePayload(event.body);
      const dealId = typeof payload.deal_id === 'string' ? payload.deal_id.trim() : '';
      if (!dealId || typeof payload.status !== 'string' || !payload.status.trim()) {
        throw createHttpError(400, 'deal_id e status são obrigatórios.');
      }
      const result = await repository.updateStatus(dealId, {
        status: payload.status as CrmDealStatus,
        followUpStage: payload.follow_up_stage as number | null | undefined,
      });
      if (!result) throw createHttpError(404, 'Oportunidade não encontrada.');
      return json(200, { success: true, deal_id: dealId, status: result.status });
    } catch (error) {
      const httpError = error as { statusCode?: number; message?: string; logMessage?: string };
      const statusCode = Number.isInteger(httpError.statusCode) ? httpError.statusCode! : 500;
      console.error('[crm-update-deal]', httpError.logMessage || httpError.message || error);
      return json(statusCode, {
        error: httpError.statusCode ? httpError.message : 'Erro interno.',
      });
    }
  };
}

export const handler = createCrmUpdateDealHandler();
