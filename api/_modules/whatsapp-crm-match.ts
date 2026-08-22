import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { createHttpError } from '../_shared/http-error.js';
import { getDatabase, type AppDatabase } from '../_infrastructure/db/client.js';
import { clients, crmDeals, quoteLeads, quoteRevisions, quotationDeliveries, quotations } from '../_infrastructure/db/schema.js';
import {
  cleanText,
  type WhatsappConversation,
  type WhatsappConversationStoreDeps,
} from './whatsapp-conversations-store.js';

export interface WhatsappCrmMatch {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
  matchSource: 'phone' | 'email' | 'name';
}

export interface LocalQuoteLeadRecord {
  id: string;
  nome: string | null;
  nomeAlternatives?: string[];
  telefone: string | null;
  email: string | null;
  status: string;
  source?: string;
  quotationId: string | null;
  crmDealId: string | null;
  externalId?: string | null;
}

export interface LocalClientRecord {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  arquivado: boolean;
}

export interface LocalDealRecord {
  id: string;
  quoteLeadId: string | null;
  clientId: string | null;
  quotationId: string | null;
  nome: string;
  telefone: string | null;
  email: string | null;
  status: string;
}

export interface LocalQuotationRecord {
  id: string;
  businessNumber: string;
  clientId: string;
  status: string;
  snapshot: {
    nome: string | null;
    telefone: string | null;
    email: string | null;
  } | null;
}

export interface LocalQuotationHistoryRecord {
  id: string;
  businessNumber: string;
  status: string;
  date: string;
  total: string;
  url: string;
}

export interface LocalDeliveryHistoryRecord {
  id: string;
  revisionId: string;
  businessNumber: string;
  status: 'pendente' | 'enviado' | 'entregue' | 'falhou' | 'sem entrega registrada';
  date: string;
}

export interface LocalCrmCandidate {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
  dealId?: string | null;
  quotationId?: string | null;
  nameAlternatives?: string[];
}

export interface LocalWhatsappCrmRepository {
  listQuoteLeads?: () => Promise<LocalQuoteLeadRecord[]>;
  listClients?: () => Promise<LocalClientRecord[]>;
  listDeals?: () => Promise<LocalDealRecord[]>;
  listQuotations?: () => Promise<LocalQuotationRecord[]>;
  getQuoteLead: (id: string) => Promise<LocalQuoteLeadRecord | null>;
  getClient: (id: string) => Promise<LocalClientRecord | null>;
  getDeal: (id: string) => Promise<LocalDealRecord | null>;
  getQuotation: (id: string) => Promise<LocalQuotationRecord | null>;
  listQuotationsByClientId?: (clientId: string, limit: number) => Promise<LocalQuotationHistoryRecord[]>;
  listDeliveriesByQuotationIds?: (quotationIds: string[], limit: number) => Promise<LocalDeliveryHistoryRecord[]>;
  findQuoteLeadByExternalId?: (
    externalId: string,
    source?: string
  ) => Promise<LocalQuoteLeadRecord | null>;
  findCandidatesByPhone?: (phone: string, limit: number) => Promise<LocalCrmCandidate[]>;
  findCandidatesByEmail?: (emails: string[], limit: number) => Promise<LocalCrmCandidate[]>;
  findCandidatesByName?: (name: string, limit: number) => Promise<LocalCrmCandidate[]>;
}

export interface ResolveCrmMatchDeps extends WhatsappConversationStoreDeps {
  localCrm?: LocalWhatsappCrmRepository;
  listQuoteLeads?: () => Promise<LocalQuoteLeadRecord[]>;
  listClients?: () => Promise<LocalClientRecord[]>;
  listDeals?: () => Promise<LocalDealRecord[]>;
  listQuotations?: () => Promise<LocalQuotationRecord[]>;
  getQuoteLead?: (id: string) => Promise<LocalQuoteLeadRecord | null>;
  getClient?: (id: string) => Promise<LocalClientRecord | null>;
  getDeal?: (id: string) => Promise<LocalDealRecord | null>;
  getQuotation?: (id: string) => Promise<LocalQuotationRecord | null>;
  findQuoteLeadByExternalId?: (
    externalId: string,
    source?: string
  ) => Promise<LocalQuoteLeadRecord | null>;
  findCandidatesByPhone?: (phone: string, limit: number) => Promise<LocalCrmCandidate[]>;
  findCandidatesByEmail?: (emails: string[], limit: number) => Promise<LocalCrmCandidate[]>;
  findCandidatesByName?: (name: string, limit: number) => Promise<LocalCrmCandidate[]>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISCARDED_LEAD_STATUS = 'discarded';
const LOST_DEAL_STATUS = 'Perdido';
const TARGET_LIMIT = 2;
const CRM_EMAIL_MAX_LENGTH = 254;
const CRM_EMAIL_SCAN_LIMIT = 6_000;
const CRM_EMAIL_PATTERN = /[A-Z0-9!#$%&'*+/?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/?^_`{|}~-]+)*@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)*\.[A-Z]{2,63}/gi;
/**
 * CRM name matching uses the same explicit ASCII/POSIX whitespace set in JS and SQL:
 * space, tab, LF, CR, form feed, and vertical tab.
 * NBSP is intentionally not whitespace and remains literal on both sides.
 */
const CRM_MATCH_WHITESPACE = /[ \t\n\r\f\v]+/g;
const CRM_MATCH_EDGE_WHITESPACE = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;
const CRM_MATCH_WHITESPACE_SQL_FROM = ' \t\n\r\f\v';
const CRM_MATCH_WHITESPACE_SQL_TO = '      ';

type LocalRows = {
  leads: LocalQuoteLeadRecord[];
  clients: LocalClientRecord[];
  deals: LocalDealRecord[];
  quotations: LocalQuotationRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function phoneKey(value: unknown): string {
  const normalized = digits(value);
  return normalized.startsWith('55') && normalized.length >= 12
    ? normalized.slice(2)
    : normalized;
}

function phoneVariants(value: unknown): string[] {
  const normalized = digits(value);
  if (!normalized) return [];
  const local = normalized.startsWith('55') && normalized.length >= 12
    ? normalized.slice(2)
    : normalized;
  return [...new Set([normalized, local])];
}

function hasEmailControlChars(value: string, allowTextWhitespace: boolean): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (allowTextWhitespace && (code === 9 || code === 10 || code === 13)) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function normalizeEmailMatch(value: string): string {
  if (value.length > CRM_EMAIL_MAX_LENGTH || hasEmailControlChars(value, false)) return '';
  const normalized = value.trim().toLowerCase();
  CRM_EMAIL_PATTERN.lastIndex = 0;
  const match = CRM_EMAIL_PATTERN.exec(normalized)?.[0] || '';
  return match.length <= CRM_EMAIL_MAX_LENGTH ? match : '';
}

function emailKey(value: unknown): string {
  return typeof value === 'string' ? normalizeEmailMatch(value) : '';
}

export function normalizeCrmMatchName(value: unknown): string {
  return String(value ?? '')
    .replace(CRM_MATCH_WHITESPACE, ' ')
    .replace(CRM_MATCH_EDGE_WHITESPACE, '')
    .toLowerCase();
}

function crmNamePredicate(column: unknown, normalizedName: string) {
  return sql`lower(btrim(regexp_replace(translate(${column}, ${CRM_MATCH_WHITESPACE_SQL_FROM}, ${CRM_MATCH_WHITESPACE_SQL_TO}), ' +', ' ', 'g'))) = ${normalizedName}`;
}

export function messageEmails(messages: Array<{ body?: unknown; direction?: unknown }>): string[] {
  const found = new Set<string>();
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.direction !== 'inbound' || typeof message.body !== 'string') continue;
    const body = message.body;
    if (body.length > CRM_EMAIL_SCAN_LIMIT || hasEmailControlChars(body, true)) continue;
    CRM_EMAIL_PATTERN.lastIndex = 0;
    for (const match of body.matchAll(CRM_EMAIL_PATTERN)) {
      const normalized = normalizeEmailMatch(match[0]);
      if (normalized) found.add(normalized);
    }
  }
  return [...found];
}

function repositoryFailure(error: unknown, fallback: string): never {
  const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0);
  if (statusCode >= 400 && statusCode < 500) throw error;
  if (statusCode === 503) throw error;
  console.error('[whatsapp-crm-match]', error instanceof Error ? error.name : typeof error);
  throw createHttpError(503, fallback);
}

