import { kv } from '@vercel/kv';
import { createHttpError } from './erpnext.js';

export type QuoteLeadStatus =
  | 'new'
  | 'incomplete'
  | 'ready'
  | 'reviewing'
  | 'converted'
  | 'discarded';

export interface QuoteLeadAttribution {
  page_url?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  source_cta?: string | null;
  result_id?: string | null;
}

export interface QuoteLead {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  pedidoTexto: string;
  source: string;
  status: QuoteLeadStatus;
  erpLeadId?: string | null;
  quotationId?: string | null;
  empresa?: string;
  produto?: string;
  quantidade?: string;
  finalidade?: string;
  prazo?: string;
  arte?: string;
  sourceDetail?: string;
  externalId?: string | null;
  attribution?: QuoteLeadAttribution;
  missingFields?: string[];
  raw?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteLeadClockDeps {
  now: () => string;
  id: () => string;
}

export interface QuoteLeadStoreDeps extends QuoteLeadClockDeps {
  readAll: () => Promise<QuoteLead[]>;
  writeAll: (leads: QuoteLead[]) => Promise<void>;
}

const KV_KEY_QUOTE_LEADS = 'aspen:quote-leads';
const MAX_STORED_QUOTE_LEADS = 200;

function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanMultilineText(value: unknown): string {
  return String(value || '')
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join('\n');
}

function nullableCleanText(value: unknown): string | null {
  const text = cleanText(value);
  return text || null;
}

function normalizeEmail(value: unknown): string {
  return cleanText(value).toLowerCase();
}

function normalizePhone(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11))
    return `55${digits}`;
  return digits;
}

function localPhone(value: unknown): string {
  const phone = normalizePhone(value);
  return phone.startsWith('55') ? phone.slice(2) : phone;
}

// ponytail: numeric product codes from Typebot (1-7), map here instead of 14 Typebot blocks
const PRODUTO_MAP: Record<string, string> = {
  '1': 'Lenços',
  '2': 'Cangas',
  '3': 'Bolsas',
  '4': 'Toalhas',
  '5': 'Chapéus',
  '6': 'Cachecóis',
  '7': 'Outros',
};

function resolveProduto(value: unknown): string {
  const raw = cleanText(value);
  return PRODUTO_MAP[raw] || raw;
}

