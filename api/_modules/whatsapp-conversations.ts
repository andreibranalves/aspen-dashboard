// GET/POST/PATCH /api/whatsapp-conversations - local WhatsApp commercial inbox
import type {
  FunctionEvent,
  FunctionResult,
  JsonResponseFn,
  LegacyHandler,
} from '../_http/types.js';
import { createHttpError } from '../_shared/http-error.js';
import { handler as extractHandler } from './extract.js';
import { sendText } from './send-whatsapp.js';
import { createPostgresQuoteLeadRepository } from '../_infrastructure/db/repositories/quote-leads-repository.js';
import {
  beginWhatsappConversationAdmission,
  cleanText,
  completeWhatsappConversationAdmission,
  getWhatsappConversation,
  getWhatsappMessages,
  linkWhatsappConversationAdmission,
  listWhatsappConversations,
  LIVE_DEPS,
  normalizeWhatsappPhone,
  projectWhatsappConversation,
  projectWhatsappMessage,
  updateWhatsappConversation,
  upsertWhatsappMessages,
  type WhatsappConversation,
  type WhatsappConversationStatus,
  type WhatsappPublicMessage,
} from './whatsapp-conversations-store.js';
import type { LocalQuoteLeadRecord } from './whatsapp-crm-match.js';
import {
  resolveWhatsappCrmMatch,
  validateWhatsappConversationLinks,
  type ResolveCrmMatchDeps,
} from './whatsapp-crm-match.js';
import {
  syncMessagesForConversation,
  syncWhatsappConversations,
  type EvolutionSyncDeps,
} from './whatsapp-conversations-sync.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      throw new Error('payload');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
}