function rowText(value: unknown): string | null {
  const result = cleanText(value);
  return result || null;
}

function mapLead(row: Record<string, unknown>): LocalQuoteLeadRecord {
  const names = [row.nome, row.first_name, row.lead_name]
    .map((value) => cleanText(value))
    .filter(Boolean);
  return {
    id: String(row.id ?? row.name ?? ''),
    nome: rowText(row.nome ?? row.first_name ?? row.lead_name),
    nomeAlternatives: names,
    telefone: rowText(row.telefone ?? row.mobile_no ?? row.phone),
    email: rowText(row.email ?? row.email_id),
    status: String(row.status || 'new'),
    source: rowText(row.source) || undefined,
    quotationId: rowText(row.quotationId ?? row.quotation_id),
    crmDealId: rowText(row.crmDealId ?? row.crm_deal_id),
    externalId: rowText(row.externalId ?? row.external_id),
  };
}

function mapClient(row: Record<string, unknown>): LocalClientRecord {
  return {
    id: String(row.id ?? ''),
    nome: cleanText(row.nome ?? row.name ?? row.customer_name),
    telefone: rowText(row.telefone ?? row.phone ?? row.mobile_no),
    email: rowText(row.email ?? row.email_id),
    arquivado: row.arquivado === true || row.archived === true,
  };
}

function mapDeal(row: Record<string, unknown>): LocalDealRecord {
  return {
    id: String(row.id ?? ''),
    quoteLeadId: rowText(row.quoteLeadId ?? row.quote_lead_id),
    clientId: rowText(row.clientId ?? row.client_id),
    quotationId: rowText(row.quotationId ?? row.quotation_id),
    nome: cleanText(row.nome ?? row.lead_name ?? row.name),
    telefone: rowText(row.telefone ?? row.phone ?? row.mobile_no),
    email: rowText(row.email ?? row.email_id),
    status: String(row.status || 'Novo Lead'),
  };
}

function mapQuotation(row: Record<string, unknown>): LocalQuotationRecord {
  const snapshot = isRecord(row.snapshot) ? row.snapshot : row;
  return {
    id: String(row.id ?? ''),
    businessNumber: cleanText(row.businessNumber ?? row.business_number),
    clientId: String(row.clientId ?? row.client_id ?? ''),
    status: String(row.status || 'rascunho'),
    snapshot: {
      nome: rowText(snapshot.clienteNome ?? snapshot.cliente_nome ?? snapshot.nome),
      telefone: rowText(snapshot.clienteTelefone ?? snapshot.cliente_telefone ?? snapshot.telefone),
      email: rowText(snapshot.clienteEmail ?? snapshot.cliente_email ?? snapshot.email),
    },
  };
}

function historyTime(value: unknown): number {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function historyDate(value: unknown): string {
  return new Date(historyTime(value)).toISOString().slice(0, 10);
}

function historyQuotationStatus(value: unknown): string {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === 'rascunho') return 'Rascunho';
  if (normalized === 'emitido' || normalized === 'enviado') return 'Enviado';
  if (normalized === 'aprovado') return 'Aprovado';
  if (normalized === 'perdido') return 'Perdido';
  return 'Status indisponível';
}

function historyDeliveryStatus(value: unknown): LocalDeliveryHistoryRecord['status'] {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === 'delivered') return 'entregue';
  if (normalized === 'failed' || normalized === 'retry_scheduled') return 'falhou';
  if (normalized === 'queued') return 'pendente';
  if (['processing', 'provider_accepted', 'reconciling', 'needs_review'].includes(normalized)) return 'enviado';
  return 'sem entrega registrada';
}

function historyQuotationUrl(businessNumber: string): string {
  return `/#/quotations/${encodeURIComponent(businessNumber)}`;
}

function activeRows(rows: LocalRows): LocalRows {
  return {
    leads: rows.leads.filter((row) => row.status !== DISCARDED_LEAD_STATUS),
    clients: rows.clients.filter((row) => !row.arquivado),
    deals: rows.deals.filter((row) => row.status !== LOST_DEAL_STATUS),
    quotations: rows.quotations,
  };
}

function addCandidate(map: Map<string, LocalCrmCandidate>, candidate: LocalCrmCandidate): void {
  if (!candidate.id || (!candidate.nome && !candidate.telefone && !candidate.email)) return;
  const key = `${candidate.tipo}:${candidate.id}`;
  const current = map.get(key);
  if (!current) {
    map.set(key, {
      id: candidate.id,
      tipo: candidate.tipo,
      nome: candidate.nome || '',
      telefone: candidate.telefone || null,
      email: candidate.email || null,
      dealId: candidate.dealId || null,
      quotationId: candidate.quotationId || null,
      nameAlternatives: [...(candidate.nameAlternatives || [])],
    });
    return;
  }
  map.set(key, {
    ...current,
    nome: current.nome || candidate.nome,
    telefone: current.telefone || candidate.telefone || null,
    email: current.email || candidate.email || null,
    dealId: current.dealId || candidate.dealId || null,
    quotationId: current.quotationId || candidate.quotationId || null,
    nameAlternatives: [...new Set([...(current.nameAlternatives || []), ...(candidate.nameAlternatives || [])])],
  });
}

