// GET /api/quotations — quotation list + detail endpoint for the dashboard.
//
// List:  GET /api/quotations?page=1&limit=50&status=Open&search=joao&order_by=grand_total desc
// Detail: GET /api/quotations?id=ORC-20261143
//
// Follows contracts in .sisyphus/notepads/quotation-ops-dashboard/contracts.md Section 3.

import type { FunctionEvent, FunctionResult, ErpnextListItem, LegacyHandler } from '../_lib/types.js';
import {
  erpGetList,
  erpGetDoc,
  erpPut,
  erpDelete,
  erpCallMethod,
  createHttpError,
} from './lib/erpnext.js';
import { handler as coreHandler } from './quotations-core.js';
import { resolveEffectiveRolloutState } from './orcamento-mode.js';
import type { QuoteRolloutState } from './orcamento-mode.js';

// ── Constants ───────────────────────────────────────────────────────────────

const VALID_STATUSES = ['Draft', 'Open', 'Replied', 'Ordered', 'Lost', 'Expired', 'Cancelled'];
const ORDER_BY_ALLOWLIST = new Set([
  'creation desc',
  'creation asc',
  'transaction_date desc',
  'transaction_date asc',
  'name desc',
  'name asc',
  'grand_total desc',
  'grand_total asc',
  'valid_till desc',
  'valid_till asc',
]);
const ALL_STATUS_KEYS = ['Draft', 'Open', 'Replied', 'Ordered', 'Lost', 'Expired', 'Cancelled'];

const LIST_FIELDS = [
  'name',
  'transaction_date',
  'customer_name',
  'party_name',
  'quotation_to',
  'grand_total',
  'status',
  'docstatus',
  'valid_till',
];

// ── Build Filters ───────────────────────────────────────────────────────────

/**
 * Build ERPNext filters and or_filters arrays from query params.
 * Returns { filters, or_filters } for use with erpGetList.
 */
function buildListFilters(query: Record<string, string | undefined>) {
  const search = (query.search || '').trim();
  const status = (query.status || '').trim();

  const filters = [];

  if (status && VALID_STATUSES.includes(status)) {
    if (status === 'Draft') {
      filters.push(['docstatus', '=', 0]);
    } else if (status === 'Cancelled') {
      filters.push(['docstatus', '=', 2]);
    } else {
      // Open, Replied, Ordered, Lost, Expired — all docstatus=1
      filters.push(['docstatus', '=', 1], ['status', '=', status]);
    }
  } else {
    // No status filter: exclude cancelled by default
    filters.push(['docstatus', '!=', 2]);
  }

  // Search: OR-joined across name and customer_name
  let orFilters = null;
  if (search) {
    orFilters = [
      ['name', 'like', `%${search}%`],
      ['customer_name', 'like', `%${search}%`],
    ];
  }

  return { filters, orFilters };
}

/**
 * Build or_filters for search only (no status/docstatus — used for status summary).
 */
function buildSearchOrFilters(query: Record<string, string | undefined>) {
  const search = (query.search || '').trim();
  if (!search) return null;
  return [
    ['name', 'like', `%${search}%`],
    ['customer_name', 'like', `%${search}%`],
  ];
}

// ── Client Name Resolution ─────────────────────────────────────────────────

/**
 * Batch-resolve client display names for quotations.
 * For Lead-type quotations where customer_name starts with "CRM-LEAD-",
 * fetches the real lead_name from the Lead doctype.
 *
 * Modifies the input array in-place and returns it.
 */
async function resolveClientNames(quotations: ErpnextListItem[]): Promise<ErpnextListItem[]> {
  // Collect lead IDs that need resolution
  const leadIds = new Set<string>();
  for (const q of quotations) {
    const qtr = q as Record<string, any>;
    if (
      qtr.quotation_to === 'Lead' &&
      qtr.party_name &&
      (!qtr.customer_name || qtr.customer_name.startsWith('CRM-LEAD-'))
    ) {
      leadIds.add(qtr.party_name);
    }
  }

  if (leadIds.size === 0) return quotations;

  // Batch-fetch all leads in parallel
  const leadMap = new Map<string, string | null>();
  const fetchPromises = [...leadIds].map(async (leadId: string) => {
    try {
      const lead = await erpGetDoc('Lead', leadId, { fields: ['lead_name', 'first_name'] });
      if (lead) {
        leadMap.set(leadId, lead.first_name || lead.lead_name || null);
      }
      return;
    } catch (err: any) {
      console.warn(
        '[quotations] Lead resolve failed for',
        leadId,
        err?.logMessage || err?.message || err
      );
      return;
    }
  });
  await Promise.all(fetchPromises);

  // Apply resolved names
  for (const q of quotations) {
    const qtr = q as Record<string, any>;
    if (
      qtr.quotation_to === 'Lead' &&
      qtr.party_name &&
      (!qtr.customer_name || qtr.customer_name.startsWith('CRM-LEAD-'))
    ) {
      const resolved = leadMap.get(qtr.party_name);
      if (resolved) {
        qtr._resolved_client_name = resolved;
      }
    }
  }

  return quotations;
}

