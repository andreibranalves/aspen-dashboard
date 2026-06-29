// GET/PATCH /api/quote-leads — structured quote lead queue for Auto page
import type {
  FunctionEvent,
  FunctionResult,
  JsonResponseFn,
  LegacyHandler,
} from '../_lib/types.js';
import { createHttpError } from './lib/erpnext.js';
import {
  listQuoteLeads,
  updateQuoteLead,
  type QuoteLeadStoreDeps,
  type QuoteLeadStatus,
} from './lib/quote-leads-store.js';

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function parseJsonBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === 'object') return body as Record<string, unknown>;
  try {
    return JSON.parse(String(body));
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
}

function parseLimit(value: unknown): number {
  const limit = Number(value || 5);
  return Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 5;
}

function parseStatus(value: unknown): QuoteLeadStatus | 'all' {
  return value === 'converted' || value === 'discarded' || value === 'all' ? value : 'new';
}

export function createHandler(deps?: QuoteLeadStoreDeps): LegacyHandler {
  return async function quoteLeadsHandler(event: FunctionEvent): Promise<FunctionResult> {
    try {
      if (event.httpMethod === 'GET') {
        const data = await listQuoteLeads(
          {
            status: parseStatus(event.queryStringParameters?.status),
            limit: parseLimit(event.queryStringParameters?.limit),
          },
          deps
        );
        return jsonResponse(200, { success: true, data });
      }

      if (event.httpMethod === 'PATCH') {
        const body = parseJsonBody(event.body);
        const id = String(body.id || '').trim();
        if (!id) return jsonResponse(400, { error: 'ID do lead é obrigatório.' });
        const data = await updateQuoteLead(
          id,
          {
            status: parseStatus(body.status) as QuoteLeadStatus,
            quotationId: body.quotationId == null ? null : String(body.quotationId),
          },
          deps
        );
        return jsonResponse(200, { success: true, data });
      }

      return jsonResponse(405, { error: 'Method Not Allowed' });
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
