import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createPostgresWhatsappAttendanceRepository, type WhatsappAttendanceRepository } from '../_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import { createPostgresQuoteLeadRepository, type QuoteLeadRecord, type QuoteLeadRepository } from '../_infrastructure/db/repositories/quote-leads-repository.js';
import { createWhatsappClientLinksRepository } from '../_infrastructure/db/repositories/whatsapp-client-links.js';
import { readConnectedAccountId } from '../_infrastructure/integrations/evolution/account.js';
import { getEvolutionConfig } from '../_infrastructure/integrations/evolution/config.js';
import { conversationId as technicalConversationId } from '../_shared/contact-phone.js';
import { safeErrorSummary } from '../_shared/safe-error.js';
import { ORDER_MAX_CHARS } from './atendimento-contact.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Attendance = Pick<WhatsappAttendanceRepository, 'getConversation' | 'getConversationScope'>;
type Leads = Pick<QuoteLeadRepository, 'findByDemandId' | 'admitWhatsappDraft'>;

export interface QuoteDraftDependencies {
  attendance?: Attendance;
  leads?: Leads;
  linkedClientId?: (conversationId: string) => Promise<string | null>;
}

class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function json(statusCode: number, body: unknown): FunctionResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new InputError(`${label} inválido.`);
  return value.toLowerCase();
}

function contactText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.trim().length > max) throw new InputError(`${label} inválido.`);
  return value.replace(/\s+/g, ' ').trim();
}

// The client's order keeps its line breaks.
function orderText(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : null;
  if (text === null || text.length > ORDER_MAX_CHARS) throw new InputError('Pedido inválido.');
  return text;
}

// Demands prepared before the contact extraction also recorded the selected message IDs.
function selection(lead: QuoteLeadRecord): { text: string } | null {
  const value = lead.raw?.atendimentoDraft;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  return typeof draft.text === 'string' ? { text: draft.text } : null;
}

async function liveLinkedClientId(conversationId: string, attendance: Attendance): Promise<string | null> {
  try {
    const scope = await attendance.getConversationScope(conversationId);
    if (!scope || scope.identityStatus === 'conflict' || scope.instance !== getEvolutionConfig().instance) return null;
    const accountId = await readConnectedAccountId();
    const technicalId = technicalConversationId(scope.providerConversationId);
    if (!accountId || !technicalId) return null;
    const link = await createWhatsappClientLinksRepository().get({ accountId, conversationId: technicalId });
    return link?.clientId || null;
  } catch {
    // A temporary account lookup failure cannot erase the recorded demand.
    // Client identity is rechecked by /api/orcamento before anything is saved.
    return null;
  }
}

export function createAtendimentoQuoteDraftHandler(dependencies: QuoteDraftDependencies = {}) {
  const attendance = dependencies.attendance || createPostgresWhatsappAttendanceRepository();
  const leads = dependencies.leads || createPostgresQuoteLeadRepository();
  const linkedClientId = dependencies.linkedClientId || ((id: string) => liveLinkedClientId(id, attendance));

  async function project(lead: QuoteLeadRecord) {
    const draft = selection(lead);
    if (!draft) throw new InputError('Demanda sem seleção registrada.', 409);
    const conversation = lead.externalId ? await attendance.getConversation(lead.externalId) : null;
    if (!conversation) throw new InputError('Conversa não encontrada.', 404);
    return {
      demandId: lead.demandId,
      quoteLeadId: lead.id,
      crmDealId: lead.crmDealId,
      conversationId: conversation.id,
      text: draft.text,
      clientId: await linkedClientId(conversation.id),
      phone: lead.telefone || conversation.canonicalPhone,
      name: lead.nome || conversation.displayName,
      email: lead.email || null,
      destination: `/#/novo-orcamento?demandId=${encodeURIComponent(lead.demandId || '')}&quoteLeadId=${encodeURIComponent(lead.id)}&crmDealId=${encodeURIComponent(lead.crmDealId || '')}`,
    };
  }

  return async function handler(event: FunctionEvent): Promise<FunctionResult> {
    const method = String(event.httpMethod || '').toUpperCase();
    if (method !== 'GET' && method !== 'POST') return json(405, { error: 'Método não permitido.' });
    try {
      if (method === 'GET') {
        const demandId = uuid(event.queryStringParameters?.demandId, 'Demanda');
        const lead = await leads.findByDemandId(demandId, 'whatsapp');
        return lead ? json(200, await project(lead)) : json(404, { error: 'Demanda não encontrada.' });
      }
      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(event.body || '');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body');
        body = parsed as Record<string, unknown>;
      } catch { throw new InputError('Corpo da requisição inválido.'); }
      const conversationId = uuid(body.conversationId, 'Conversa');
      const demandId = uuid(body.demandId, 'Demanda');
      const existing = await leads.findByDemandId(demandId, 'whatsapp');
      if (existing) {
        if (existing.externalId !== conversationId) throw new InputError('Esta demanda já está vinculada a outra conversa.', 409);
        return json(200, await project(existing));
      }
      const contact = body.contact && typeof body.contact === 'object' && !Array.isArray(body.contact) ? body.contact as Record<string, unknown> : {};
      const nome = contactText(contact.name, 'Nome', 255);
      const empresa = contactText(contact.company, 'Empresa', 255);
      const email = contactText(contact.email, 'E-mail', 320).toLowerCase();
      if (email && !EMAIL.test(email)) throw new InputError('E-mail inválido.');
      const pedido = orderText(contact.order);
      const conversation = await attendance.getConversation(conversationId);
      if (!conversation) return json(404, { error: 'Conversa não encontrada.' });
      const telefone = conversation.identityStatus === 'conflict' ? '' : conversation.canonicalPhone || '';
      // Same header the quote screen writes for a known client, then the client's own order messages.
      const header = [`Nome: ${nome}`, ...(empresa ? [`Empresa: ${empresa}`] : []), `E-mail: ${email}`, `Telefone: ${telefone}`].join('\n');
      const text = pedido ? `${header}\n\nPedido:\n${pedido}` : header;
      const lead = await leads.admitWhatsappDraft({
        source: 'whatsapp', externalId: conversationId, demandId,
        nome, empresa, email, telefone, ...(pedido ? { pedidoTexto: pedido } : {}), raw: { atendimentoDraft: { text } },
      });
      return json(201, await project(lead));
    } catch (error) {
      if (error instanceof InputError) return json(error.status, { error: error.message });
      if ((error as { statusCode?: number }).statusCode === 409) return json(409, { error: 'Esta demanda já está vinculada a outra conversa.' });
      console.error('[atendimento-quote-draft]', safeErrorSummary(error));
      return json(503, { error: 'Não foi possível preparar a demanda. Tente novamente.' });
    }
  };
}

export const atendimentoQuoteDraft = createAtendimentoQuoteDraftHandler();