/**
 * Return the display client name for a single quotation row (after batch resolution).
 */
function clientDisplayName(q: Record<string, any>): string {
  // If Lead was resolved, use the resolved name
  if (q._resolved_client_name) return q._resolved_client_name;
  // If Customer with a real name, use it
  if (q.quotation_to === 'Customer' && q.customer_name && q.customer_name.trim()) {
    return q.customer_name;
  }
  // Fallback to customer_name or party_name
  return q.customer_name || q.party_name || '';
}

// ── Status Summary ──────────────────────────────────────────────────────────

/**
 * Fetch all quotations matching the search term (no status/docstatus filter),
 * group by status, and return the counts for all 7 status categories.
 */
async function computeStatusSummary(query: Record<string, string | undefined>) {
  const orFilters = buildSearchOrFilters(query);

  const allDocs = await erpGetList('Quotation', {
    fields: ['name', 'status', 'docstatus'],
    or_filters: orFilters || undefined,
    limit: 10000,
  });

  const summary = Object.fromEntries(ALL_STATUS_KEYS.map((k) => [k, 0]));
  for (const doc of allDocs) {
    const d = doc as Record<string, any>;
    if (d.docstatus === 0) summary.Draft++;
    else if (d.docstatus === 2) summary.Cancelled++;
    else if (d.status && summary[d.status as keyof typeof summary] !== undefined)
      summary[d.status as keyof typeof summary]++;
  }
  return summary;
}

// ── Parameter Validation ────────────────────────────────────────────────────

function validateListParams(query: Record<string, string | undefined>) {
  // status
  const status = (query.status || '').trim();
  if (status && !VALID_STATUSES.includes(status)) {
    throw createHttpError(
      400,
      'Status inválido. Valores aceitos: ' + VALID_STATUSES.join(', '),
      `[quotations] invalid status: "${status}"`
    );
  }

  // order_by
  const orderBy = (query.order_by || '').trim();
  if (orderBy && !ORDER_BY_ALLOWLIST.has(orderBy)) {
    throw createHttpError(
      400,
      'Ordenação inválida.',
      `[quotations] invalid order_by: "${orderBy}"`
    );
  }

  // page
  let page = parseInt(query.page || '', 10);
  if (isNaN(page) || page === 0) page = 1;
  if (page < 1) {
    throw createHttpError(400, 'Página inválida.', `[quotations] invalid page: ${query.page}`);
  }

  // limit
  let limit = parseInt(query.limit || '', 10);
  if (isNaN(limit) || limit === 0) limit = 50;
  if (limit > 200) {
    throw createHttpError(
      400,
      'Limite máximo é 200 registros por página.',
      `[quotations] limit exceeds 200: ${limit}`
    );
  }

  return { status, orderBy: orderBy || 'creation desc', page, limit };
}

// ── Detail Endpoint ─────────────────────────────────────────────────────────

