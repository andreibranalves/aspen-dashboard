import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import {
  createPostgresQuoteDraftRepository,
  QuoteDraftConflictError,
  QuoteDraftInputError,
  QuoteDraftNotFoundError,
  QuoteDraftRepositoryError,
  type QuoteDraftCreateInput,
  type QuoteDraftRepository,
} from '../_db/quote-repository.js';
import { responseMetadata } from './orcamento-mode.js';

export interface OrcamentoCoreDependencies {
  repository: QuoteDraftRepository;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ...responseMetadata('core') }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function logError(error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[orcamento-core] create failed (${kind})`);
}

function draftResponse(result: unknown): Record<string, unknown> {
  const payload = result as Record<string, unknown>;
  const eventId = typeof payload.outbox_event_id === 'string' ? payload.outbox_event_id : '';
  const eventType = typeof payload.outbox_event_type === 'string' ? payload.outbox_event_type : '';
  const idempotencyKey =
    typeof payload.outbox_idempotency_key === 'string' ? payload.outbox_idempotency_key : '';
  if (!eventId || !eventType || !idempotencyKey) return payload;
  return {
    ...payload,
    outbox: {
      status: 'queued',
      event_id: eventId,
      event_type: eventType,
      idempotency_key: idempotencyKey,
    },
  };
}

function errorResponse(error: unknown): FunctionResult {
  logError(error);
  if (
    error instanceof QuoteDraftInputError ||
    error instanceof QuoteDraftNotFoundError ||
    error instanceof QuoteDraftConflictError
  ) {
    return json(error.statusCode, { error: error.message });
  }
  if (error instanceof QuoteDraftRepositoryError) {
    return json(error.statusCode, { error: error.message });
  }
  return json(503, { error: 'Não foi possível salvar o rascunho do orçamento. Tente novamente.' });
}

export function createCoreHandler(
  dependencies: OrcamentoCoreDependencies = {
    repository: createPostgresQuoteDraftRepository(),
  },
): LegacyHandler {
  return async function orcamentoCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });

    let payload: unknown;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }
    if (!isRecord(payload)) return json(400, { error: 'Envie um payload válido.' });

    const extracted = payload.extracted;
    if (!isRecord(extracted)) return json(400, { error: 'Campo "extracted" obrigatório.' });

    try {
      const createDraft = dependencies.repository.createDraft || dependencies.repository.create;
      if (!createDraft) {
        return json(503, { error: 'Não foi possível salvar o rascunho do orçamento. Tente novamente.' });
      }
      const result = await createDraft(extracted as QuoteDraftCreateInput);
      return json(201, draftResponse(result));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const coreHandler = createCoreHandler();
export const handler = coreHandler;
