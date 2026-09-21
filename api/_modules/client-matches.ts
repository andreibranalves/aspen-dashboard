import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  classifyClientMatch,
  isSearchableClientMatchInput,
  normalizeClientMatchInput,
  ClientMatchInputError,
} from './client-matching.js';
import {
  createPostgresClientMatchRepository,
  type ClientMatchRepository,
} from '../_infrastructure/db/repositories/client-matching-repository.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface ClientMatchesDependencies {
  repository: ClientMatchRepository;
}

const UNAVAILABLE_MESSAGE = 'Não foi possível verificar o cliente. Tente novamente.';

function json(statusCode: number, payload: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

/**
 * Read-only client identity query used by the automatic Split Card. It never
 * creates clients, opportunities, activities or quotations, and it never turns
 * a database failure into an empty success.
 */
export function createCoreHandler(
  dependencies: ClientMatchesDependencies = {
    repository: createPostgresClientMatchRepository(),
  }
): Handler {
  return async function clientMatchesCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });

    let payload: unknown;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }

    try {
      const input = normalizeClientMatchInput(payload);
      const records = isSearchableClientMatchInput(input)
        ? await dependencies.repository.search(input)
        : [];
      return json(200, classifyClientMatch(input, records));
    } catch (error) {
      if (error instanceof ClientMatchInputError) {
        return json(error.statusCode, { error: error.message });
      }
      const kind = error instanceof Error ? error.name : typeof error;
      console.error(`[client-matches] matching failed (${kind})`);
      return json(503, { error: UNAVAILABLE_MESSAGE });
    }
  };
}

export const coreHandler = createCoreHandler();
export const handler = coreHandler;
