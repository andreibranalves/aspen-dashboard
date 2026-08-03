// GET/POST/PATCH /api/whatsapp-conversations — WhatsApp commercial inbox
import type {
  FunctionEvent,
  FunctionResult,
  JsonResponseFn,
  LegacyHandler,
} from '../_lib/types.js';
import { handler as extractHandler } from './extract.js';
import { sendText } from './send-whatsapp.js';
import { createHttpError, erpGetDoc, erpGetList } from './lib/erpnext.js';
import { isOperationalMode } from './operational-mode.js';
import { upsertQuoteLead } from './lib/quote-leads-store.js';
import {
  LIVE_DEPS,
  cleanText,
  getWhatsappConversation,
  getWhatsappMessages,
  listWhatsappConversations,
  updateWhatsappConversation,
  upsertWhatsappMessages,
  type WhatsappConversationStatus,
  type WhatsappConversationStoreDeps,
} from './lib/whatsapp-conversations-store.js';
import { resolveWhatsappCrmMatch, type ResolveCrmMatchDeps } from './lib/whatsapp-crm-match.js';
import {
  syncWhatsappConversations,
  syncMessagesForConversation,
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

interface WhatsappActionDeps
  extends EvolutionSyncDeps, WhatsappConversationStoreDeps, ResolveCrmMatchDeps {
  extractOrders?: (text: string) => Promise<unknown[]>;
  upsertQuoteLead?: (input: Record<string, unknown>) => Promise<unknown>;
  sendTextMessage?: (number: string, text: string) => Promise<unknown>;
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

async function liveListLeads(
  filters: Array<Array<string | number>>
): Promise<Array<Record<string, unknown>>> {
  return erpGetList('Lead', {
    fields: ['name', 'lead_name', 'first_name', 'email_id', 'mobile_no'],
    filters,
    limit: 50,
  });
}

function buildCrmDeps(deps?: Partial<WhatsappActionDeps>): ResolveCrmMatchDeps {
  return {
    ...LIVE_DEPS,
    ...(deps || {}),
    listLeads: deps?.listLeads || liveListLeads,
    getDoc: deps?.getDoc || erpGetDoc,
  };
}

export function createHandler(deps?: WhatsappActionDeps): LegacyHandler {
  return async function whatsappConversationsHandler(
    event: FunctionEvent
  ): Promise<FunctionResult> {
    try {
      const qs = event.queryStringParameters || {};
      const body = event.httpMethod !== 'GET' ? parseJsonBody(event.body) : {};

      // ── GET /api/whatsapp-conversations ——
      if (event.httpMethod === 'GET') {
        // Single conversation by id
        if (qs.id) {
          const conversation = await getWhatsappConversation(qs.id, deps);
          let crmMatch = null;
          try {
            crmMatch = await resolveWhatsappCrmMatch({
              conversation,
              deps: buildCrmDeps(deps),
            });
          } catch (matchErr) {
            console.error(
              '[whatsapp-conversations] CRM match failed:',
              (matchErr as Error)?.message || matchErr
            );
          }
          return jsonResponse(200, { success: true, data: { ...conversation, crmMatch } });
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
              messageLimit: parseLimit(body.messageLimit || 100),
            },
            deps as EvolutionSyncDeps
          );
          return jsonResponse(200, { success: true, data });
        }

        // Sync messages for a single conversation
        if (action === 'sync-messages') {
          const id = String(body.id || '');
          const conversation = await getWhatsappConversation(id, deps);
          await syncMessagesForConversation(conversation, 100, deps as EvolutionSyncDeps);
          const messages = await getWhatsappMessages(id, deps);
          return jsonResponse(200, { success: true, data: messages });
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

          // Block pre-quote creation when identity is not confirmed
          if (
            conversation.identityStatus === 'unresolved' ||
            conversation.identityStatus === 'conflict'
          ) {
            return jsonResponse(400, {
              error: 'Não é possível criar pré-orçamento com identidade do contato não confirmada.',
            });
          }

          const messages = await getWhatsappMessages(id, deps);
          const pedidoTexto = buildConversationText(messages);
          const leadInput = {
            nome: conversation.displayLabel,
            telefone: conversation.canonicalPhone,
            pedidoTexto,
            source: 'whatsapp',
            sourceDetail: conversation.remoteJid,
            externalId: conversation.id,
            status: missingFieldsForPreQuote({
              nome: conversation.displayLabel,
              telefone: conversation.canonicalPhone,
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

        // Send a text message to the customer and record it as outbound
        if (action === 'send-message') {
          const id = String(body.id || '');
          const text = cleanText(body.text);
          if (!text) {
            return jsonResponse(400, { error: 'Texto da mensagem é obrigatório.' });
          }
          const conversation = await getWhatsappConversation(id, deps);
          if (!conversation.canonicalPhone && conversation.identityStatus !== 'unresolved') {
            return jsonResponse(400, { error: 'Conversa sem telefone para envio.' });
          }

          // Use canonicalPhone for sending, fall back to provider resolution
          const targetPhone = conversation.canonicalPhone || conversation.phone;
          if (!targetPhone) {
            return jsonResponse(400, { error: 'Conversa sem telefone para envio.' });
          }
          const sender = deps?.sendTextMessage || sendText;
          await sender(targetPhone, text);
          const stored = await upsertWhatsappMessages(
            id,
            [
              {
                providerMessageId: `out-${Date.now()}`,
                direction: 'outbound',
                type: 'text',
                body: text,
                timestamp: Date.now(),
              },
            ],
            deps
          );
          return jsonResponse(201, { success: true, data: stored });
        }

        return jsonResponse(400, {
          error:
            'Ação não reconhecida. Use action: sync, sync-messages, send-message, extract-quote, ou create-quote-lead.',
        });
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

async function guardedHandler(event: FunctionEvent): Promise<FunctionResult> {
  if (isOperationalMode()) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'whatsapp-conversations não está disponível no modo operacional.' }) };
  }
  return createHandler()(event);
}
export const handler: LegacyHandler = guardedHandler;
