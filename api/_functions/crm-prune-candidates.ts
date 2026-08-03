import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { createHttpError, erpGetList, erpPut } from './lib/erpnext.js';
import { isOperationalMode } from './operational-mode.js';
import {
  getPruneCandidates,
  parseDealIds,
  pruneDeals,
  PRUNE_PROTECT_RECENT_DAYS,
  PRUNE_THRESHOLD_DAYS,
} from './lib/crm-prune.js';

const deps = { erpGetList, erpPut };

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(body: string | undefined | null): unknown {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
}

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (isOperationalMode()) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'crm-prune-candidates não está disponível no modo operacional.' }) };
  }
  try {
    if (event.httpMethod === 'GET') {
      const candidates = await getPruneCandidates(deps);
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
      return json(200, await pruneDeals(dealIds, deps));
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  } catch (err: any) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[crm-prune-candidates]', err?.logMessage || err?.message || err);
    return json(code, { error: err?.statusCode ? err.message : 'Erro interno.' });
  }
}