function parseStatus(value: unknown): WhatsappConversationStatus | 'all' {
  const allowed: Array<WhatsappConversationStatus | 'all'> = [
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

function parsePatchStatus(value: unknown): WhatsappConversationStatus {
  const status = parseStatus(value);
  if (status === 'all') throw createHttpError(400, 'Status inválido.');
  return status;
}

function parseLimit(value: unknown): number {
  const limit = Number(value || 50);
  return Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
}

function own(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface WhatsappActionDeps extends EvolutionSyncDeps, ResolveCrmMatchDeps {
  extractOrders?: (text: string) => Promise<unknown[]>;
  upsertQuoteLead?: (input: Record<string, unknown>) => Promise<unknown>;
  /**
   * Narrow admission finders backed directly by the quote lead repository.
   * They are deliberately NOT part of the CRM matcher contract: live
   * admission reads the repository by its exact identity key, never by a
   * conversation-wide external lookup that could straddle two demands.
   */
  findQuoteLeadByDemandId?: (
    demandId: string,
    source?: string
  ) => Promise<LocalQuoteLeadRecord | null>;
  findQuoteLeadByExternalIdWithoutDemand?: (
    externalId: string,
    source?: string
  ) => Promise<LocalQuoteLeadRecord | null>;
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
      // Keep the Portuguese fallback below.
    }
    throw createHttpError(code, String(errorBody.error || 'Erro ao extrair orçamento.'));
  }
  let responseBody: Record<string, unknown> = {};
  try {
    responseBody = JSON.parse(result.body || '{}');
  } catch {
    // Treat an invalid extractor response as an empty extraction.
  }
  return Array.isArray(responseBody.orders) ? responseBody.orders : [];
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

function buildCrmDeps(deps?: Partial<WhatsappActionDeps>): ResolveCrmMatchDeps {
  return {
    ...LIVE_DEPS,
    ...(deps || {}),
  };
}

function hasConversationLinks(conversation: WhatsappConversation): boolean {
  return Boolean(
    conversation.linkedLeadId || conversation.linkedDealId || conversation.linkedQuotationId ||
    conversation.linkedCrmEntityId
  );
}

function buildStoreDeps(deps?: WhatsappActionDeps): WhatsappActionDeps {
  // Injected seams must use their own read/write pair, never LIVE_DEPS CAS.
  const storeDeps = (deps ? { ...deps } : { ...LIVE_DEPS }) as WhatsappActionDeps;
  storeDeps.validateConversationMutation = async (_current, next) => {
    for (const conversation of next) {
      if (!hasConversationLinks(conversation)) continue;
      await validateWhatsappConversationLinks({
        patch: {
          linkedLeadId: conversation.linkedLeadId || null,
          linkedDealId: conversation.linkedDealId || null,
          linkedQuotationId: conversation.linkedQuotationId || null,
        },
        deps: buildCrmDeps(deps),
      });
    }
  };
  return storeDeps;
}

function publicConversation(conversation: WhatsappConversation): Record<string, unknown> {
  return (projectWhatsappConversation(conversation) as unknown as Record<string, unknown>) || {
    id: conversation.id,
    canonicalPhone: '',
    phone: '',
    displayLabel: '',
    displayName: '',
    identityStatus: 'unresolved',
    lastMessageAt: '',
    lastMessagePreview: '',
    linkedLeadId: null,
    linkedDealId: null,
    linkedQuotationId: null,
    status: 'new',
    createdAt: '',
    updatedAt: '',
  };
}

function publicMessage(message: unknown): WhatsappPublicMessage {
  return projectWhatsappMessage(message) || {
    id: '',
    conversationId: '',
    direction: 'inbound',
    type: 'unknown',
    body: '',
    mediaUrl: '',
    timestamp: '',
  };
}

function publicQuoteLead(value: unknown): Record<string, unknown> {
  const record = isRecord(value) ? value : {};
  return {
    id: cleanText(record.id),
    nome: cleanText(record.nome),
    telefone: cleanText(record.telefone),
    email: cleanText(record.email),
    pedidoTexto: cleanText(record.pedidoTexto),
    source: cleanText(record.source),
    status: cleanText(record.status),
    quotationId: cleanText(record.quotationId) || null,
    createdAt: cleanText(record.createdAt),
    updatedAt: cleanText(record.updatedAt),
  };
}

function requireConversationId(value: unknown): string {
  const id = cleanText(value);
  if (!id) throw createHttpError(400, 'Identificador da conversa é obrigatório.');
  return id;
}

function ensureSendablePhone(conversation: WhatsappConversation): string {
  if (conversation.identityStatus !== 'verified' && conversation.identityStatus !== 'derived') {
    throw createHttpError(400, 'Não é possível enviar com a identidade do contato não confirmada.');
  }
  const phone = normalizeWhatsappPhone(conversation.canonicalPhone);
  if (!phone || phone !== conversation.canonicalPhone) {
    throw createHttpError(400, 'Conversa sem telefone canônico para envio.');
  }
  return phone;
}

const MAX_DEMAND_ID_LENGTH = 255;

function parseDemandId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const demandId = cleanText(value);
  if (!demandId) return null;
  if (demandId.length > MAX_DEMAND_ID_LENGTH) {
    throw createHttpError(400, 'Identificador de demanda do pré-orçamento inválido.');
  }
  return demandId;
}

/**
 * Resolves the exact admission being retried. An explicit demand id is the
 * admitted demand; without it, the original ingestion identity is the external
 * key with a null demand. The generic conversation-wide external lookup is NOT
 * used here: after a second demand shares the same conversation, it would find
 * two rows and fail. Returns null when this is a new admission.
 */
async function findAdmittedWhatsappLead(
  conversationId: string,
  demandId: string | null,
  deps: WhatsappActionDeps
): Promise<Record<string, unknown> | null> {
  const isAdmission = (value: unknown): value is LocalQuoteLeadRecord => {
    if (!isRecord(value) || cleanText(value.source) !== 'whatsapp') return false;
    if (!demandId) return cleanText(value.externalId) === conversationId;
    // A demand id is a durable identity: it stays bound to the conversation
    // that first admitted it. The same id arriving from another conversation is
    // a conflicting reuse, never a retry, and must not link this contact to
    // another lead/opportunity.
    const boundConversation = cleanText(value.externalId);
    if (boundConversation && boundConversation !== conversationId) {
      throw createHttpError(409, 'Esta demanda já está vinculada a outra conversa.');
    }
    return true;
  };
  try {
    let value: unknown;
    if (demandId) {
      const finder = deps.findQuoteLeadByDemandId;
      value = finder
        ? await finder(demandId, 'whatsapp')
        : await createPostgresQuoteLeadRepository().findByDemandId(demandId, 'whatsapp');
    } else {
      const finder = deps.findQuoteLeadByExternalIdWithoutDemand;
      value = finder
        ? await finder(conversationId, 'whatsapp')
        : await createPostgresQuoteLeadRepository().findByExternalIdWithoutDemand(
            conversationId,
            'whatsapp'
          );
    }
    return isAdmission(value) ? (value as unknown as Record<string, unknown>) : null;
  } catch (error) {
    const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0);
    if (statusCode >= 400 && statusCode < 500) throw error;
    if (statusCode === 503) throw error;
    throw createHttpError(503, 'Não foi possível acessar os leads locais.');
  }
}

