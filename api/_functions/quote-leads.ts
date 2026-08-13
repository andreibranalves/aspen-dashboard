// GET/PATCH /api/quote-leads - structured quote lead queue for Auto page
import type {
  FunctionEvent,
  FunctionResult,
  JsonResponseFn,
  LegacyHandler,
} from '../_lib/types.js';
import { createHttpError } from '../_lib/http-error.js';
import {
  createPostgresQuoteLeadRepository,
  type QuoteLeadRepository,
  type QuoteLeadStatus,
} from '../_db/quote-leads-repository.js';

const LIVE_REPOSITORY = createPostgresQuoteLeadRepository();

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function parseJsonBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(body));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not-object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
}

function parseLimit(value: unknown): number {
  const limit = Number(value || 5);
  return Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 50)) : 5;
}

function parseStatus(value: unknown): QuoteLeadStatus | 'all' {
  return value === 'converted' ||
    value === 'discarded' ||
    value === 'reviewing' ||
    value === 'ready' ||
    value === 'incomplete' ||
    value === 'all'
    ? value
    : 'new';
}

function getBearerToken(headers: Record<string, string | undefined> = {}): string {
  const raw = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() || '';
}

function isIngestAuthorized(headers: Record<string, string | undefined> = {}): boolean {
  const expected = String(process.env.QUOTE_LEADS_INGEST_TOKEN || '').trim();
  return !!expected && getBearerToken(headers) === expected;
}

function parseSource(value: unknown): string {
  const source = String(value || 'all').trim();
  return source || 'all';
}

export function createHandler(repository: QuoteLeadRepository = LIVE_REPOSITORY): LegacyHandler {
  return async function quoteLeadsHandler(event: FunctionEvent): Promise<FunctionResult> {
    try {
      if (event.httpMethod === 'GET') {
        const data = await repository.list({
          status: parseStatus(event.queryStringParameters?.status),
          source: parseSource(event.queryStringParameters?.source),
          q: event.queryStringParameters?.q || '',
          limit: parseLimit(event.queryStringParameters?.limit),
        });
        return jsonResponse(200, { success: true, data });
      }

      if (event.httpMethod === 'POST') {
        if (!isIngestAuthorized(event.headers as Record<string, string | undefined>)) {
          return jsonResponse(401, { error: 'Não autorizado.' });
        }
        const body = parseJsonBody(event.body);
        const data = await repository.upsert(body);
        return jsonResponse(201, { success: true, data });
      }

      if (event.httpMethod === 'PATCH') {
        const body = parseJsonBody(event.body);
        const id = String(body.id || '').trim();
        if (!id) return jsonResponse(400, { error: 'ID do lead é obrigatório.' });
        const patch = { ...body } as Record<string, unknown>;
        delete patch.id;
        if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
          const status = parseStatus(patch.status);
          if (status === 'all') throw createHttpError(400, 'Status inválido.');
          patch.status = status;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'quotationId')) {
          patch.quotationId = patch.quotationId == null ? null : String(patch.quotationId);
        }
        const data = await repository.update(id, patch);
        if (!data) return jsonResponse(404, { error: 'Lead de orçamento não encontrado.' });
        return jsonResponse(200, { success: true, data });
      }

      return jsonResponse(405, { error: 'Método não permitido.' });
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[quote-leads]', err?.logMessage || err?.message || err);
      return jsonResponse(code, {
        error: err?.message || 'Erro interno ao buscar leads de orçamento.',
      });
    }
  };
}

export const handler: LegacyHandler = createHandler();