function candidateForLead(
  lead: LocalQuoteLeadRecord,
  quotationsById: Map<string, LocalQuotationRecord>,
  dealId: string | null = null
): LocalCrmCandidate {
  const snapshot = lead.quotationId ? quotationsById.get(lead.quotationId)?.snapshot : null;
  return {
    id: lead.id,
    tipo: 'lead',
    nome: lead.nome || snapshot?.nome || '',
    nameAlternatives: lead.nomeAlternatives,
    telefone: lead.telefone || snapshot?.telefone || null,
    email: lead.email || snapshot?.email || null,
    dealId,
    quotationId: lead.quotationId,
  };
}

function candidateForClient(
  client: LocalClientRecord,
  quotationsById: Map<string, LocalQuotationRecord>,
  quotationId: string | null = null,
  dealId: string | null = null
): LocalCrmCandidate {
  const snapshot = quotationId ? quotationsById.get(quotationId)?.snapshot : null;
  return {
    id: client.id,
    tipo: 'cliente',
    nome: client.nome || snapshot?.nome || '',
    telefone: client.telefone || snapshot?.telefone || null,
    email: client.email || snapshot?.email || null,
    dealId,
    quotationId,
  };
}

function buildCandidates(rows: LocalRows): LocalCrmCandidate[] {
  const map = new Map<string, LocalCrmCandidate>();
  const leadsById = new Map(rows.leads.map((row) => [row.id, row]));
  const clientsById = new Map(rows.clients.map((row) => [row.id, row]));
  const quotationsById = new Map(rows.quotations.map((row) => [row.id, row]));
  for (const lead of rows.leads) addCandidate(map, candidateForLead(lead, quotationsById));
  for (const client of rows.clients) addCandidate(map, candidateForClient(client, quotationsById));
  for (const deal of rows.deals) {
    if (deal.clientId) {
      const client = clientsById.get(deal.clientId);
      if (client) addCandidate(map, candidateForClient(client, quotationsById, deal.quotationId, deal.id));
    } else if (deal.quoteLeadId) {
      const lead = leadsById.get(deal.quoteLeadId);
      if (lead) addCandidate(map, candidateForLead(lead, quotationsById, deal.id));
    }
    // Unlinked deals deliberately do not become leads.
  }
  for (const quotation of rows.quotations) {
    const client = clientsById.get(quotation.clientId);
    if (client) addCandidate(map, candidateForClient(client, quotationsById, quotation.id));
  }
  return [...map.values()];
}

function findByPhone(candidates: LocalCrmCandidate[], phone: string): LocalCrmCandidate[] {
  const key = phoneKey(phone);
  return key ? candidates.filter((candidate) => phoneKey(candidate.telefone) === key) : [];
}

function findByEmail(candidates: LocalCrmCandidate[], emails: string[]): LocalCrmCandidate[] {
  const wanted = new Set(emails);
  return candidates.filter((candidate) => candidate.email && wanted.has(emailKey(candidate.email)));
}

function usableName(value: unknown): boolean {
  const key = normalizeCrmMatchName(value);
  const parts = key.split(CRM_MATCH_WHITESPACE).filter(Boolean);
  return parts.length >= 2 && key.replace(CRM_MATCH_WHITESPACE, '').length >= 5 && !parts.some((part) => part.length < 2);
}

function findByName(candidates: LocalCrmCandidate[], displayName: string): LocalCrmCandidate[] {
  const key = normalizeCrmMatchName(displayName);
  if (!usableName(key)) return [];
  return candidates.filter((candidate) =>
    [candidate.nome, ...(candidate.nameAlternatives || [])].some((name) => normalizeCrmMatchName(name) === key)
  );
}

function uniqueLimited(candidates: LocalCrmCandidate[], limit = TARGET_LIMIT): LocalCrmCandidate[] {
  const map = new Map<string, LocalCrmCandidate>();
  for (const candidate of candidates) addCandidate(map, candidate);
  return [...map.values()]
    .sort((a, b) => `${a.tipo}:${a.id}`.localeCompare(`${b.tipo}:${b.id}`))
    .slice(0, limit);
}

function chooseUnique(candidates: LocalCrmCandidate[]): LocalCrmCandidate | null | undefined {
  const unique = uniqueLimited(candidates, TARGET_LIMIT);
  if (unique.length === 0) return undefined;
  if (unique.length > 1) return null;
  return unique[0];
}

function matchResult(candidate: LocalCrmCandidate, source: WhatsappCrmMatch['matchSource']): WhatsappCrmMatch {
  return {
    id: candidate.id,
    tipo: candidate.tipo,
    nome: candidate.nome,
    telefone: candidate.telefone,
    email: candidate.email,
    matchSource: source,
  };
}

function sourceForSaved(
  conversation: WhatsappConversation,
  candidate: LocalCrmCandidate,
  emails: string[]
): WhatsappCrmMatch['matchSource'] {
  if (
    conversation.linkedCrmMatchSource === 'phone' ||
    conversation.linkedCrmMatchSource === 'email' ||
    conversation.linkedCrmMatchSource === 'name'
  ) return conversation.linkedCrmMatchSource;
  if (phoneKey(conversation.canonicalPhone) && phoneKey(candidate.telefone) === phoneKey(conversation.canonicalPhone)) return 'phone';
  if (candidate.email && emails.includes(emailKey(candidate.email))) return 'email';
  return 'name';
}

async function loadRows(repository: LocalWhatsappCrmRepository): Promise<LocalRows> {
  try {
    const [leads, clientsRows, deals, quotationsRows] = await Promise.all([
      repository.listQuoteLeads?.() || Promise.resolve([]),
      repository.listClients?.() || Promise.resolve([]),
      repository.listDeals?.() || Promise.resolve([]),
      repository.listQuotations?.() || Promise.resolve([]),
    ]);
    return { leads, clients: clientsRows, deals, quotations: quotationsRows };
  } catch (error) {
    return repositoryFailure(error, 'Não foi possível acessar os dados comerciais locais.');
  }
}

