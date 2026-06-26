import { createHttpError } from './erpnext.js';

export const PRUNE_TARGET_STATUS = 'Orcamento Enviado';
export const PRUNE_LOST_STATUS = 'Perdido';
export const PRUNE_THRESHOLD_DAYS = 30;
export const PRUNE_PROTECT_RECENT_DAYS = 7;
export const PRUNE_NEXT_STEP =
  'Marcado como perdido por limpeza de pipeline: sem resposta após 30 dias.';

export interface CrmPruneCandidate {
  deal_id: string;
  lead_name: string;
  quotation: string;
  quotation_date: string;
  age_days: number;
  deal_modified: string;
  grand_total: number;
}

export interface CrmPruneResult {
  success: true;
  updated: number;
  skipped: number;
  skipped_deals: Array<{ deal_id: string; reason: string }>;
}

export interface CrmPruneDeps {
  erpGetList: (
    doctype: string,
    opts?: {
      fields?: string[];
      filters?: Array<Array<any>>;
      order_by?: string;
      limit?: number;
    }
  ) => Promise<Array<Record<string, any>>>;
  erpPut: (
    doctype: string,
    name: string,
    payload: Record<string, unknown>
  ) => Promise<Record<string, any>>;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseTime(value: unknown): number {
  if (!value || typeof value !== 'string') return Number.NaN;
  return new Date(value).getTime();
}

function ageInDays(date: string, now: Date): number {
  const time = parseTime(`${date}T00:00:00.000Z`);
  if (Number.isNaN(time)) return -1;
  return Math.floor((now.getTime() - time) / (1000 * 60 * 60 * 24));
}

function isRecentlyModified(modified: unknown, now: Date): boolean {
  const time = parseTime(modified);
  if (Number.isNaN(time)) return false;
  const protectAfter = addDays(now, -PRUNE_PROTECT_RECENT_DAYS).getTime();
  return time > protectAfter;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseDealIds(payload: unknown): string[] {
  const dealIds = (payload as { deal_ids?: unknown })?.deal_ids;
  if (!Array.isArray(dealIds)) {
    throw createHttpError(400, 'deal_ids deve ser uma lista de oportunidades.');
  }

  const unique = Array.from(new Set(dealIds.map(cleanString).filter(Boolean)));

  if (unique.length === 0) {
    throw createHttpError(400, 'Selecione ao menos uma oportunidade para limpar.');
  }

  return unique;
}

const BATCH_SIZE = 50; // keep URL query string under ERPNext's nginx limit

/**
 * Execute an erpGetList call with an `in` filter, splitting large value arrays
 * into batches to avoid URL-length errors from ERPNext's nginx.
 */
async function batchInQuery(
  doctype: string,
  field: string,
  values: string[],
  extraFilters: Array<Array<any>>,
  deps: Pick<CrmPruneDeps, 'erpGetList'>,
  fields?: string[]
): Promise<Array<Record<string, any>>> {
  if (values.length === 0) return [];

  const results: Array<Record<string, any>> = [];
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const chunk = values.slice(i, i + BATCH_SIZE);
    const chunkResults = await deps.erpGetList(doctype, {
      fields,
      filters: [[field, 'in', chunk], ...extraFilters],
      order_by: 'creation desc',
      limit: BATCH_SIZE,
    });
    results.push(...chunkResults);
  }
  return results;
}

async function fetchLinkedQuotationNames(
  quotationNames: string[],
  deps: Pick<CrmPruneDeps, 'erpGetList'>
): Promise<Set<string>> {
  if (quotationNames.length === 0) return new Set();

  const rows = await batchInQuery('Sales Order Item', 'prevdoc_docname', quotationNames, [], deps, [
    'prevdoc_docname',
  ]);

  return new Set(rows.map((row) => cleanString(row.prevdoc_docname)).filter(Boolean));
}

export async function getPruneCandidates(
  deps: Pick<CrmPruneDeps, 'erpGetList'>,
  now = new Date()
): Promise<CrmPruneCandidate[]> {
  const deals = await deps.erpGetList('CRM Deal', {
    fields: ['name', 'lead_name', 'status', 'custom_quotation', 'modified'],
    filters: [['status', '=', PRUNE_TARGET_STATUS]],
    order_by: 'modified asc',
    limit: 10000,
  });

  const oldEnoughCutoff = dateOnly(addDays(now, -PRUNE_THRESHOLD_DAYS));
  const dealsByQuotation = new Map<string, Record<string, any>>();

  for (const deal of deals) {
    const quotation = cleanString(deal.custom_quotation);
    if (!quotation) continue;
    if (cleanString(deal.status) !== PRUNE_TARGET_STATUS) continue;
    if (isRecentlyModified(deal.modified, now)) continue;
    if (!dealsByQuotation.has(quotation)) dealsByQuotation.set(quotation, deal);
  }

  const quotationNames = Array.from(dealsByQuotation.keys());
  if (quotationNames.length === 0) return [];

  const quotations = await batchInQuery(
    'Quotation',
    'name',
    quotationNames,
    [['transaction_date', '<=', oldEnoughCutoff]],
    deps,
    ['name', 'transaction_date', 'grand_total', 'status']
  );

  let linkedQuotationNames: Set<string>;
  try {
    linkedQuotationNames = await fetchLinkedQuotationNames(quotationNames, deps);
  } catch {
    // Permission error on Sales Order Item — treat all as not linked (safe: won't falsely exclude)
    console.warn('[crm-prune] Cannot access Sales Order Item for linked quotation check.');
    linkedQuotationNames = new Set();
  }

  return quotations
    .filter((quotation) => !linkedQuotationNames.has(cleanString(quotation.name)))
    .map((quotation) => {
      const quotationName = cleanString(quotation.name);
      const deal = dealsByQuotation.get(quotationName) || {};
      const quotationDate = cleanString(quotation.transaction_date);

      return {
        deal_id: cleanString(deal.name),
        lead_name: cleanString(deal.lead_name) || 'Sem nome',
        quotation: quotationName,
        quotation_date: quotationDate,
        age_days: ageInDays(quotationDate, now),
        deal_modified: cleanString(deal.modified),
        grand_total: Number(quotation.grand_total || 0),
      };
    })
    .filter(
      (candidate) =>
        candidate.deal_id && candidate.quotation && candidate.age_days >= PRUNE_THRESHOLD_DAYS
    )
    .sort((a, b) => b.age_days - a.age_days);
}

export async function pruneDeals(
  dealIds: string[],
  deps: CrmPruneDeps,
  now = new Date()
): Promise<CrmPruneResult> {
  const selected = new Set(dealIds.map(cleanString).filter(Boolean));
  const eligible = new Set(
    (await getPruneCandidates(deps, now))
      .filter((candidate) => selected.has(candidate.deal_id))
      .map((candidate) => candidate.deal_id)
  );

  let updated = 0;
  const skipped_deals: Array<{ deal_id: string; reason: string }> = [];

  for (const dealId of selected) {
    if (!eligible.has(dealId)) {
      skipped_deals.push({ deal_id: dealId, reason: 'Deal não está mais elegível para limpeza.' });
      continue;
    }

    await deps.erpPut('CRM Deal', dealId, {
      status: PRUNE_LOST_STATUS,
      lost_reason: 'Unresponsive Prospect',
      next_step: PRUNE_NEXT_STEP,
    });
    updated += 1;
  }

  return {
    success: true,
    updated,
    skipped: skipped_deals.length,
    skipped_deals,
  };
}