async function handleDetail(quotationId: string) {
  let quotation;
  try {
    quotation = await erpGetDoc('Quotation', quotationId);
  } catch (err: any) {
    throw createHttpError(
      err?.statusCode === 404 ? 404 : 502,
      'Orçamento não encontrado.',
      `[quotations] erpGetDoc(${quotationId}) failed: ${err?.logMessage || err?.message || err}`
    );
  }

  if (!quotation) {
    throw createHttpError(
      404,
      'Orçamento não encontrado.',
      `[quotations] null response for ${quotationId}`
    );
  }

  // Resolve client name
  let cliente = quotation.customer_name || '';
  if (
    quotation.quotation_to === 'Lead' &&
    quotation.party_name &&
    (!cliente || cliente.startsWith('CRM-LEAD-'))
  ) {
    try {
      const lead = await erpGetDoc('Lead', quotation.party_name, {
        fields: ['lead_name', 'first_name'],
      });
      if (lead) {
        cliente = lead.first_name || lead.lead_name || cliente;
      }
    } catch (err: any) {
      console.warn(
        '[quotations] Lead resolve failed for detail',
        quotationId,
        err?.logMessage || err?.message || err
      );
    }
  }

  // Map items
  const items = (quotation.items || []).map((item: Record<string, any>) => ({
    item_code: item.item_code || '',
    item_name: item.item_name || '',
    qty: item.qty ?? 0,
    rate: item.rate ?? 0,
    amount: item.amount ?? 0,
    uom: item.uom || item.stock_uom || '',
  }));

  // Check for linked Sales Order via Sales Order Item.prevdoc_docname
  let sales_order_id = null;
  try {
    const soItems = await erpGetList('Sales Order Item', {
      filters: [['prevdoc_docname', '=', quotationId]],
      fields: ['parent'],
      limit: 5,
    });
    if (soItems.length > 0) {
      // Load the first parent Sales Order to check it's not cancelled
      const so = await erpGetDoc('Sales Order', soItems[0].parent);
      if (so && so.docstatus !== 2) {
        sales_order_id = so.name;
      }
    }
  } catch (err: any) {
    console.warn('[quotations] SO link lookup failed:', err?.logMessage || err?.message || err);
  }

  return {
    id: quotation.name,
    data: quotation.transaction_date || '',
    cliente,
    tipo_entidade: quotation.quotation_to || '',
    entidade_id: quotation.party_name || '',
    valor: quotation.grand_total ?? 0,
    status: quotation.status || '',
    docstatus: quotation.docstatus ?? 0,
    validade: quotation.valid_till || '',
    email: quotation.contact_email || '',
    telefone: quotation.contact_mobile || '',
    items,
    sales_order_id,
  };
}

// ── Update Endpoint ─────────────────────────────────────────────────────────

/**
 * PUT /api/quotations?id=ORC-20261143
 * Replaces quotation items (child table) via ERPNext PUT.
 * Always sets ignore_pricing_rule=1 to prevent rate recalculation.
 */
async function handleUpdate(quotationId: string, payload: Record<string, unknown>) {
  const items = (payload.items as Array<Record<string, unknown>>) || [];
  if (items.length === 0) {
    throw createHttpError(400, 'Campo "items" obrigatório (array não vazio).');
  }

  // Validate each item
  for (const item of items) {
    if (!item.item_code) {
      throw createHttpError(400, 'Cada item deve ter "item_code".');
    }
    if (typeof item.qty !== 'number' || item.qty <= 0) {
      throw createHttpError(400, 'Cada item deve ter "qty" (número > 0).');
    }
    if (typeof item.rate !== 'number' || item.rate < 0) {
      throw createHttpError(400, 'Cada item deve ter "rate" (número >= 0).');
    }
  }

  // Build update payload — child table replacement
  const updatePayload = {
    items: items.map((item) => ({
      item_code: item.item_code,
      item_name: item.item_name || '', // ERPNext requires item_name on child table rows
      qty: item.qty,
      rate: item.rate,
      ...(item.uom ? { uom: item.uom } : {}), // Only include uom if explicitly set; else ERPNext auto-derives from item stock_uom
    })),
    ignore_pricing_rule: 1,
  };

  try {
    await erpPut('Quotation', quotationId, updatePayload);
  } catch (err: any) {
    throw createHttpError(
      err?.statusCode === 400 ? 400 : 502,
      'Erro ao salvar alterações no orçamento.',
      `[quotations] erpPut(${quotationId}) failed: ${err?.logMessage || err?.message || err}`
    );
  }

  // Fetch and return the updated quotation (same shape as detail)
  return handleDetail(quotationId);
}

// ── List Endpoint ───────────────────────────────────────────────────────────

