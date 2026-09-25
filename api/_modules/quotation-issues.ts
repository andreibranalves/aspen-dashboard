import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_http/types.js';
import {
  createQuotationIssueRepository,
  QuotationIssueConflictError,
  QuotationIssueInputError,
  QuotationIssueRepositoryError,
  type QuotationIssueRepositoryOptions,
} from '../_infrastructure/db/repositories/quotation-issue-repository.js';
import { safeErrorSummary } from '../_shared/safe-error.js';

function json(statusCode: number, payload: unknown): FunctionResult {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(payload) };
}
function body(event: FunctionEvent): Record<string, unknown> {
  try { const value = JSON.parse(event.body || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new QuotationIssueInputError('JSON inválido.'); }
}
function header(event: FunctionEvent, key: string): string {
  const headers = event.headers || {}; const value = headers[key] ?? headers[key.toLowerCase()]; return Array.isArray(value) ? value[0] || '' : String(value || '');
}
function safe(error: unknown): FunctionResult {
  if (error instanceof QuotationIssueInputError || error instanceof QuotationIssueConflictError) return json(error.statusCode, { error: error.message });
  if (error instanceof QuotationIssueRepositoryError) return json(503, { error: error.message });
  console.error(`[quotation-issues] failed (${safeErrorSummary(error)})`);
  return json(503, { error: 'Não foi possível emitir o orçamento. Tente novamente.' });
}
export interface QuotationIssuesHandlerDependencies extends QuotationIssueRepositoryOptions {
  issue?: (input: Parameters<ReturnType<typeof createQuotationIssueRepository>['issue']>[0]) => ReturnType<ReturnType<typeof createQuotationIssueRepository>['issue']>;
  read?: (key: string) => ReturnType<ReturnType<typeof createQuotationIssueRepository>['read']>;
}

export function createQuotationIssuesHandler(options: QuotationIssuesHandlerDependencies = {}): LegacyHandler {
  const repository = createQuotationIssueRepository(undefined, options);
  const issue = options.issue || repository.issue;
  const read = options.read || repository.read;
  return async (event) => {
    try {
      if (event.httpMethod === 'GET') {
        const key = String(event.queryStringParameters?.idempotency_key || '').trim();
        if (!key) return json(400, { error: 'Idempotency-Key é obrigatório.' });
        const result = await read(key);
        return result ? json(200, result) : json(404, { error: 'Emissão não encontrada.' });
      }
      if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
      const idempotencyKey = header(event, 'Idempotency-Key').trim();
      if (!idempotencyKey) return json(400, { error: 'Idempotency-Key é obrigatório.' });
      const payload = body(event);
      const revisionId = typeof payload.revisionId === 'string' ? payload.revisionId : typeof payload.revision_id === 'string' ? payload.revision_id : '';
      const concurrencyToken = typeof payload.concurrencyToken === 'string' ? payload.concurrencyToken : typeof payload.concurrency_token === 'string' ? payload.concurrency_token : '';
      if (!revisionId.trim()) return json(400, { error: 'Identificador da revisão é obrigatório para emitir o orçamento.' });
      if (!concurrencyToken.trim()) return json(400, { error: 'Token de concorrência é obrigatório para emitir o orçamento.' });
      const result = await issue({ idempotencyKey, revisionId, concurrencyToken });
      return json(200, result);
    } catch (error) { return safe(error); }
  };
}
export const handler = createQuotationIssuesHandler();
