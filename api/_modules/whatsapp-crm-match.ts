import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { createHttpError } from '../_shared/http-error.js';
import { getDatabase, type AppDatabase } from '../_infrastructure/db/client.js';
import { clients, crmDeals, quoteLeads, quoteRevisions, quotationDeliveries, quotations } from '../_infrastructure/db/schema.js';
import { safeErrorSummary } from '../_shared/safe-error.js';
// Identifiers and names only; never applied to a message body.
function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
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
  demandId?: string | null;
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
  quotationId: string;
  revisionId: string;
  flowId: string;
  businessNumber: string;
  status: 'pendente' | 'enviado' | 'entregue' | 'falhou' | 'sem entrega registrada';
  date: string;
  occurredAt: string;
  url: string;
  canSend: boolean;
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

const DISCARDED_LEAD_STATUS = 'discarded';
const LOST_DEAL_STATUS = 'Perdido';
const TARGET_LIMIT = 2;
const CRM_EMAIL_MAX_LENGTH = 254;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
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

function repositoryFailure(error: unknown, fallback: string): never {
  const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0);
  if (statusCode >= 400 && statusCode < 500) throw error;
  if (statusCode === 503) throw error;
  console.error('[whatsapp-crm-match]', safeErrorSummary(error));
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
    demandId: rowText(row.demandId ?? row.demand_id),
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

function historyQuotationUrl(quotationId: string): string {
  return `/#/quotations/${encodeURIComponent(quotationId)}`;
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

function usableName(value: unknown): boolean {
  const key = normalizeCrmMatchName(value);
  const parts = key.split(CRM_MATCH_WHITESPACE).filter(Boolean);
  return parts.length >= 2 && key.replace(CRM_MATCH_WHITESPACE, '').length >= 5 && !parts.some((part) => part.length < 2);
}

function uniqueLimited(candidates: LocalCrmCandidate[], limit = TARGET_LIMIT): LocalCrmCandidate[] {
  const map = new Map<string, LocalCrmCandidate>();
  for (const candidate of candidates) addCandidate(map, candidate);
  return [...map.values()]
    .sort((a, b) => `${a.tipo}:${a.id}`.localeCompare(`${b.tipo}:${b.id}`))
    .slice(0, limit);
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
    demandId: quoteLeads.demandId,
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
            date: historyDate(row.updatedAt || row.createdAt),
            total: rowText(row.total) || '0.00',
            url: historyQuotationUrl(row.id),
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
      const latestRevisionIds = new Set(
        [...new Set(revisionRows.map((row) => row.quotationId))]
          .map((quotationId) => revisionRows.find((row) => row.quotationId === quotationId)?.id)
          .filter((id): id is string => Boolean(id)),
      );
      if (revisionRows.length === 0) return [];
      const rows = await database
        .select({
          id: quotationDeliveries.id,
          quotationId: quotations.id,
          revisionId: quotationDeliveries.revisionId,
          flowId: quotationDeliveries.flowId,
          state: quotationDeliveries.state,
          updatedAt: quotationDeliveries.updatedAt,
          businessNumber: quotations.businessNumber,
        })
        .from(quotationDeliveries)
        .innerJoin(quoteRevisions, eq(quotationDeliveries.revisionId, quoteRevisions.id))
        .innerJoin(quotations, eq(quoteRevisions.quotationId, quotations.id))
        .where(inArray(quotationDeliveries.revisionId, revisionRows.map((row) => row.id)))
        .orderBy(desc(quotationDeliveries.updatedAt), asc(quotationDeliveries.id))
        .limit(safeLimit);
      return rows.map((row) => ({
        id: row.id,
        quotationId: row.quotationId,
        revisionId: row.revisionId,
        flowId: row.flowId,
        businessNumber: cleanText(row.businessNumber),
        status: historyDeliveryStatus(row.state),
        date: historyDate(row.updatedAt),
        occurredAt: row.updatedAt.toISOString(),
        url: historyQuotationUrl(row.quotationId),
        canSend: latestRevisionIds.has(row.revisionId) && row.state === 'queued',
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

