import { kv } from '@vercel/kv';
import { createHttpError } from './erpnext.js';

export type QuoteLeadStatus = 'new' | 'converted' | 'discarded';

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
  '1': 'Lenços', '2': 'Cangas', '3': 'Bolsas',
  '4': 'Toalhas', '5': 'Chapéus', '6': 'Cachecóis', '7': 'Outros',
};

function resolveProduto(value: unknown): string {
  const raw = cleanText(value);
  return PRODUTO_MAP[raw] || raw;
}

function buildPedidoTexto(input: Record<string, unknown>): string {
  const explicit = cleanMultilineText(
    input.pedidoTexto || input.pedido || input.message || input.mensagem
  );
  if (explicit) return explicit;
  return [
    input.produto ? `Produto: ${resolveProduto(input.produto)}` : '',
    input.quantidade ? `Quantidade: ${cleanText(input.quantidade)}` : '',
    input.finalidade ? `Finalidade: ${cleanText(input.finalidade)}` : '',
    input.prazo ? `Prazo: ${cleanText(input.prazo)}` : '',
    input.arte ? `Arte: ${cleanText(input.arte)}` : '',
    input.mensagem_contexto ? `Contexto: ${cleanText(input.mensagem_contexto)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function statusFrom(value: unknown): QuoteLeadStatus {
  return value === 'converted' || value === 'discarded' ? value : 'new';
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
  return {
    id: cleanText(input.id) || deps.id(),
    nome: cleanText(input.nome || input.name),
    email: normalizeEmail(input.email),
    telefone: normalizePhone(input.telefone || input.phone || input.whatsapp),
    pedidoTexto: buildPedidoTexto(input),
    source: cleanText(input.source || input.origem || 'typebot'),
    status: statusFrom(input.status),
    erpLeadId: cleanText(input.erpLeadId || input.lead_id || input.leadId) || null,
    quotationId: cleanText(input.quotationId || input.quotation_id) || null,
    createdAt: cleanText(input.createdAt) || now,
    updatedAt: cleanText(input.updatedAt) || now,
  };
}

function identityKey(lead: QuoteLead): string {
  if (lead.telefone) return `phone:${localPhone(lead.telefone)}`;
  if (lead.email) return `email:${lead.email}`;
  if (lead.erpLeadId) return `erp:${lead.erpLeadId}`;
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

function mergeQuoteLead(existing: QuoteLead, incoming: QuoteLead, now: string): QuoteLead {
  const primary = score(incoming) >= score(existing) ? incoming : existing;
  const secondary = primary === incoming ? existing : incoming;
  return {
    ...primary,
    id: existing.id,
    nome: primary.nome || secondary.nome,
    email: primary.email || secondary.email,
    telefone: primary.telefone || secondary.telefone,
    pedidoTexto: primary.pedidoTexto || secondary.pedidoTexto,
    source: primary.source || secondary.source,
    status:
      existing.status === 'converted' || incoming.status === 'converted'
        ? 'converted'
        : primary.status,
    erpLeadId: primary.erpLeadId || secondary.erpLeadId || null,
    quotationId: primary.quotationId || secondary.quotationId || null,
    createdAt: existing.createdAt,
    updatedAt: now,
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
  options: { status?: QuoteLeadStatus | 'all'; limit?: number } = {},
  deps: QuoteLeadStoreDeps = LIVE_DEPS
): Promise<Array<QuoteLead & { texto: string }>> {
  const status = options.status || 'new';
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(Number(options.limit), 50))
    : 5;
  const leads = await deps.readAll();
  return leads
    .filter((lead) => status === 'all' || lead.status === status)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit)
    .map((lead) => ({ ...lead, texto: formatQuoteLeadText(lead) }));
}

export async function updateQuoteLead(
  id: string,
  patch: { status?: QuoteLeadStatus; quotationId?: string | null },
  deps: QuoteLeadStoreDeps = LIVE_DEPS
): Promise<QuoteLead & { texto: string }> {
  const leads = await deps.readAll();
  const index = leads.findIndex((lead) => lead.id === id);
  if (index === -1) throw createHttpError(404, 'Lead de orçamento não encontrado.');

  const current = leads[index];
  const updated: QuoteLead = {
    ...current,
    status: patch.status ? statusFrom(patch.status) : current.status,
    quotationId:
      patch.quotationId === undefined ? current.quotationId : cleanText(patch.quotationId) || null,
    updatedAt: deps.now(),
  };

  const next = [...leads];
  next[index] = updated;
  await deps.writeAll(next);
  return { ...updated, texto: formatQuoteLeadText(updated) };
}
