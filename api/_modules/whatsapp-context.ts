import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_http/types.js';
import {
  createPostgresWhatsappCrmRepository,
  type LocalClientRecord,
  type LocalCrmCandidate,
  type LocalQuoteLeadRecord,
  type LocalWhatsappCrmRepository,
} from './whatsapp-crm-match.js';
import { parseContactPhone, brazilMobileAlternative, conversationId } from '../_shared/contact-phone.js';
import { createWhatsappClientLinksRepository, LinkConflict, type WhatsappClientLinksRepository } from '../_infrastructure/db/repositories/whatsapp-client-links.js';
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
  links?: WhatsappClientLinksRepository;
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
    if (!['GET', 'PUT', 'DELETE'].includes(event.httpMethod)) return json(405, { error: 'Método não permitido.' }, cors);
    if (!configuredOrigin && origin) return json(503, { error: 'Extensão Aspen não configurada.' }, cors);
    const query = event.queryStringParameters || {};
    const phone = parseContactPhone(query.phone?.startsWith('+') ? query.phone : query.phone ? '+' + query.phone : '');
    const technicalId = conversationId(query.conversationId);
    const accountId = conversationId(query.accountId);
    const scope = technicalId && accountId ? { accountId, conversationId: technicalId } : null;
    const linkRepository = dependencies.links || (scope ? createWhatsappClientLinksRepository() : null);
    const search = text(query.search);
    const phoneSource = text(query.phoneSource);
    if (query.conversationId && !technicalId || query.accountId && !accountId || query.phone && !phone) {
      return json(400, { error: 'Identidade da conversa inválida.' }, cors);
    }
    const jidPhone = technicalId.endsWith('@s.whatsapp.net') ? parseContactPhone('+' + technicalId.split('@')[0]) : '';
    const evidenceConflict = Boolean(phone && jidPhone && phone !== jidPhone && brazilMobileAlternative(phone) !== jidPhone);
    const observedPhone = phone || jidPhone;
    const trustedPhoneEvidence = Boolean(jidPhone || phoneSource === 'active-model' && scope && phone);
    try {
      if (event.httpMethod !== 'GET') {
        if (!scope || !linkRepository || evidenceConflict) return json(409, { error: 'Confirme a conta e a conversa antes de vincular.' }, cors);
        let input;
        try { input = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Dados inválidos.' }, cors); }
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!input || typeof input !== 'object' || Array.isArray(input) || !(input.expectedVersion === null || typeof input.expectedVersion === 'string' && uuid.test(input.expectedVersion))) return json(400, { error: 'Versão do vínculo inválida.' }, cors);
        if (event.httpMethod === 'DELETE') {
          if (!input.expectedVersion) return json(400, { error: 'Versão do vínculo obrigatória.' }, cors);
          await linkRepository.remove(scope, input.expectedVersion);
        } else {
          if (typeof input.clientId !== 'string' || !uuid.test(input.clientId) || typeof input.expectedClientName !== 'string' || !(input.expectedClientPhone === null || typeof input.expectedClientPhone === 'string')) return json(400, { error: 'Cliente inválido.' }, cors);
          await linkRepository.save(scope, { clientId: input.clientId, observedPhone: observedPhone || null, expectedVersion: input.expectedVersion, expectedClientPhone: input.expectedClientPhone, expectedClientName: input.expectedClientName });
        }
        return json(200, { ok: true }, cors);
      }
      const link = scope && linkRepository ? await linkRepository.get(scope) : null;
      const linking = { available: Boolean(scope), version: link?.version || null };
      if (evidenceConflict) return json(200, { match: 'conflict', reason: 'Os identificadores da conversa apontam para telefones diferentes.', linking: { ...linking, available: false }, candidates: [] }, cors);
      if (search) {
        if (!scope || !linkRepository || search.length < 2 || search.length > 100) return json(400, { error: 'Informe de 2 a 100 caracteres para pesquisar.' }, cors);
        return json(200, { match: 'suggested', candidates: (await linkRepository.search(search)).map(client => ({ ...client, tipo: 'cliente' })), linking, reason: 'Selecione o cadastro desta conversa.' }, cors);
      }
      if (link) {
        const client = await (dependencies.getClient || getCrm().getClient)(link.clientId);
        const currentPhone = parseContactPhone(client?.telefone) || null;
        const changedEvidence = observedPhone && observedPhone !== link.observedPhone;
        if (!client || client.arquivado || currentPhone !== link.clientPhone || changedEvidence) {
          return json(200, { match: 'conflict', reason: 'Os dados mudaram desde a confirmação. Revise o vínculo.', linking, candidates: [] }, cors);
        }
        const result = await contextForCandidate({ ...client, tipo: 'cliente' }, { ...dependencies, crm, getClient: async () => client });
        return json(200, { ...result, linking, matchSource: 'operator' }, cors);
      }
      if (!observedPhone) return json(200, { match: 'unresolved', reason: 'Telefone não disponível. Pesquise e vincule o cliente.', linking, candidates: [] }, cors);
      const findCandidatesByPhone = dependencies.findCandidatesByPhone || getCrm().findCandidatesByPhone;
      if (!findCandidatesByPhone) return json(503, { error: 'Contexto comercial indisponível.' }, cors);
      const projectCurrentCandidate = async (selected: LocalCrmCandidate, expectedPhone: string) => {
        let projectionDependencies = { ...dependencies, crm };
        if (selected.tipo === 'cliente') {
          const client = await (dependencies.getClient || getCrm().getClient)(selected.id);
          if (!client || client.arquivado || parseContactPhone(client.telefone) !== expectedPhone) return null;
          projectionDependencies = { ...projectionDependencies, getClient: async () => client };
        } else {
          const lead = await (dependencies.getQuoteLead || getCrm().getQuoteLead)(selected.id);
          if (!lead || lead.status === 'discarded' || parseContactPhone(lead.telefone) !== expectedPhone) return null;
          projectionDependencies = { ...projectionDependencies, getQuoteLead: async () => lead };
        }
        return contextForCandidate(selected, projectionDependencies);
      };
      const candidates = uniqueCandidates(await findCandidatesByPhone(observedPhone, 20)).filter(candidate => parseContactPhone(candidate.telefone) === observedPhone);
      if (candidates.length === 0) {
        const alternative = brazilMobileAlternative(observedPhone);
        const suggested = alternative ? uniqueCandidates(await findCandidatesByPhone(alternative, 20)).filter(candidate => candidate.tipo === 'cliente' && parseContactPhone(candidate.telefone) === alternative) : [];
        if (suggested.length > 1) return json(200, { match: 'ambiguous', reason: 'Mais de um cadastro corresponde à variação do telefone.', contact: null, candidates: suggested, linking, actions: { search: createContactUrl(observedPhone) } }, cors);
        if (suggested.length === 1 && trustedPhoneEvidence && alternative) {
          const result = await projectCurrentCandidate(suggested[0], alternative);
          if (!result) return json(200, { match: 'conflict', reason: 'O cadastro mudou durante a consulta. Pesquise novamente.', candidates: [], linking }, cors);
          return json(200, { ...result, linking, matchSource: 'phone-variant' }, cors);
        }
        if (suggested.length) return json(200, { match: 'suggested', reason: 'Possível correspondência: diferença no nono dígito.', candidates: suggested, linking }, cors);
        return json(200, { match: 'not_found', contact: null, linking, actions: { createContact: createContactUrl(observedPhone) } }, cors);
      }
      if (candidates.length > 1) {
        return json(200, { match: 'ambiguous', contact: null, candidates, linking, actions: { search: createContactUrl(observedPhone) } }, cors);
      }
      if (!trustedPhoneEvidence) return json(200, { match: 'suggested', reason: 'Confirme o cliente indicado pelo telefone exibido nesta conversa.', candidates, linking }, cors);
      const selected = candidates[0];
      const result = await projectCurrentCandidate(selected, observedPhone);
      if (!result) return json(200, { match: 'conflict', reason: 'O cadastro mudou durante a consulta. Pesquise novamente.', candidates: [], linking }, cors);
      return json(200, { ...result, linking, matchSource: 'phone' }, cors);
    } catch (error) {
      if (error instanceof LinkConflict) return json(409, { error: 'O vínculo ou o cliente mudou. Atualize o painel e tente novamente.' }, cors);
      console.error('[whatsapp-context]', error instanceof Error ? error.name : typeof error);
      return json(503, { error: 'Não foi possível consultar o contexto comercial.' }, cors);
    }
  };
}

export const handler = createWhatsappContextHandler();