function listRepository(input: {
  listQuoteLeads?: () => Promise<LocalQuoteLeadRecord[]>;
  listClients?: () => Promise<LocalClientRecord[]>;
  listDeals?: () => Promise<LocalDealRecord[]>;
  listQuotations?: () => Promise<LocalQuotationRecord[]>;
  getQuoteLead?: (id: string) => Promise<LocalQuoteLeadRecord | null>;
  getClient?: (id: string) => Promise<LocalClientRecord | null>;
  getDeal?: (id: string) => Promise<LocalDealRecord | null>;
  getQuotation?: (id: string) => Promise<LocalQuotationRecord | null>;
  findQuoteLeadByExternalId?: (
    id: string,
    source?: string
  ) => Promise<LocalQuoteLeadRecord | null>;
}): LocalWhatsappCrmRepository {
  const emptyLeads = async () => [] as LocalQuoteLeadRecord[];
  const emptyClients = async () => [] as LocalClientRecord[];
  const emptyDeals = async () => [] as LocalDealRecord[];
  const emptyQuotations = async () => [] as LocalQuotationRecord[];
  const listQuoteLeads = input.listQuoteLeads || emptyLeads;
  const listClients = input.listClients || emptyClients;
  const listDeals = input.listDeals || emptyDeals;
  const listQuotations = input.listQuotations || emptyQuotations;
  const getQuoteLead = input.getQuoteLead || (async (id) => (await listQuoteLeads()).find((row) => row.id === id) || null);
  const getClient = input.getClient || (async (id) => (await listClients()).find((row) => row.id === id) || null);
  const getDeal = input.getDeal || (async (id) => (await listDeals()).find((row) => row.id === id) || null);
  const getQuotation = input.getQuotation || (async (id) => (await listQuotations()).find((row) => row.id === id) || null);
  const candidateRows = async () => buildCandidates(activeRows(await loadRows({
    listQuoteLeads,
    listClients,
    listDeals,
    listQuotations,
    getQuoteLead,
    getClient,
    getDeal,
    getQuotation,
  })));
  return {
    listQuoteLeads,
    listClients,
    listDeals,
    listQuotations,
    getQuoteLead,
    getClient,
    getDeal,
    getQuotation,
    findQuoteLeadByExternalId:
      input.findQuoteLeadByExternalId ||
      (async (id, source) => {
        const normalizedSource = cleanText(source);
        const matches = (await listQuoteLeads())
          .filter(
            (row) =>
              row.externalId === id &&
              (!normalizedSource || row.source === normalizedSource)
          )
          .sort((a, b) => a.id.localeCompare(b.id));
        if (matches.length > 1) {
          throw createHttpError(409, 'Identificador externo do WhatsApp ambíguo.');
        }
        return matches[0] || null;
      }),
    findCandidatesByPhone: async (phone, limit) => uniqueLimited(findByPhone(await candidateRows(), phone), limit),
    findCandidatesByEmail: async (emails, limit) => uniqueLimited(findByEmail(await candidateRows(), emails), limit),
    findCandidatesByName: async (name, limit) => uniqueLimited(findByName(await candidateRows(), name), limit),
  };
}

function dbFields() {
  return {
    id: quoteLeads.id,
    nome: quoteLeads.nome,
    telefone: quoteLeads.telefone,
    email: quoteLeads.email,
    status: quoteLeads.status,
    source: quoteLeads.source,
    quotationId: quoteLeads.quotationId,
    crmDealId: quoteLeads.crmDealId,
    externalId: quoteLeads.externalId,
  };
}