function buildPedidoTexto(input: Record<string, unknown>): string {
  const explicit = cleanMultilineText(input.pedidoTexto || input.pedido || input.msg);
  if (explicit) return explicit;

  return [
    input.produto ? `Produto: ${resolveProduto(input.produto)}` : '',
    input.quantidade || input.qtd ? `Quantidade: ${cleanText(input.quantidade || input.qtd)}` : '',
    input.finalidade ? `Finalidade: ${cleanText(input.finalidade)}` : '',
    input.prazo ? `Prazo: ${cleanText(input.prazo)}` : '',
    input.arte ? `Arte: ${cleanText(input.arte)}` : '',
    input.mensagem_contexto || input.message || input.mensagem || input.msg
      ? `Contexto: ${cleanText(input.mensagem_contexto || input.message || input.mensagem || input.msg)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildAttribution(input: Record<string, unknown>): QuoteLeadAttribution {
  return {
    page_url: nullableCleanText(input.page_url || input.pageUrl),
    utm_source: nullableCleanText(input.utm_source || input.source),
    utm_medium: nullableCleanText(input.utm_medium || input.medium),
    utm_campaign: nullableCleanText(input.utm_campaign || input.campaign),
    utm_content: nullableCleanText(input.utm_content || input.utmContent),
    utm_term: nullableCleanText(input.utm_term || input.utmTerm),
    gclid: nullableCleanText(input.gclid),
    gbraid: nullableCleanText(input.gbraid),
    wbraid: nullableCleanText(input.wbraid),
    fbclid: nullableCleanText(input.fbclid),
    source_cta: nullableCleanText(input.source_cta || input.sourceCta || input.source),
    result_id: nullableCleanText(input.result_id || input.resultId),
  };
}

function missingFieldsFor(input: {
  nome: string;
  email: string;
  telefone: string;
  pedidoTexto: string;
}): string[] {
  const missing: string[] = [];
  if (!input.nome) missing.push('nome');
  if (!input.email && !input.telefone) missing.push('contato');
  if (!input.pedidoTexto) missing.push('pedido');
  return missing;
}

function statusFrom(value: unknown, missingFields: string[] = []): QuoteLeadStatus {
  if (value === 'converted' || value === 'discarded' || value === 'reviewing') return value;
  if (value === 'ready') return missingFields.length ? 'incomplete' : 'ready';
  if (value === 'incomplete') return 'incomplete';
  if (missingFields.length) return 'incomplete';
  return 'ready';
}

function liveNow(): string {
  return new Date().toISOString();
}

function liveId(): string {
  return `quote_lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function liveReadAll(): Promise<QuoteLead[]> {
  if (!kv) return [];
  const value = await kv.get(KV_KEY_QUOTE_LEADS);
  return Array.isArray(value) ? (value as QuoteLead[]) : [];
}

async function liveWriteAll(leads: QuoteLead[]): Promise<void> {
  if (!kv) throw createHttpError(500, 'Armazenamento de leads não configurado.');
  await kv.set(KV_KEY_QUOTE_LEADS, leads.slice(0, MAX_STORED_QUOTE_LEADS));
}

const LIVE_DEPS: QuoteLeadStoreDeps = {
  readAll: liveReadAll,
  writeAll: liveWriteAll,
  now: liveNow,
  id: liveId,
};

export function normalizeQuoteLeadInput(
  input: Record<string, unknown>,
  deps: QuoteLeadClockDeps = LIVE_DEPS
): QuoteLead {
  const now = deps.now();
  const pedidoTexto = buildPedidoTexto(input);
  const base = {
    nome: cleanText(input.nome || input.name),
    email: normalizeEmail(input.email),
    telefone: normalizePhone(input.telefone || input.phone || input.whatsapp || input.wa),
    pedidoTexto,
  };
  const missing = missingFieldsFor(base);
  const source = cleanText(input.source || input.origem || 'typebot');

  return {
    id: cleanText(input.id) || deps.id(),
    ...base,
    source,
    sourceDetail: cleanText(input.sourceDetail || input.source_detail || input.canal),
    status: statusFrom(input.status, missing),
    erpLeadId: cleanText(input.erpLeadId || input.lead_id || input.leadId) || null,
    quotationId: cleanText(input.quotationId || input.quotation_id) || null,
    empresa: cleanText(input.empresa || input.company),
    produto: input.produto ? resolveProduto(input.produto) : cleanText(input.product),
    quantidade: cleanText(input.quantidade || input.qtd || input.quantity),
    finalidade: cleanText(input.finalidade),
    prazo: cleanText(input.prazo || input.deadline),
    arte: cleanText(input.arte),
    externalId: cleanText(input.externalId || input.external_id || input.sanityId) || null,
    attribution: buildAttribution(input),
    missingFields: missing,
    raw:
      input.raw && typeof input.raw === 'object'
        ? (input.raw as Record<string, unknown>)
        : undefined,
    createdAt: cleanText(input.createdAt) || now,
    updatedAt: cleanText(input.updatedAt) || now,
  };
}

function identityKey(lead: QuoteLead): string {
  if (lead.telefone) return `phone:${localPhone(lead.telefone)}`;
  if (lead.email) return `email:${lead.email}`;
  if (lead.erpLeadId) return `erp:${lead.erpLeadId}`;
  if (lead.externalId) return `external:${lead.source}:${lead.externalId}`;
  return `id:${lead.id}`;
}

function score(lead: QuoteLead): number {
  return [
    lead.nome,
    lead.email,
    lead.telefone,
    lead.pedidoTexto,
    lead.erpLeadId,
    lead.quotationId,
  ].filter(Boolean).length;
}

function mergeAttribution(
  existing?: QuoteLeadAttribution,
  incoming?: QuoteLeadAttribution
): QuoteLeadAttribution {
  const next: QuoteLeadAttribution = { ...(incoming || {}) };
  for (const key of Object.keys(existing || {}) as Array<keyof QuoteLeadAttribution>) {
    if (existing?.[key] && !next[key]) next[key] = existing[key];
    if (existing?.[key] && next[key] && existing[key] !== next[key]) next[key] = existing[key];
  }
  return next;
}

function mergeQuoteLead(existing: QuoteLead, incoming: QuoteLead, now: string): QuoteLead {
  const primary = score(incoming) >= score(existing) ? incoming : existing;
  const secondary = primary === incoming ? existing : incoming;
  const mergedBase = {
    ...primary,
    id: existing.id,
    nome:
      primary.nome && secondary.nome && secondary.nome.length > primary.nome.length
        ? secondary.nome
        : primary.nome || secondary.nome,
    email: primary.email || secondary.email,
    telefone: primary.telefone || secondary.telefone,
    pedidoTexto: primary.pedidoTexto || secondary.pedidoTexto,
    source: primary.source || secondary.source,
    sourceDetail: primary.sourceDetail || secondary.sourceDetail,
    erpLeadId: primary.erpLeadId || secondary.erpLeadId || null,
    quotationId: primary.quotationId || secondary.quotationId || null,
    empresa: primary.empresa || secondary.empresa,
    produto: primary.produto || secondary.produto,
    quantidade: primary.quantidade || secondary.quantidade,
    finalidade: primary.finalidade || secondary.finalidade,
    prazo: primary.prazo || secondary.prazo,
    arte: primary.arte || secondary.arte,
    externalId: primary.externalId || secondary.externalId || null,
    attribution: mergeAttribution(existing.attribution, incoming.attribution),
    createdAt: existing.createdAt,
    updatedAt: now,
  };
  const missing = missingFieldsFor(mergedBase);
  return {
    ...mergedBase,
    missingFields: missing,
    status:
      existing.status === 'converted' || incoming.status === 'converted'
        ? 'converted'
        : existing.status === 'discarded'
          ? 'discarded'
          : statusFrom(primary.status, missing),
  };
}

export function formatQuoteLeadText(lead: QuoteLead): string {
  const displayPhone = lead.telefone.startsWith('55') ? lead.telefone.slice(2) : lead.telefone;
  return [
    lead.nome ? `Nome: ${lead.nome}` : 'Nome:',
    lead.email ? `E-mail: ${lead.email}` : 'E-mail:',
    displayPhone ? `Telefone: ${displayPhone}` : 'Telefone:',
    lead.pedidoTexto ? `Pedido: ${lead.pedidoTexto}` : 'Pedido:',
  ].join('\n');
}

export async function upsertQuoteLead(
  input: Record<string, unknown>,
  deps: QuoteLeadStoreDeps = LIVE_DEPS
): Promise<QuoteLead> {
  const incoming = normalizeQuoteLeadInput(input, deps);
  const leads = await deps.readAll();
  const index = leads.findIndex((lead) => identityKey(lead) === identityKey(incoming));
  const now = deps.now();

  if (index === -1) {
    const next = [{ ...incoming, updatedAt: now }, ...leads].slice(0, MAX_STORED_QUOTE_LEADS);
    await deps.writeAll(next);
    return next[0];
  }

  const merged = mergeQuoteLead(leads[index], incoming, now);
  const next = [...leads];
  next[index] = merged;
  next.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  await deps.writeAll(next.slice(0, MAX_STORED_QUOTE_LEADS));
  return merged;
}

export async function listQuoteLeads(
  options: { status?: QuoteLeadStatus | 'all'; source?: string; q?: string; limit?: number } = {},
  deps: QuoteLeadStoreDeps = LIVE_DEPS
): Promise<Array<QuoteLead & { texto: string }>> {
  const status = options.status || 'new';
  const source = cleanText(options.source || 'all');
  const query = cleanText(options.q).toLowerCase();
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(Number(options.limit), 100))
    : 20;
  const leads = await deps.readAll();
  return leads
    .filter((lead) => status === 'all' || lead.status === status)
    .filter((lead) => source === 'all' || !source || lead.source === source)
    .filter((lead) => {
      if (!query) return true;
      return [lead.nome, lead.email, lead.telefone, lead.pedidoTexto]
        .join(' ')
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit)
    .map((lead) => ({ ...lead, texto: formatQuoteLeadText(lead) }));
}

export async function updateQuoteLead(
  id: string,
  patch: Partial<QuoteLead> & { status?: QuoteLeadStatus; quotationId?: string | null },
  deps: QuoteLeadStoreDeps = LIVE_DEPS
): Promise<QuoteLead & { texto: string }> {
  const leads = await deps.readAll();
  const index = leads.findIndex((lead) => lead.id === id);
  if (index === -1) throw createHttpError(404, 'Lead de orçamento não encontrado.');

  const current = leads[index];
  const editableInput = normalizeQuoteLeadInput({ ...current, ...patch, id: current.id }, deps);
  const missing = missingFieldsFor(editableInput);
  const updated: QuoteLead = {
    ...current,
    ...editableInput,
    id: current.id,
    status: patch.status ? statusFrom(patch.status, missing) : statusFrom(current.status, missing),
    quotationId:
      patch.quotationId === undefined ? current.quotationId : cleanText(patch.quotationId) || null,
    createdAt: current.createdAt,
    updatedAt: deps.now(),
  };

  const next = [...leads];
  next[index] = updated;
  await deps.writeAll(next);
  return { ...updated, texto: formatQuoteLeadText(updated) };
}
