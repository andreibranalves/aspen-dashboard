import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_http/types.js';
import {
  createPostgresWhatsappCrmRepository,
  type LocalClientRecord,
  type LocalCrmCandidate,
  type LocalQuoteLeadRecord,
  type LocalWhatsappCrmRepository,
} from './whatsapp-crm-match.js';
import { normalizeWhatsappPhone } from './whatsapp-conversations-store.js';
import {
  configuredWhatsappContextOrigin,
  requestOrigin,
  whatsappContextCorsHeaders,
} from '../_shared/whatsapp-context-cors.js';

export const WHATSAPP_CONTEXT_QUOTATION_LIMIT = 6;
export const WHATSAPP_CONTEXT_DELIVERY_LIMIT = 12;

export interface WhatsappContextContact {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
}

export interface WhatsappContextQuotation {
  id: string;
  businessNumber: string;
  status: string;
  date: string;
  total: string;
  url: string;
}

export interface WhatsappContextDelivery {
  id: string;
  revisionId: string;
  businessNumber: string;
  status: 'pendente' | 'enviado' | 'entregue' | 'falhou' | 'sem entrega registrada';
  date: string;
}

export type WhatsappContextProjection =
  | { match: 'unresolved'; reason: string }
  | { match: 'not_found'; contact: null; actions: { createContact: string } }
  | { match: 'ambiguous'; contact: null; actions: { search: string } }
  | {
      match: 'matched';
      contact: WhatsappContextContact;
      latestQuotation: WhatsappContextQuotation | null;
      quotations: WhatsappContextQuotation[];
      deliveries: WhatsappContextDelivery[];
      actions: { openContact: string; createContact: string };
    };

export interface WhatsappContextHistoryRepository {
  listQuotationsByClientId?: (
    clientId: string,
    limit: number,
  ) => Promise<WhatsappContextQuotation[]>;
  listDeliveriesByQuotationIds?: (
    quotationIds: string[],
    limit: number,
  ) => Promise<WhatsappContextDelivery[]>;
}

export interface WhatsappContextHandlerDependencies {
  crm?: LocalWhatsappCrmRepository;
  findCandidatesByPhone?: (phone: string, limit: number) => Promise<LocalCrmCandidate[]>;
  getQuoteLead?: (id: string) => Promise<LocalQuoteLeadRecord | null>;
  getClient?: (id: string) => Promise<LocalClientRecord | null>;
  getDeal?: LocalWhatsappCrmRepository['getDeal'];
  getQuotation?: LocalWhatsappCrmRepository['getQuotation'];
  history?: WhatsappContextHistoryRepository;
  env?: typeof process.env;
}

function json(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    body: JSON.stringify(body),
  };
}

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function contactUrl(contact: Pick<WhatsappContextContact, 'id' | 'tipo'>): string {
  return `/#/leads/${contact.tipo}/${encodeURIComponent(contact.id)}`;
}

function createContactUrl(phone: string | null | undefined): string {
  const normalized = text(phone);
  return normalized ? `/#/leads?search=${encodeURIComponent(normalized)}` : '/#/leads';
}

function candidateKey(candidate: LocalCrmCandidate): string {
  return `${candidate.tipo}:${candidate.id}`;
}

function uniqueCandidates(candidates: LocalCrmCandidate[]): LocalCrmCandidate[] {
  const result = new Map<string, LocalCrmCandidate>();
  for (const candidate of candidates) {
    if (!candidate || !text(candidate.id)) continue;
    result.set(candidateKey(candidate), candidate);
  }
  return [...result.values()].sort((left, right) => candidateKey(left).localeCompare(candidateKey(right)));
}

function mapContact(
  candidate: LocalCrmCandidate,
  lead: LocalQuoteLeadRecord | null,
  client: LocalClientRecord | null,
): WhatsappContextContact {
  return {
    id: candidate.id,
    tipo: candidate.tipo,
    nome: text(lead?.nome || client?.nome || candidate.nome) || 'Contato sem nome',
    telefone: text(lead?.telefone || client?.telefone || candidate.telefone) || null,
    email: text(lead?.email || client?.email || candidate.email) || null,
  };
}

