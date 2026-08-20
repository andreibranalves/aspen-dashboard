import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createHttpError } from '../_shared/http-error.js';
import {
  createPostgresCrmDealRepository,
  type CrmDealRepository,
} from '../_infrastructure/db/repositories/crm-deals-repository.js';
import {
  getPruneCandidates,
  parseDealIds,
  pruneDeals,
  PRUNE_PROTECT_RECENT_DAYS,
  PRUNE_THRESHOLD_DAYS,
} from './crm-prune.js';

export interface CrmPruneCandidatesHandlerDependencies {
  repository?: CrmDealRepository;
  now?: () => Date;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(body: string | undefined): unknown {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
}

export function createCrmPruneCandidatesHandler(
  dependencies: CrmPruneCandidatesHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresCrmDealRepository();
  const now = dependencies.now || (() => new Date());
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    try {
      if (event.httpMethod === 'GET') {
        const candidates = await getPruneCandidates(repository, now());
        return json(200, {
          candidates,
          meta: {
            threshold_days: PRUNE_THRESHOLD_DAYS,
            protect_recent_days: PRUNE_PROTECT_RECENT_DAYS,
            count: candidates.length,
          },
        });
      }

      if (event.httpMethod === 'POST') {
        const dealIds = parseDealIds(parseJsonBody(event.body));
        return json(200, await pruneDeals(dealIds, now(), repository));
      }

      return json(405, { error: 'Método não permitido.' });
    } catch (error) {
      const httpError = error as { statusCode?: number; message?: string; logMessage?: string };
      const statusCode = Number.isInteger(httpError.statusCode) ? httpError.statusCode! : 500;
      console.error('[crm-prune-candidates]', httpError.logMessage || httpError.message || error);
      return json(statusCode, {
        error: httpError.statusCode ? httpError.message : 'Erro interno.',
      });
    }
  };
}

export const handler = createCrmPruneCandidatesHandler();
