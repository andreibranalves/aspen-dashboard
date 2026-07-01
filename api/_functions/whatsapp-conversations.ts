// GET/POST/PATCH /api/whatsapp-conversations — WhatsApp commercial inbox
import type {
  FunctionEvent,
  FunctionResult,
  JsonResponseFn,
  LegacyHandler,
} from '../_lib/types.js';
import { handler as extractHandler } from './extract.js';
import { createHttpError } from './lib/erpnext.js';
import { upsertQuoteLead } from './lib/quote-leads-store.js';
import {
  getWhatsappConversation,
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

interface WhatsappActionDeps extends EvolutionSyncDeps, WhatsappConversationStoreDeps {
  extractOrders?: (text: string) => Promise<unknown[]>;
  upsertQuoteLead?: (input: Record<string, unknown>) => Promise<unknown>;
}

function buildConversationText(messages: Array<{ direction: string; body: string }>): string {
  return messages
    .filter((message) => message.body)
    .slice(-50)
    .map((message) => `${message.direction === 'outbound' ? 'Aspen' : 'Cliente'}: ${message.body}`)
    .join('\n');
}

async function liveExtractOrders(text: string): Promise<unknown[]> {
  const result = await extractHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ text }),
    queryStringParameters: {},
    headers: {},
  } as FunctionEvent);
  const code = result.statusCode || 500;
  if (code >= 400) {
    let errorBody: Record<string, unknown> = {};
    try {
      errorBody = JSON.parse(result.body || '{}');
    } catch {
      /* ignore */
    }
    throw createHttpError(code, String(errorBody.error || 'Erro ao extrair orçamento.'));
  }
  let resBody: Record<string, unknown> = {};
  try {
    resBody = JSON.parse(result.body || '{}');
  } catch {
    /* ignore */
  }
  return Array.isArray(resBody.orders) ? resBody.orders : [];
}

function missingFieldsForPreQuote(input: {
  nome: string;
  telefone: string;
  pedidoTexto: string;
}): string[] {
  const missing: string[] = [];
  if (!input.nome) missing.push('nome');
  if (!input.telefone) missing.push('contato');
  if (!input.pedidoTexto) missing.push('pedido');
  return missing;
}

export function createHandler(deps?: WhatsappActionDeps): LegacyHandler {
  return async function whatsappConversationsHandler(
    event: FunctionEvent
  ): Promise<FunctionResult> {
    try {
      const qs = event.queryStringParameters || {};
      const body =
        event.httpMethod !== 'GET' ? parseJsonBody(event.body) : {};

      // ── GET /api/whatsapp-conversations ——
      if (event.httpMethod === 'GET') {
        // Single conversation by id
        if (qs.id) {
          const conversation = await getWhatsappConversation(qs.id, deps);
          return jsonResponse(200, { success: true, data: conversation });
        }

        // Messages for a conversation
        if (qs.messages) {
          const data = await getWhatsappMessages(qs.messages, deps);
          return jsonResponse(200, { success: true, data });
        }

        // List conversations
        const data = await listWhatsappConversations(
          {
            status: parseStatus(qs.status),
            q: qs.q || '',
            hasQuoteRequest: qs.hasQuoteRequest,
            limit: parseLimit(qs.limit),
          },
          deps
        );
        return jsonResponse(200, { success: true, data });
      }

      // ── POST /api/whatsapp-conversations ——
      if (event.httpMethod === 'POST') {
        const action = String(body.action || '');

        // Sync conversations from Evolution
        if (action === 'sync') {
          const data = await syncWhatsappConversations(
            {
              chatLimit: parseLimit(body.chatLimit || 5),
              messageLimit: parseLimit(body.messageLimit || 50),
            },
            deps as EvolutionSyncDeps
          );
          return jsonResponse(200, { success: true, data });
        }

        // Extract quote from conversation messages
        if (action === 'extract-quote') {
          const id = String(body.id || '');
          const conversation = await getWhatsappConversation(id, deps);
          const messages = await getWhatsappMessages(id, deps);
          const text = buildConversationText(messages);
          const extractOrders = deps?.extractOrders || liveExtractOrders;
          const orders = await extractOrders(text);

          return jsonResponse(200, {
            success: true,
            data: {
              conversationId: conversation.id,
              inputMessageIds: messages.map((m) => m.id),
              extractedPayload: { orders },
              confidence: orders.length > 0 ? 0.8 : 0.2,
              missingFields: orders.length > 0 ? [] : ['pedido'],
              createdAt: new Date().toISOString(),
            },
          });
        }

        // Create pre-quote lead from conversation
        if (action === 'create-quote-lead') {
          const id = String(body.id || '');
          const conversation = await getWhatsappConversation(id, deps);
          const messages = await getWhatsappMessages(id, deps);
          const pedidoTexto = buildConversationText(messages);
          const leadInput = {
            nome: conversation.displayName,
            telefone: conversation.phone,
            pedidoTexto,
            source: 'whatsapp',
            sourceDetail: conversation.remoteJid,
            externalId: conversation.id,
            status: missingFieldsForPreQuote({
              nome: conversation.displayName,
              telefone: conversation.phone,
              pedidoTexto,
            }).length
              ? 'incomplete'
              : 'ready',
            raw: {
              conversationId: conversation.id,
              extractedPayload: body.extractedPayload || null,
            },
          };

          const createLead = deps?.upsertQuoteLead || upsertQuoteLead;
          const data = await createLead(leadInput);
          await updateWhatsappConversation(
            conversation.id,
            { status: 'quote_lead_created', linkedLeadId: (data as { id?: string }).id || null },
            deps
          );

          return jsonResponse(201, { success: true, data });
        }

        return jsonResponse(400, { error: 'Ação não reconhecida. Use action: sync, extract-quote, ou create-quote-lead.' });
      }

      // ── PATCH /api/whatsapp-conversations ——
      if (event.httpMethod === 'PATCH') {
        const id = String(body.id || '');
        const data = await updateWhatsappConversation(
          id,
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

      return jsonResponse(405, { error: 'Método não permitido.' });
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