async function handleList(query: Record<string, string | undefined>) {
  const { orderBy, page, limit } = validateListParams(query);
  const { filters, orFilters } = buildListFilters(query);
  const start = (page - 1) * limit;

  // 1. Fetch paginated data
  const rawQuotations = await erpGetList('Quotation', {
    fields: LIST_FIELDS,
    filters,
    or_filters: orFilters || undefined,
    order_by: orderBy,
    limit,
    start,
  });

  // 2. Count total (same filters, no pagination)
  const countDocs = await erpGetList('Quotation', {
    fields: ['name'],
    filters,
    or_filters: orFilters || undefined,
    limit: 10000,
  });
  const total = countDocs.length;

  // 3. Status summary (search only, no status/docstatus filter, no pagination)
  const statusSummary = await computeStatusSummary(query);

  // 4. Resolve client names
  await resolveClientNames(rawQuotations);

  // 5. Map to response shape
  const data = rawQuotations.map((q: Record<string, any>) => ({
    id: q.name,
    data: q.transaction_date || '',
    cliente: clientDisplayName(q),
    tipo_entidade: q.quotation_to || '',
    entidade_id: q.party_name || '',
    valor: q.grand_total ?? 0,
    status: q.status || '',
    docstatus: q.docstatus ?? 0,
    validade: q.valid_till || '',
  }));

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
    status_summary: statusSummary,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

async function legacyHandler(event: FunctionEvent): Promise<FunctionResult> {
  const query = event.queryStringParameters || {};

  try {
    // DELETE: Remove quotation — DELETE /api/quotations?id=ORC-20261143
    if (event.httpMethod === 'DELETE' && query.id) {
      const deleteId: string = query.id;
      // If submitted (docstatus=1), cancel first — ERPNext doesn't allow direct deletion
      const quotation = await erpGetDoc('Quotation', query.id);
      if (quotation && (quotation as Record<string, unknown>).docstatus === 1) {
        try {
          await erpCallMethod('frappe.client.cancel', {
            doctype: 'Quotation',
            name: deleteId,
          });
        } catch (cancelErr: any) {
          throw createHttpError(
            400,
            'Não foi possível cancelar o orçamento antes de excluir. Verifique se há documentos vinculados.',
            `[quotations] cancel ${query.id} failed: ${cancelErr?.logMessage || cancelErr?.message || cancelErr}`
          );
        }
      }
      await erpDelete('Quotation', deleteId);
      const result: FunctionResult = {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, id: deleteId }),
      };
      return result;
    }

    // PUT: Update quotation items — /api/quotations?id=ORC-20261143
    if (event.httpMethod === 'PUT' && query.id) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'JSON inválido' }),
        } as FunctionResult;
      }
      const detail = await handleUpdate(query.id, payload);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(detail),
      };
    }

    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // GET Detail: /api/quotations?id=ORC-20261143
    if (query.id) {
      const detail = await handleDetail(query.id);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(detail),
      };
    }

    // GET List: /api/quotations?page=1&limit=50...
    const list = await handleList(query);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(list),
    };
  } catch (err) {
    const httpErr = err as { statusCode?: number; logMessage?: string; message?: string };
    const code = Number.isInteger(httpErr?.statusCode) ? httpErr.statusCode! : 500;
    console.error('[quotations]', httpErr?.logMessage || httpErr?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: httpErr?.message || 'Erro interno.' }),
    };
  }
}

export interface QuotationsHandlerDependencies {
  core?: LegacyHandler;
  legacy?: LegacyHandler;
}

function addSourceHeaders(result: FunctionResult, source: 'postgres' | 'frappe'): FunctionResult {
  if (!result.headers) result.headers = {} as Record<string, string>;
  (result.headers as Record<string, string>)['X-Quote-Source'] = source;
  return result;
}

/** Feature-flagged boundary. Core failures are returned unchanged and never
 * fall back to Frappe (except in rollback-compatible mode for GET where a
 * missing PostgreSQL record triggers a selective, observable Frappe fallback).
 * The effective rollout state selects the dispatch path:
 * - postgres-write: core handler (read+write via PostgreSQL)
 * - postgres-read-only: core for reads, legacy for writes
 * - rollback-compatible: core for reads with Frappe fallback, legacy for writes
 * - legacy: legacy handler (Frappe)
 */
export function createHandler(dependencies: QuotationsHandlerDependencies = {}): LegacyHandler {
  const selectedCore = dependencies.core || coreHandler;
  const selectedLegacy = dependencies.legacy || legacyHandler;
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    const state: QuoteRolloutState = resolveEffectiveRolloutState();
    if (state === 'postgres-write') return selectedCore(event);
    if (state === 'postgres-read-only' || state === 'rollback-compatible') {
      if (event.httpMethod === 'GET') {
        if (state === 'rollback-compatible') {
          // Try PostgreSQL first; fall back to Frappe for legacy/absent records
          const coreResult = await selectedCore(event);
          if (coreResult.statusCode !== 404) return addSourceHeaders(coreResult, 'postgres');
          return addSourceHeaders(await selectedLegacy(event), 'frappe');
        }
        return selectedCore(event);
      }
      return selectedLegacy(event);
    }
    return selectedLegacy(event);
  };
}

export const handler = createHandler();