export function createHandler(deps?: WhatsappActionDeps): LegacyHandler {
  const storeDeps = buildStoreDeps(deps);
  return async function whatsappConversationsHandler(
    event: FunctionEvent
  ): Promise<FunctionResult> {
    try {
      const method = String(event.httpMethod || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') {
        return jsonResponse(405, { error: 'Método não permitido.' });
      }
      const qs = event.queryStringParameters || {};
      const body = method !== 'GET' ? parseJsonBody(event.body) : {};

      if (method === 'GET') {
        if (qs.id) {
          const conversation = await getWhatsappConversation(qs.id, storeDeps);
          const crmMatch = await resolveWhatsappCrmMatch({
            conversation,
            deps: buildCrmDeps(storeDeps),
          });
          return jsonResponse(200, {
            success: true,
            data: { ...publicConversation(conversation), crmMatch },
          });
        }
        if (qs.messages) {
          const data = await getWhatsappMessages(qs.messages, storeDeps);
          return jsonResponse(200, { success: true, data: data.map(publicMessage) });
        }
        const data = await listWhatsappConversations(
          {
            status: parseStatus(qs.status),
            q: qs.q || '',
            hasQuoteRequest: qs.hasQuoteRequest,
            limit: parseLimit(qs.limit),
          },
          storeDeps
        );
        return jsonResponse(200, {
          success: true,
          data: data.map(publicConversation),
        });
      }

      if (method === 'POST') {
        const action = cleanText(body.action);
        if (action === 'sync') {
          const data = await syncWhatsappConversations(
            {
              chatLimit: parseLimit(body.chatLimit || 5),
              messageLimit: parseLimit(body.messageLimit || 100),
            },
            storeDeps
          );
          return jsonResponse(200, {
            success: true,
            data: {
              conversations: data.conversations.map(publicConversation),
              syncedMessages: data.syncedMessages,
            },
          });
        }

        if (action === 'sync-messages') {
          const id = requireConversationId(body.id);
          const conversation = await getWhatsappConversation(id, storeDeps);
          await syncMessagesForConversation(conversation, 100, storeDeps);
          const messages = await getWhatsappMessages(id, storeDeps);
          return jsonResponse(200, { success: true, data: messages.map(publicMessage) });
        }

        if (action === 'extract-quote') {
          const id = requireConversationId(body.id);
          const conversation = await getWhatsappConversation(id, storeDeps);
          const messages = await getWhatsappMessages(id, storeDeps);
          const orders = await (deps?.extractOrders || liveExtractOrders)(buildConversationText(messages));
          return jsonResponse(200, {
            success: true,
            data: {
              conversationId: conversation.id,
              inputMessageIds: messages.map((message) => message.id),
              extractedPayload: { orders },
              confidence: orders.length > 0 ? 0.8 : 0.2,
              missingFields: orders.length > 0 ? [] : ['pedido'],
              createdAt: new Date().toISOString(),
            },
          });
        }

        if (action === 'create-quote-lead') {
          const id = requireConversationId(body.id);
          const conversation = await getWhatsappConversation(id, storeDeps);
          if (conversation.identityStatus === 'unresolved' || conversation.identityStatus === 'conflict') {
            throw createHttpError(400, 'Não é possível criar pré-orçamento com identidade do contato não confirmada.');
          }

          const demandId = parseDemandId(body.demandId);
          // The admitted demand is the durable source of truth. If a prior
          // request saved the lead but lost the KV link, retry only completes
          // that link and never creates another business identity.
          const existing = await findAdmittedWhatsappLead(id, demandId, storeDeps);
          if (existing) {
            const existingLeadId = cleanText(existing.id);
            if (!UUID_PATTERN.test(existingLeadId)) {
              throw createHttpError(503, 'Pré-orçamento local sem identificador válido.');
            }
            const existingDealId = cleanText(existing.crmDealId);
            const linked = await linkWhatsappConversationAdmission(
              id,
              {
                linkedLeadId: existingLeadId,
                linkedDealId: UUID_PATTERN.test(existingDealId) ? existingDealId : null,
              },
              storeDeps
            );
            return jsonResponse(200, { success: true, data: publicQuoteLead(existing), conversation: publicConversation(linked) });
          }

          // A new admission reserves a monotonic sequence before writing
          // anything. Completion only applies when no newer admission has
          // already saved a selection, so a stale in-flight admission cannot
          // overwrite a demand admitted later in the same conversation.
          const admissionSequence = await beginWhatsappConversationAdmission(id, storeDeps);

          const messages = await getWhatsappMessages(id, storeDeps);
          const pedidoTexto = buildConversationText(messages);
          const missingFields = missingFieldsForPreQuote({
            nome: conversation.displayLabel,
            telefone: conversation.canonicalPhone,
            pedidoTexto,
          });
          const leadInput = {
            nome: conversation.displayLabel,
            telefone: conversation.canonicalPhone,
            pedidoTexto,
            source: 'whatsapp',
            status: missingFields.length ? 'incomplete' : 'ready',
            externalId: id,
            ...(demandId ? { demandId } : {}),
          };
          let data: unknown;
          try {
            const createLead = deps?.upsertQuoteLead || createPostgresQuoteLeadRepository().upsert;
            data = await createLead(leadInput);
          } catch (error) {
            const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0);
            if (statusCode >= 400 && statusCode < 500) throw error;
            if (statusCode === 503) throw error;
            throw createHttpError(503, 'Não foi possível salvar o pré-orçamento local.');
          }
          const dataRecord = isRecord(data) ? data : {};
          const leadId = cleanText(dataRecord.id);
          if (!UUID_PATTERN.test(leadId)) throw createHttpError(503, 'Pré-orçamento local sem identificador válido.');
          const dealId = cleanText(dataRecord.crmDealId);
          const linked = await completeWhatsappConversationAdmission(
            id,
            admissionSequence,
            {
              linkedLeadId: leadId,
              linkedDealId: UUID_PATTERN.test(dealId) ? dealId : null,
            },
            storeDeps
          );
          return jsonResponse(201, {
            success: true,
            data: publicQuoteLead(data),
            conversation: publicConversation(linked),
          });
        }

        if (action === 'send-message') {
          const id = requireConversationId(body.id);
          const text = cleanText(body.text);
          if (!text) throw createHttpError(400, 'Texto da mensagem é obrigatório.');
          const conversation = await getWhatsappConversation(id, storeDeps);
          const targetPhone = ensureSendablePhone(conversation);
          const sender = deps?.sendTextMessage || sendText;
          const delivery: unknown = await sender(targetPhone, text);
          const deliveryRecord = delivery && typeof delivery === 'object' ? (delivery as Record<string, unknown>) : {};
          const providerMessageId =
            cleanText(deliveryRecord.providerMessageId || deliveryRecord.messageId || deliveryRecord.id) ||
            `out-${Date.now()}-${deps?.id?.() || Math.random().toString(36).slice(2)}`;
          const stored = await upsertWhatsappMessages(
            id,
            [{
              providerMessageId,
              direction: 'outbound',
              type: 'text',
              body: text,
              timestamp: Date.now(),
            }],
            storeDeps
          );
          return jsonResponse(201, { success: true, data: stored.map(publicMessage) });
        }

        return jsonResponse(400, {
          error: 'Ação não reconhecida. Use action: sync, sync-messages, send-message, extract-quote, ou create-quote-lead.',
        });
      }

      const id = requireConversationId(body.id);
      await getWhatsappConversation(id, storeDeps);
      const patch: Partial<WhatsappConversation> = {};
      if (own(body, 'status')) patch.status = parsePatchStatus(body.status);
      if (own(body, 'linkedLeadId')) patch.linkedLeadId = body.linkedLeadId == null ? null : cleanText(body.linkedLeadId);
      if (own(body, 'linkedDealId')) patch.linkedDealId = body.linkedDealId == null ? null : cleanText(body.linkedDealId);
      if (own(body, 'linkedQuotationId')) patch.linkedQuotationId = body.linkedQuotationId == null ? null : cleanText(body.linkedQuotationId);
      // updateWhatsappConversation validates against the latest CAS snapshot;
      // omitted links are deliberately absent from this sparse patch.
      const data = await updateWhatsappConversation(id, patch, storeDeps);
      return jsonResponse(200, { success: true, data: publicConversation(data) });
    } catch (error: unknown) {
      const record = isRecord(error) ? error : {};
      const statusCode = Number.isInteger(record.statusCode) ? Number(record.statusCode) : 500;
      console.error(
        '[whatsapp-conversations]',
        error instanceof Error ? error.name : typeof error,
        statusCode,
      );
      return jsonResponse(statusCode, {
        error: String(record.message || 'Erro interno ao buscar conversas do WhatsApp.'),
      });
    }
  };
}

export const handler: LegacyHandler = createHandler();
