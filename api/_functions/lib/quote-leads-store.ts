import { kv } from '@vercel/kv';
import { createHttpError } from '../../_shared/http-error.js';
import {
  formatQuoteLeadText,
  mergeQuoteLead,
  normalizeQuoteLeadInput as normalizePureQuoteLeadInput,
  quoteLeadIdentityKey,
  type QuoteLead,
  type QuoteLeadAttribution,
  type QuoteLeadClockDeps,
  type QuoteLeadStatus,
} from './quote-leads-pure.js';

export { formatQuoteLeadText, mergeQuoteLead, quoteLeadIdentityKey };
export type { QuoteLead, QuoteLeadAttribution, QuoteLeadClockDeps, QuoteLeadStatus };

export interface QuoteLeadStoreDeps extends QuoteLeadClockDeps {
  readAll: () => Promise<QuoteLead[]>;
  writeAll: (leads: QuoteLead[]) => Promise<void>;
}

const KV_KEY_QUOTE_LEADS = 'aspen:quote-leads';
const MAX_STORED_QUOTE_LEADS = 200;

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
  return normalizePureQuoteLeadInput(input, deps);
}

export async function upsertQuoteLead(
  input: Record<string, unknown>,
  deps: QuoteLeadStoreDeps = LIVE_DEPS
): Promise<QuoteLead> {
  const incoming = normalizeQuoteLeadInput(input, deps);
  const leads = await deps.readAll();
  const index = leads.findIndex(
    (lead) => quoteLeadIdentityKey(lead) === quoteLeadIdentityKey(incoming)
  );
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
  const source = String(options.source || 'all').trim();
  const query = String(options.q || '')
    .trim()
    .toLowerCase();
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
  const missing = editableInput.missingFields || [];
  const updated: QuoteLead = {
    ...current,
    ...editableInput,
    id: current.id,
    status: patch.status ? editableInput.status : current.status,
    quotationId:
      patch.quotationId === undefined
        ? current.quotationId
        : String(patch.quotationId || '').trim() || null,
    createdAt: current.createdAt,
    updatedAt: deps.now(),
    missingFields: missing,
  };

  const next = [...leads];
  next[index] = updated;
  await deps.writeAll(next);
  return { ...updated, texto: formatQuoteLeadText(updated) };
}
