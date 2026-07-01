import type {
  FunctionEvent,
  FunctionResult,
  JsonResponseFn,
  LegacyHandler,
} from '../_lib/types.js';
import { createHttpError } from './lib/erpnext.js';
import {
  getWhatsappMessages,
  listWhatsappConversations,
  updateWhatsappConversation,
  type WhatsappConversationStatus,
  type WhatsappConversationStoreDeps,
} from './lib/whatsapp-conversations-store.js';
import {
  syncWhatsappConversations,
  type EvolutionSyncDeps,
} from './lib/whatsapp-conversations-sync.js';

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

function getSubPath(event: FunctionEvent): string[] {
  const url = (event.url || '').split('?')[0];
  const path = url.replace(/^\/api\/whatsapp-conversations\/?/, '');
  return path.split('/').filter(Boolean).map(decodeURIComponent);
}

function parseStatus(value: unknown): WhatsappConversationStatus | 'all' {
  const allowed: (WhatsappConversationStatus | 'all')[] = [
    'new',
    'needs_quote',
    'incomplete',
    'quote_lead_created',
    'quotation_created',
    'waiting_customer',
    'closed',
    'ignored',
    'all',
  ];
  return allowed.includes(value as WhatsappConversationStatus | 'all')
    ? (value as WhatsappConversationStatus | 'all')
    : 'all';
}

function parseLimit(value: unknown): number {
  const limit = Number(value || 50);
  return Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
}

export function createHandler(
  deps?: EvolutionSyncDeps & WhatsappConversationStoreDeps
): LegacyHandler {
  return async function whatsappConversationsHandler(
    event: FunctionEvent
  ): Promise<FunctionResult> {
    try {
      const parts = getSubPath(event);

      if (event.httpMethod === 'GET' && parts.length === 0) {
        const data = await listWhatsappConversations(
          {
            status: parseStatus(event.queryStringParameters?.status),
            q: event.queryStringParameters?.q || '',
            hasQuoteRequest: event.queryStringParameters?.hasQuoteRequest,
            limit: parseLimit(event.queryStringParameters?.limit),
          },
          deps
        );
        return jsonResponse(200, { success: true, data });
      }

      if (event.httpMethod === 'GET' && parts.length === 2 && parts[1] === 'messages') {
        const data = await getWhatsappMessages(parts[0], deps);
        return jsonResponse(200, { success: true, data });
      }

      if (event.httpMethod === 'POST' && parts.length === 1 && parts[0] === 'sync') {
        const body = parseJsonBody(event.body);
        const data = await syncWhatsappConversations(
          {
            chatLimit: parseLimit(body.chatLimit || 5),
            messageLimit: parseLimit(body.messageLimit || 50),
          },
          deps as EvolutionSyncDeps
        );
        return jsonResponse(200, { success: true, data });
      }

      if (event.httpMethod === 'PATCH' && parts.length === 1) {
        const body = parseJsonBody(event.body);
        const data = await updateWhatsappConversation(
          parts[0],
          {
            status: parseStatus(body.status) as WhatsappConversationStatus,
            linkedLeadId: body.linkedLeadId == null ? null : String(body.linkedLeadId),
            linkedDealId: body.linkedDealId == null ? null : String(body.linkedDealId),
            linkedQuotationId:
              body.linkedQuotationId == null ? null : String(body.linkedQuotationId),
          },
          deps
        );
        return jsonResponse(200, { success: true, data });
      }

      return jsonResponse(404, { error: 'Endpoint não encontrado.' });
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[whatsapp-conversations]', err?.logMessage || err?.message || err);
      return jsonResponse(code, {
        error: err?.message || 'Erro interno ao buscar conversas do WhatsApp.',
      });
    }
  };
}

export const handler: LegacyHandler = createHandler();
