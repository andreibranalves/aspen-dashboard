import { apiGet, apiPatch, apiPost } from '@/lib/api';

export type PreQuoteStatus =
  | 'new'
  | 'incomplete'
  | 'ready'
  | 'reviewing'
  | 'converted'
  | 'discarded';

export interface PreQuoteAttribution {
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

export interface PreQuoteLead {
  id: string;
  nome?: string;
  email?: string;
  telefone?: string;
  empresa?: string;
  pedidoTexto?: string;
  texto?: string;
  produto?: string;
  quantidade?: string;
  finalidade?: string;
  prazo?: string;
  arte?: string;
  source?: string;
  sourceDetail?: string;
  status?: PreQuoteStatus;
  erpLeadId?: string | null;
  quotationId?: string | null;
  externalId?: string | null;
  attribution?: PreQuoteAttribution;
  missingFields?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PreQuoteFilters {
  status?: PreQuoteStatus | 'all';
  source?: string;
  q?: string;
  limit?: number;
}

export async function fetchPreQuotes(filters: PreQuoteFilters = {}): Promise<PreQuoteLead[]> {
  const params = new URLSearchParams();
  params.set('status', filters.status || 'new');
  params.set('source', filters.source || 'all');
  params.set('limit', String(filters.limit || 50));
  if (filters.q) params.set('q', filters.q);

  const res = await apiGet<{ data?: PreQuoteLead[] }>(`/quote-leads?${params.toString()}`);
  return Array.isArray(res.data) ? res.data : [];
}

export async function updatePreQuote(
  id: string,
  patch: Partial<PreQuoteLead>
): Promise<PreQuoteLead> {
  const res = await apiPatch<{ data: PreQuoteLead }>('/quote-leads', { id, ...patch });
  return res.data;
}

export async function createPreQuote(input: Partial<PreQuoteLead>): Promise<PreQuoteLead> {
  const res = await apiPost<{ data: PreQuoteLead }>('/quote-leads', input);
  return res.data;
}
