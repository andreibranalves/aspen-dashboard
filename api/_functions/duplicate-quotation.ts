// POST /api/duplicate-quotation - Duplicates a local PostgreSQL quotation.
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import {
  createPostgresQuoteDraftRepository,
  QuoteDraftConflictError,
  QuoteDraftInputError,
  QuoteDraftNotFoundError,
  QuoteDraftRepositoryError,
  type QuoteDraftRepository,
  type QuoteDuplicateResult,
} from '../_db/quote-repository.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;
export type DuplicateQuotationRepository = Pick<
  QuoteDraftRepository,
  'duplicateDraft' | 'duplicateQuotation'
>;

export interface DuplicateQuotationHandlerDependencies {
  repository?: DuplicateQuotationRepository;
}

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

function logError(error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[duplicate-quotation] failed (${kind})`);
}

function errorResponse(error: unknown): FunctionResult {
  logError(error);
  if (
    error instanceof QuoteDraftInputError ||
    error instanceof QuoteDraftNotFoundError ||
    error instanceof QuoteDraftConflictError ||
    error instanceof QuoteDraftRepositoryError
  ) {
    return json(error.statusCode, { error: error.message });
  }
  return json(503, { error: 'Não foi possível duplicar o orçamento. Tente novamente.' });
}

export async function duplicateQuotation(
  quotationId: string,
  repository: DuplicateQuotationRepository = createPostgresQuoteDraftRepository(),
): Promise<QuoteDuplicateResult> {
  const duplicate = repository.duplicateQuotation || repository.duplicateDraft;
  if (!duplicate) {
    throw new QuoteDraftRepositoryError('Não foi possível duplicar o orçamento. Tente novamente.');
  }
  return duplicate(quotationId);
}

export function createHandler(
  dependencies: DuplicateQuotationHandlerDependencies = {},
): Handler {
  const repository = dependencies.repository || createPostgresQuoteDraftRepository();
  return async function duplicateQuotationHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });

    let payload: unknown;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }
    if (!isRecord(payload)) return json(400, { error: 'Envie um payload válido.' });

    const quotationId = payload.quotation_id;
    if (typeof quotationId !== 'string' || !quotationId.trim()) {
      return json(400, { error: 'ID do orçamento é obrigatório.' });
    }

    try {
      const result = await duplicateQuotation(quotationId, repository);
      return json(200, { success: true, new_id: result.quotation_id });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createHandler();