export function createPostgresWhatsappCrmRepository(
  getDb: () => AppDatabase = getDatabase
): LocalWhatsappCrmRepository {
  let database: AppDatabase;
  try {
    database = getDb();
  } catch (error) {
    return repositoryFailure(error, 'Não foi possível acessar os dados comerciais locais.');
  }

  const getQuoteLead = async (id: string): Promise<LocalQuoteLeadRecord | null> => {
    try {
      const [row] = await database.select(dbFields()).from(quoteLeads).where(eq(quoteLeads.id, id)).limit(1);
      return row ? mapLead(row as Record<string, unknown>) : null;
    } catch (error) {
      return repositoryFailure(error, 'Não foi possível acessar os leads locais.');
    }
  };
  const getClient = async (id: string): Promise<LocalClientRecord | null> => {
    try {
      const [row] = await database.select({ id: clients.id, nome: clients.nome, telefone: clients.telefone, email: clients.email, arquivado: clients.arquivado }).from(clients).where(eq(clients.id, id)).limit(1);
      return row ? mapClient(row as Record<string, unknown>) : null;
    } catch (error) {
      return repositoryFailure(error, 'Não foi possível acessar os clientes locais.');
    }
  };
  const getDeal = async (id: string): Promise<LocalDealRecord | null> => {
    try {
      const [row] = await database.select({ id: crmDeals.id, quoteLeadId: crmDeals.quoteLeadId, clientId: crmDeals.clientId, quotationId: crmDeals.quotationId, nome: crmDeals.nome, telefone: crmDeals.telefone, email: crmDeals.email, status: crmDeals.status }).from(crmDeals).where(eq(crmDeals.id, id)).limit(1);
      return row ? mapDeal(row as Record<string, unknown>) : null;
    } catch (error) {
      return repositoryFailure(error, 'Não foi possível acessar as oportunidades locais.');
    }
  };
  const getQuotation = async (id: string): Promise<LocalQuotationRecord | null> => {
    try {
      const [row] = await database.select({ id: quotations.id, businessNumber: quotations.businessNumber, clientId: quotations.clientId, status: quotations.status }).from(quotations).where(eq(quotations.id, id)).limit(1);
      if (!row) return null;
      const [revision] = await database.select({ quotationId: quoteRevisions.quotationId, version: quoteRevisions.version, nome: quoteRevisions.clienteNome, telefone: quoteRevisions.clienteTelefone, email: quoteRevisions.clienteEmail }).from(quoteRevisions).where(eq(quoteRevisions.quotationId, id)).orderBy(desc(quoteRevisions.version), asc(quoteRevisions.id)).limit(1);
      return mapQuotation({ ...row, snapshot: revision || null } as Record<string, unknown>);
    } catch (error) {
      return repositoryFailure(error, 'Não foi possível acessar os orçamentos locais.');
    }
  };
  const listQuotationsByClientId = async (
    clientId: string,
    limit: number,
  ): Promise<LocalQuotationHistoryRecord[]> => {
    try {
      const safeLimit = Math.max(1, Math.min(Math.floor(limit) || 1, 50));
      const latest = database
        .selectDistinctOn([quotations.id], {
          id: quotations.id,
          businessNumber: quotations.businessNumber,
          status: quotations.status,
          createdAt: quotations.createdAt,
          updatedAt: quotations.updatedAt,
          total: quoteRevisions.total,
          revisionId: quoteRevisions.id,
          revisionCreatedAt: quoteRevisions.createdAt,
        })
        .from(quotations)
        .innerJoin(quoteRevisions, eq(quoteRevisions.quotationId, quotations.id))
        .where(eq(quotations.clientId, clientId))
        .orderBy(asc(quotations.id), desc(quoteRevisions.version), asc(quoteRevisions.id))
        .as('latest_client_quotations');
      const rows = await database
        .select()
        .from(latest)
        .orderBy(desc(latest.updatedAt), asc(latest.id))
        .limit(safeLimit);
      return rows.map((row) => {
          const businessNumber = cleanText(row.businessNumber);
          return {
            id: row.id,
            businessNumber,
            status: historyQuotationStatus(row.status),
            date: historyDate(row.updatedAt || row.revisionCreatedAt || row.createdAt),
            total: rowText(row.total) || '0.00',
            url: historyQuotationUrl(businessNumber),
          };
        });
    } catch (error) {
      return repositoryFailure(error, 'Não foi possível acessar o histórico de orçamentos.');
    }
  };

  const listDeliveriesByQuotationIds = async (
    quotationIds: string[],
    limit: number,
  ): Promise<LocalDeliveryHistoryRecord[]> => {
    if (quotationIds.length === 0) return [];
    try {
      const safeLimit = Math.max(1, Math.min(Math.floor(limit) || 1, 50));
      const revisionRows = await database
        .select({ id: quoteRevisions.id, quotationId: quoteRevisions.quotationId, version: quoteRevisions.version })
        .from(quoteRevisions)
        .where(inArray(quoteRevisions.quotationId, quotationIds))
        .orderBy(desc(quoteRevisions.version), asc(quoteRevisions.id));
      const latestRevisionIds = [...new Set(revisionRows.map((row) => row.quotationId))]
        .map((quotationId) => revisionRows.find((row) => row.quotationId === quotationId)?.id)
        .filter((id): id is string => Boolean(id));
      if (latestRevisionIds.length === 0) return [];
      const rows = await database
        .select({
          id: quotationDeliveries.id,
          revisionId: quotationDeliveries.revisionId,
          state: quotationDeliveries.state,
          updatedAt: quotationDeliveries.updatedAt,
          businessNumber: quotations.businessNumber,
        })
        .from(quotationDeliveries)
        .innerJoin(quoteRevisions, eq(quotationDeliveries.revisionId, quoteRevisions.id))
        .innerJoin(quotations, eq(quoteRevisions.quotationId, quotations.id))
        .where(inArray(quotationDeliveries.revisionId, latestRevisionIds))
        .orderBy(desc(quotationDeliveries.updatedAt), asc(quotationDeliveries.id))
        .limit(safeLimit);
      return rows.map((row) => ({
        id: row.id,
        revisionId: row.revisionId,
        businessNumber: cleanText(row.businessNumber),
        status: historyDeliveryStatus(row.state),
        date: historyDate(row.updatedAt),
      }));
    } catch (error) {
      return repositoryFailure(error, 'Não foi possível acessar o histórico de entregas.');
    }
  };

  const findQuoteLeadByExternalId = async (
    externalId: string,
    source?: string
  ): Promise<LocalQuoteLeadRecord | null> => {
    try {
      const normalizedExternalId = cleanText(externalId);
      const normalizedSource = source === undefined ? '' : cleanText(source);
      if (!normalizedExternalId || (source !== undefined && !normalizedSource)) return null;
      const filters = [eq(quoteLeads.externalId, normalizedExternalId)];
      if (normalizedSource) filters.push(eq(quoteLeads.source, normalizedSource));
      const rows = await database
        .select(dbFields())
        .from(quoteLeads)
        .where(and(...filters))
        .orderBy(asc(quoteLeads.id))
        .limit(2);
      if (rows.length > 1) {
        throw createHttpError(409, 'Identificador externo do WhatsApp ambíguo.');
      }
      return rows[0] ? mapLead(rows[0] as Record<string, unknown>) : null;
    } catch (error) {
      return repositoryFailure(error, 'Não foi possível acessar os leads locais.');
    }
  };

  async function latestQuotationsByIds(ids: string[]): Promise<LocalQuotationRecord[]> {
    if (ids.length === 0) return [];
    const rows = await database
      .selectDistinctOn(
        [quotations.id],
        {
          quotationId: quotations.id,
          revisionId: quoteRevisions.id,
          version: quoteRevisions.version,
          nome: quoteRevisions.clienteNome,
          telefone: quoteRevisions.clienteTelefone,
          email: quoteRevisions.clienteEmail,
          quotationBusinessNumber: quotations.businessNumber,
          quotationClientId: quotations.clientId,
          quotationStatus: quotations.status,
        }
      )
      .from(quotations)
      .leftJoin(quoteRevisions, eq(quoteRevisions.quotationId, quotations.id))
      .where(inArray(quotations.id, ids))
      .orderBy(asc(quotations.id), desc(quoteRevisions.version), asc(quoteRevisions.id));
    return rows.map((row) => ({
      id: String(row.quotationId),
      businessNumber: cleanText(row.quotationBusinessNumber),
      clientId: String(row.quotationClientId),
      status: String(row.quotationStatus),
      snapshot: { nome: rowText(row.nome), telefone: rowText(row.telefone), email: rowText(row.email) },
    }));
  }

  type QuotationSnapshotMatch = {
    quotation: LocalQuotationRecord;
    client: LocalClientRecord;
  };

  async function queryQuotationSnapshots(
    field: 'phone' | 'email' | 'name',
    value: string | string[]
  ): Promise<QuotationSnapshotMatch[]> {
    const scalarValue = Array.isArray(value) ? value[0] || '' : value;
    const wantedPhones = phoneVariants(scalarValue);
    const normalizedEmails = [...new Set((Array.isArray(value) ? value : [value]).map(emailKey).filter(Boolean))];
    const normalizedName = normalizeCrmMatchName(scalarValue);
    const latest = database
      .selectDistinctOn(
        [quoteRevisions.quotationId],
        {
          quotationId: quoteRevisions.quotationId,
          revisionId: quoteRevisions.id,
          version: quoteRevisions.version,
          nome: quoteRevisions.clienteNome,
          telefone: quoteRevisions.clienteTelefone,
          email: quoteRevisions.clienteEmail,
          quotationBusinessNumber: quotations.businessNumber,
          quotationClientId: quotations.clientId,
          quotationStatus: quotations.status,
        }
      )
      .from(quoteRevisions)
      .innerJoin(quotations, eq(quoteRevisions.quotationId, quotations.id))
      .orderBy(asc(quoteRevisions.quotationId), desc(quoteRevisions.version), asc(quoteRevisions.id))
      .as('latest_quotation_revisions');
    const predicate = field === 'phone'
      ? or(...wantedPhones.map((item) => eq(latest.telefone, item)))
      : field === 'email'
        ? normalizedEmails.length
          ? inArray(latest.email, normalizedEmails)
          : undefined
        : crmNamePredicate(latest.nome, normalizedName);
    if (!predicate) return [];
    // Every quotation snapshot becomes a `cliente` candidate; dedupe that final identity before LIMIT 2.
    const rows = await database
      .selectDistinctOn([clients.id], {
        quotationId: latest.quotationId,
        nome: latest.nome,
        telefone: latest.telefone,
        email: latest.email,
        quotationBusinessNumber: latest.quotationBusinessNumber,
        quotationClientId: latest.quotationClientId,
        quotationStatus: latest.quotationStatus,
        clientId: clients.id,
        clientNome: clients.nome,
        clientTelefone: clients.telefone,
        clientEmail: clients.email,
        clientArquivado: clients.arquivado,
      })
      .from(latest)
      .innerJoin(clients, eq(latest.quotationClientId, clients.id))
      .where(and(eq(clients.arquivado, false), predicate))
      .orderBy(asc(clients.id), asc(latest.quotationId))
      .limit(TARGET_LIMIT);
    return rows.map((row) => ({
      quotation: {
        id: String(row.quotationId),
        businessNumber: cleanText(row.quotationBusinessNumber),
        clientId: String(row.quotationClientId),
        status: String(row.quotationStatus),
        snapshot: { nome: rowText(row.nome), telefone: rowText(row.telefone), email: rowText(row.email) },
      },
      client: {
        id: String(row.clientId),
        nome: cleanText(row.clientNome),
        telefone: rowText(row.clientTelefone),
        email: rowText(row.clientEmail),
        arquivado: row.clientArquivado === true,
      },
    }));
  }

  async function queryCandidates(
    field: 'phone' | 'email' | 'name',
    value: string | string[],
    limit: number
  ): Promise<LocalCrmCandidate[]> {
    try {
      const scalarValue = Array.isArray(value) ? value[0] || '' : value;
      const wantedPhones = phoneVariants(scalarValue);
      const normalizedEmails = [...new Set((Array.isArray(value) ? value : [value]).map(emailKey).filter(Boolean))];
      const normalizedName = normalizeCrmMatchName(scalarValue);
      const leadPredicate = field === 'phone'
        ? or(...wantedPhones.map((item) => eq(quoteLeads.telefone, item)))
        : field === 'email'
          ? normalizedEmails.length
            ? inArray(quoteLeads.email, normalizedEmails)
            : undefined
          : crmNamePredicate(quoteLeads.nome, normalizedName);
      const clientPredicate = field === 'phone'
        ? or(...wantedPhones.map((item) => eq(clients.telefone, item)))
        : field === 'email'
          ? normalizedEmails.length
            ? inArray(clients.email, normalizedEmails)
            : undefined
          : crmNamePredicate(clients.nome, normalizedName);
      const dealPredicate = field === 'phone'
        ? or(...wantedPhones.map((item) => eq(crmDeals.telefone, item)))
        : field === 'email'
          ? normalizedEmails.length
            ? inArray(crmDeals.email, normalizedEmails)
            : undefined
          : crmNamePredicate(crmDeals.nome, normalizedName);
      const dealCandidateKey = sql`
        CASE
          WHEN ${crmDeals.clientId} IS NOT NULL THEN 'cliente:' || ${crmDeals.clientId}::text
          WHEN ${crmDeals.quoteLeadId} IS NOT NULL THEN 'lead:' || ${crmDeals.quoteLeadId}::text
        END
      `;
      const [leadRows, clientRows, dealRows] = await Promise.all([
        leadPredicate
          ? database
              .select(dbFields())
              .from(quoteLeads)
              .where(and(ne(quoteLeads.status, DISCARDED_LEAD_STATUS), leadPredicate))
              .orderBy(asc(quoteLeads.id))
              .limit(TARGET_LIMIT)
          : Promise.resolve([]),
        clientPredicate
          ? database
              .select({
                id: clients.id,
                nome: clients.nome,
                telefone: clients.telefone,
                email: clients.email,
                arquivado: clients.arquivado,
              })
              .from(clients)
              .where(and(eq(clients.arquivado, false), clientPredicate))
              .orderBy(asc(clients.id))
              .limit(TARGET_LIMIT)
          : Promise.resolve([]),
        dealPredicate
          ? database
              .selectDistinctOn(
                [dealCandidateKey],
                {
                  id: crmDeals.id,
                  quoteLeadId: crmDeals.quoteLeadId,
                  clientId: crmDeals.clientId,
                  quotationId: crmDeals.quotationId,
                  nome: crmDeals.nome,
                  telefone: crmDeals.telefone,
                  email: crmDeals.email,
                  status: crmDeals.status,
                }
              )
              .from(crmDeals)
              .where(
                and(
                  ne(crmDeals.status, LOST_DEAL_STATUS),
                  sql`(${crmDeals.clientId} IS NOT NULL OR ${crmDeals.quoteLeadId} IS NOT NULL)`,
                  dealPredicate
                )
              )
              .orderBy(asc(dealCandidateKey), asc(crmDeals.id))
              .limit(TARGET_LIMIT)
          : Promise.resolve([]),
      ]);
      const leads = leadRows.map((row) => mapLead(row as Record<string, unknown>));
      const clientsRows = clientRows.map((row) => mapClient(row as Record<string, unknown>));
      const deals = dealRows.map((row) => mapDeal(row as Record<string, unknown>));
      const dealClientIds = [...new Set(deals.map((deal) => deal.clientId).filter(Boolean) as string[])];
      const dealLeadIds = [...new Set(deals.map((deal) => deal.quoteLeadId).filter(Boolean) as string[])];
      const dealQuotationIds = [...new Set(deals.map((deal) => deal.quotationId).filter(Boolean) as string[])];
      const [dealClients, dealLeads, dealQuotations] = await Promise.all([
        dealClientIds.length
          ? database
              .select({ id: clients.id, nome: clients.nome, telefone: clients.telefone, email: clients.email, arquivado: clients.arquivado })
              .from(clients)
              .where(and(eq(clients.arquivado, false), inArray(clients.id, dealClientIds)))
          : Promise.resolve([]),
        dealLeadIds.length
          ? database
              .select(dbFields())
              .from(quoteLeads)
              .where(and(ne(quoteLeads.status, DISCARDED_LEAD_STATUS), inArray(quoteLeads.id, dealLeadIds)))
          : Promise.resolve([]),
        latestQuotationsByIds(dealQuotationIds),
      ]);
      const clientsById = new Map(dealClients.map((row) => [String(row.id), mapClient(row as Record<string, unknown>)]));
      const leadsById = new Map(dealLeads.map((row) => [String(row.id), mapLead(row as Record<string, unknown>)]));
      const quotationsById = new Map(dealQuotations.map((row) => [row.id, row]));
      const map = new Map<string, LocalCrmCandidate>();
      for (const lead of leads) addCandidate(map, candidateForLead(lead, new Map()));
      for (const client of clientsRows) addCandidate(map, candidateForClient(client, new Map()));
      for (const deal of deals) {
        if (deal.clientId) {
          const client = clientsById.get(deal.clientId);
          const quotation = deal.quotationId ? quotationsById.get(deal.quotationId) : null;
          if (
            client &&
            (!deal.quotationId || (quotation && quotation.clientId === client.id))
          ) {
            addCandidate(
              map,
              candidateForClient(
                client,
                quotation ? new Map([[quotation.id, quotation]]) : new Map(),
                deal.quotationId,
                deal.id
              )
            );
          }
        } else if (deal.quoteLeadId) {
          const lead = leadsById.get(deal.quoteLeadId);
          const quotation = deal.quotationId ? quotationsById.get(deal.quotationId) : null;
          if (lead) {
            addCandidate(
              map,
              candidateForLead(
                lead,
                quotation ? new Map([[quotation.id, quotation]]) : new Map(),
                deal.id
              )
            );
          }
        }
      }
      const quotationRows = await queryQuotationSnapshots(field, value);
      for (const { quotation, client } of quotationRows) {
        addCandidate(map, candidateForClient(client, new Map([[quotation.id, quotation]]), quotation.id));
      }
      return uniqueLimited([...map.values()], limit);
    } catch (error) {
      return repositoryFailure(error, 'Não foi possível acessar os dados comerciais locais.');
    }
  }

  return {
    getQuoteLead,
    getClient,
    getDeal,
    getQuotation,
    listQuotationsByClientId,
    listDeliveriesByQuotationIds,
    findQuoteLeadByExternalId,
    findCandidatesByPhone: (phone, limit) => queryCandidates('phone', phone, limit),
    findCandidatesByEmail: async (emails, limit) => {
      const values = [...new Set(emails.map(emailKey).filter(Boolean))];
      if (values.length === 0) return [];
      return queryCandidates('email', values, limit);
    },
    findCandidatesByName: (name, limit) =>
      usableName(name) ? queryCandidates('name', name, limit) : Promise.resolve([]),
  };
}