async function resolveContact(
  candidate: LocalCrmCandidate,
  dependencies: WhatsappContextHandlerDependencies,
): Promise<{ contact: WhatsappContextContact; clientId: string | null }> {
  const crm = dependencies.crm;
  const getLead = dependencies.getQuoteLead || crm?.getQuoteLead;
  const getClient = dependencies.getClient || crm?.getClient;
  const getDeal = dependencies.getDeal || crm?.getDeal;
  const getQuotation = dependencies.getQuotation || crm?.getQuotation;
  const lead = candidate.tipo === 'lead' && getLead ? await getLead(candidate.id) : null;
  const deal = candidate.dealId && getDeal ? await getDeal(candidate.dealId) : null;
  const clientId = candidate.tipo === 'cliente'
    ? candidate.id
    : deal?.clientId || null;
  const client = clientId && getClient ? await getClient(clientId) : null;
  if (candidate.tipo === 'lead' && !lead && getLead) throw new Error('lead not found');
  if (candidate.tipo === 'cliente' && !client && getClient) throw new Error('client not found');
  // A deal-backed lead can still point to a client; get the client only for the
  // history graph while preserving the lead as the displayed identity.
  if (!clientId && candidate.quotationId && getQuotation) {
    const quotation = await getQuotation(candidate.quotationId);
    return { contact: mapContact(candidate, lead, client), clientId: quotation?.clientId || null };
  }
  return { contact: mapContact(candidate, lead, client), clientId };
}

async function contextForCandidate(
  candidate: LocalCrmCandidate,
  dependencies: WhatsappContextHandlerDependencies,
): Promise<WhatsappContextProjection> {
  const { contact, clientId } = await resolveContact(candidate, dependencies);
  let quotationsProjection: WhatsappContextQuotation[] = [];
  let deliveries: WhatsappContextDelivery[] = [];
  const history = dependencies.history || dependencies.crm;
  if (clientId && history?.listQuotationsByClientId) {
    quotationsProjection = await history.listQuotationsByClientId(clientId, WHATSAPP_CONTEXT_QUOTATION_LIMIT);
    if (history.listDeliveriesByQuotationIds) {
      deliveries = await history.listDeliveriesByQuotationIds(
        quotationsProjection.map((quotation) => quotation.id),
        WHATSAPP_CONTEXT_DELIVERY_LIMIT,
      );
    }
  }
  const latestQuotation = quotationsProjection[0] || null;
  return {
    match: 'matched',
    contact,
    latestQuotation,
    quotations: quotationsProjection,
    deliveries,
    actions: {
      openContact: contactUrl(contact),
      createContact: createContactUrl(contact.telefone),
    },
  };
}

export function createWhatsappContextHandler(
  dependencies: WhatsappContextHandlerDependencies = {},
): LegacyHandler {
  const env = dependencies.env || process.env;
  const configuredOrigin = configuredWhatsappContextOrigin(env);
  let crm = dependencies.crm;
  const getCrm = () => {
    crm ||= createPostgresWhatsappCrmRepository();
    return crm;
  };
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    const origin = requestOrigin(event.headers || {});
    const cors = whatsappContextCorsHeaders(origin, env);
    if (origin && !cors['Access-Control-Allow-Origin']) {
      return json(403, { error: 'Origem da extensão não autorizada.' });
    }
    if (event.httpMethod === 'OPTIONS') {
      if (!configuredOrigin) return json(503, { error: 'Extensão Aspen não configurada.' });
      return { statusCode: 204, headers: cors, body: '' };
    }
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' }, cors);
    if (!configuredOrigin && origin) return json(503, { error: 'Extensão Aspen não configurada.' }, cors);
    const phone = normalizeWhatsappPhone(event.queryStringParameters?.phone);
    if (!phone) return json(400, { match: 'unresolved', reason: 'Telefone confirmado não informado.' }, cors);
    try {
      const findCandidatesByPhone = dependencies.findCandidatesByPhone || getCrm().findCandidatesByPhone;
      if (!findCandidatesByPhone) return json(503, { error: 'Contexto comercial indisponível.' }, cors);
      const candidates = uniqueCandidates(await findCandidatesByPhone(phone, 2));
      if (candidates.length === 0) {
        return json(200, { match: 'not_found', contact: null, actions: { createContact: createContactUrl(phone) } }, cors);
      }
      if (candidates.length > 1) {
        return json(200, { match: 'ambiguous', contact: null, actions: { search: createContactUrl(phone) } }, cors);
      }
      const result = await contextForCandidate(candidates[0], {
        ...dependencies,
        crm,
      });
      return json(200, result, cors);
    } catch (error) {
      console.error('[whatsapp-context]', error instanceof Error ? error.name : typeof error);
      return json(503, { error: 'Não foi possível consultar o contexto comercial.' }, cors);
    }
  };
}

export const handler = createWhatsappContextHandler();