async function repositoryFor(deps: ResolveCrmMatchDeps): Promise<LocalWhatsappCrmRepository> {
  if (deps.localCrm) {
    const source = deps.localCrm;
    if (source.findCandidatesByPhone || source.listQuoteLeads || source.listClients || source.listDeals || source.listQuotations) {
      const fallback = listRepository(source);
      return {
        ...fallback,
        ...source,
        findQuoteLeadByExternalId: source.findQuoteLeadByExternalId || fallback.findQuoteLeadByExternalId,
        findCandidatesByPhone: source.findCandidatesByPhone || fallback.findCandidatesByPhone,
        findCandidatesByEmail: source.findCandidatesByEmail || fallback.findCandidatesByEmail,
        findCandidatesByName: source.findCandidatesByName || fallback.findCandidatesByName,
      };
    }
    return source;
  }
  if (
    deps.findCandidatesByPhone || deps.findCandidatesByEmail || deps.findCandidatesByName ||
    deps.listQuoteLeads || deps.listClients || deps.listDeals || deps.listQuotations
  ) {
    return {
      ...listRepository(deps),
      ...(deps.findCandidatesByPhone ? { findCandidatesByPhone: deps.findCandidatesByPhone } : {}),
      ...(deps.findCandidatesByEmail ? { findCandidatesByEmail: deps.findCandidatesByEmail } : {}),
      ...(deps.findCandidatesByName ? { findCandidatesByName: deps.findCandidatesByName } : {}),
      ...(deps.findQuoteLeadByExternalId ? { findQuoteLeadByExternalId: deps.findQuoteLeadByExternalId } : {}),
    };
  }
  return liveRepository();
}

async function loadSavedCandidate(
  conversation: WhatsappConversation,
  repository: LocalWhatsappCrmRepository
): Promise<LocalCrmCandidate | null | undefined> {
  const leadId = conversation.linkedLeadId || null;
  const dealId = conversation.linkedDealId || null;
  const quotationId = conversation.linkedQuotationId || null;
  const entityId = conversation.linkedCrmEntityId || null;
  const entityType = conversation.linkedCrmEntityType || null;
  if (!leadId && !dealId && !quotationId && !entityId) return undefined;
  const [lead, deal, quotation, entity] = await Promise.all([
    leadId ? repository.getQuoteLead(leadId) : Promise.resolve(null),
    dealId ? repository.getDeal(dealId) : Promise.resolve(null),
    quotationId ? repository.getQuotation(quotationId) : Promise.resolve(null),
    entityId && entityType === 'lead' ? repository.getQuoteLead(entityId) : entityId && entityType === 'cliente' ? repository.getClient(entityId) : Promise.resolve(null),
  ]);
  if ((leadId && !lead) || (dealId && !deal) || (quotationId && !quotation) || (entityId && !entity)) return null;
  if (entityId && entityType !== 'lead' && entityType !== 'cliente') return null;
  const dealLead = deal?.quoteLeadId
    ? deal.quoteLeadId === lead?.id
      ? lead
      : await repository.getQuoteLead(deal.quoteLeadId)
    : null;
  if (deal?.quoteLeadId && !dealLead) return null;
  if (lead && deal && deal.quoteLeadId !== lead.id) return null;
  if (lead && quotation && lead.quotationId !== quotation.id) return null;
  if (deal && quotation && deal.quotationId !== quotation.id) return null;
  if (deal?.quoteLeadId && quotation && dealLead?.quotationId !== quotation.id) return null;
  if (deal?.clientId && quotation && deal.clientId !== quotation.clientId) return null;
  if (lead && entity && entityType === 'lead' && lead.id !== entity.id) return null;
  if (deal && entity && entityType === 'lead' && deal.quoteLeadId !== entity.id) return null;
  if (deal && entity && entityType === 'cliente' && deal.clientId !== entity.id) return null;
  if (quotation && entity && entityType === 'lead' && (entity as LocalQuoteLeadRecord).quotationId !== quotation.id) return null;
  if (quotation && entity && entityType === 'cliente' && quotation.clientId !== entity.id) return null;
  if (deal?.clientId && entity && entityType === 'cliente' && deal.clientId !== entity.id) return null;

  if (lead) return candidateForLead(lead, quotation ? new Map([[quotation.id, quotation]]) : new Map(), deal?.id || null);
  if (entity && entityType === 'lead') {
    const linkedLead = entity as LocalQuoteLeadRecord;
    return candidateForLead(linkedLead, quotation ? new Map([[quotation.id, quotation]]) : new Map(), deal?.id || null);
  }
  if (entity && entityType === 'cliente') {
    return candidateForClient(entity as LocalClientRecord, quotation ? new Map([[quotation.id, quotation]]) : new Map(), quotation?.id || null, deal?.id || null);
  }
  if (deal) {
    if (deal.clientId) {
      const client = await repository.getClient(deal.clientId);
      return client ? candidateForClient(client, quotation ? new Map([[quotation.id, quotation]]) : new Map(), quotation?.id || null, deal.id) : null;
    }
    if (deal.quoteLeadId) {
      return dealLead ? candidateForLead(dealLead, quotation ? new Map([[quotation.id, quotation]]) : new Map(), deal.id) : null;
    }
  }
  if (quotation) {
    const client = await repository.getClient(quotation.clientId);
    return client ? candidateForClient(client, new Map([[quotation.id, quotation]]), quotation.id) : null;
  }
  return null;
}

export interface ResolvedWhatsappCrmCandidate {
  candidate: LocalCrmCandidate;
  matchSource: WhatsappCrmMatch['matchSource'];
}

export type WhatsappCrmSnapshot = Pick<
  WhatsappConversation,
  | 'id'
  | 'canonicalPhone'
  | 'displayLabel'
  | 'displayName'
  | 'identityStatus'
  | 'linkedLeadId'
  | 'linkedDealId'
  | 'linkedQuotationId'
  | 'linkedCrmEntityId'
  | 'linkedCrmEntityType'
  | 'linkedCrmMatchSource'
>;

export async function resolveWhatsappCrmCandidateFromSnapshot(input: {
  conversation: WhatsappCrmSnapshot;
  deps: ResolveCrmMatchDeps;
}): Promise<ResolvedWhatsappCrmCandidate | null> {
  return resolveWhatsappCrmCandidate({
    conversation: {
      ...input.conversation,
      providerConversationId: '',
      remoteJid: '',
      phone: input.conversation.canonicalPhone,
      identitySource: null,
      identityConfidence: null,
      lastMessageAt: new Date(0).toISOString(),
      lastMessagePreview: '',
      source: 'evolution',
      status: 'new',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    deps: input.deps,
  });
}

export async function resolveWhatsappCrmCandidate(input: {
  conversation: WhatsappConversation;
  deps: ResolveCrmMatchDeps;
}): Promise<ResolvedWhatsappCrmCandidate | null> {
  const { conversation, deps } = input;
  const repository = await repositoryFor(deps);
  let messages: Array<{ body?: unknown; direction?: unknown }>;
  try {
    messages = await deps.readMessages(conversation.id);
  } catch (error) {
    return repositoryFailure(error, 'Não foi possível acessar as mensagens do WhatsApp.');
  }
  const emails = messageEmails(messages);
  try {
    const saved = await loadSavedCandidate(conversation, repository);
    if (saved !== undefined) {
      return saved
        ? { candidate: saved, matchSource: sourceForSaved(conversation, saved, emails) }
        : null;
    }

    const externalLead = await repository.findQuoteLeadByExternalId?.(conversation.id, 'whatsapp');
    if (externalLead?.source === 'whatsapp') {
      const candidate = candidateForLead(externalLead, new Map());
      return { candidate, matchSource: sourceForSaved(conversation, candidate, emails) };
    }
    if (conversation.identityStatus !== 'verified' && conversation.identityStatus !== 'derived') return null;

    const byPhone = chooseUnique(
      await (repository.findCandidatesByPhone?.(conversation.canonicalPhone, TARGET_LIMIT) || Promise.resolve([]))
    );
    if (byPhone === null) return null;
    if (byPhone) return { candidate: byPhone, matchSource: 'phone' };
    const byEmail = chooseUnique(
      await (repository.findCandidatesByEmail?.(emails, TARGET_LIMIT) || Promise.resolve([]))
    );
    if (byEmail === null) return null;
    if (byEmail) return { candidate: byEmail, matchSource: 'email' };
    const byName = chooseUnique(
      await (repository.findCandidatesByName?.(conversation.displayLabel || conversation.displayName, TARGET_LIMIT) || Promise.resolve([]))
    );
    if (byName === null) return null;
    return byName ? { candidate: byName, matchSource: 'name' } : null;
  } catch (error) {
    return repositoryFailure(error, 'Não foi possível acessar os dados comerciais locais.');
  }
}

export async function resolveWhatsappCrmMatch(input: {
  conversation: WhatsappConversation;
  deps: ResolveCrmMatchDeps;
}): Promise<WhatsappCrmMatch | null> {
  const resolved = await resolveWhatsappCrmCandidate(input);
  return resolved ? matchResult(resolved.candidate, resolved.matchSource) : null;
}

export async function validateWhatsappConversationLinks(input: {
  patch: Pick<WhatsappConversation, 'linkedLeadId' | 'linkedDealId' | 'linkedQuotationId'>;
  deps: ResolveCrmMatchDeps;
}): Promise<void> {
  const values = {
    linkedLeadId: input.patch.linkedLeadId ?? null,
    linkedDealId: input.patch.linkedDealId ?? null,
    linkedQuotationId: input.patch.linkedQuotationId ?? null,
  };
  for (const [field, value] of Object.entries(values)) {
    if (value !== null && !isUuid(value)) throw createHttpError(400, `${field} inválido.`);
  }
  if (!values.linkedLeadId && !values.linkedDealId && !values.linkedQuotationId) return;
  const repository = await repositoryFor(input.deps);
  try {
    const [lead, deal, quotation] = await Promise.all([
      values.linkedLeadId ? repository.getQuoteLead(values.linkedLeadId) : Promise.resolve(null),
      values.linkedDealId ? repository.getDeal(values.linkedDealId) : Promise.resolve(null),
      values.linkedQuotationId ? repository.getQuotation(values.linkedQuotationId) : Promise.resolve(null),
    ]);
    if (values.linkedLeadId && !lead) throw createHttpError(400, 'Lead local não encontrado.');
    if (values.linkedDealId && !deal) throw createHttpError(400, 'Oportunidade local não encontrada.');
    if (values.linkedQuotationId && !quotation) throw createHttpError(400, 'Orçamento local não encontrado.');
    if (lead && deal && deal.quoteLeadId !== lead.id) throw createHttpError(400, 'Lead e oportunidade não estão vinculados.');
    if (lead && quotation && lead.quotationId !== quotation.id) throw createHttpError(400, 'Lead e orçamento não estão vinculados.');
    if (deal && quotation && deal.quotationId !== quotation.id) throw createHttpError(400, 'Oportunidade e orçamento não estão vinculados.');
    if (deal?.clientId && quotation && deal.clientId !== quotation.clientId) throw createHttpError(400, 'Oportunidade e orçamento não estão vinculados ao mesmo cliente.');
  } catch (error) {
    return repositoryFailure(error, 'Não foi possível validar os vínculos comerciais locais.');
  }
}

export async function liveRepository(): Promise<LocalWhatsappCrmRepository> {
  return createPostgresWhatsappCrmRepository();
}
