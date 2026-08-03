// GET /api/sales-orders — Sales Order list + detail endpoint for the dashboard.
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
//
// List:   GET /api/sales-orders?page=1&limit=25&period=30d&status=To%20Deliver&search=cliente
// Detail: GET /api/sales-orders?id=SAL-ORD-2026-00001
//
// Period shortcuts: today, 7d, 30d, 90d, month, last_month or custom from+to.
// Search: name, customer_name, customer (OR-joined).
// source_quotation is extracted from each Sales Order's items (prevdoc_docname).

import { erpGetList, erpGetDoc, createHttpError } from './lib/erpnext.js';
import { isOperationalMode } from './operational-mode.js';

// ── Constants ───────────────────────────────────────────────────────────────

const VALID_STATUSES = [
  'Draft',
  'To Deliver and Bill',
  'To Deliver',
  'To Bill',
  'Completed',
  'Cancelled',
  'Closed',
];

const LIST_FIELDS = [
  'name',
  'transaction_date',
  'customer',
  'customer_name',
  'grand_total',
  'rounded_total',
  'status',
  'docstatus',
  'delivery_date',
  'per_delivered',
  'per_billed',
  'creation',
  'modified',
];

const ITEM_FIELDS = ['item_code', 'item_name', 'qty', 'uom', 'rate', 'amount', 'prevdoc_docname'];

// ── Period Filter Helper ─────────────────────────────────────────────────────

/**
 * Convert period shortcut or custom from/to into { start, end } date strings.
 * Base field used in filters is `transaction_date`.
 *
 * @param {string} [period] - 'today' | '7d' | '30d' | '90d' | 'month' | 'last_month'
 * @param {string} [from] - Custom start date YYYY-MM-DD
 * @param {string} [to]   - Custom end date YYYY-MM-DD
 * @returns {{ start: string, end: string }}
 */
function getPeriodDates(period: string, from: string | undefined, to: string | undefined) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  let start;
  let end = today;

  const d = new Date(now);

  switch (period) {
    case 'today':
      start = today;
      break;
    case '7d':
      d.setDate(d.getDate() - 7);
      start = d.toISOString().slice(0, 10);
      break;
    case '30d':
      d.setDate(d.getDate() - 30);
      start = d.toISOString().slice(0, 10);
      break;
    case '90d':
      d.setDate(d.getDate() - 90);
      start = d.toISOString().slice(0, 10);
      break;
    case 'month':
      d.setDate(1);
      start = d.toISOString().slice(0, 10);
      break;
    case 'last_month':
      d.setMonth(d.getMonth() - 1, 1);
      start = d.toISOString().slice(0, 10);
      d.setMonth(d.getMonth() + 1, 0);
      end = d.toISOString().slice(0, 10);
      break;
    default:
      start = from || today;
      end = to || today;
  }

  return { start, end };
}

// ── Build Filters ───────────────────────────────────────────────────────────

/**
 * Build filters and or_filters arrays from query parameters.
 *
 * @param {object} query - Query string parameters
 * @returns {{ filters: Array, orFilters: Array|null }}
 */
function buildListFilters(query: Record<string, string | undefined>) {
  const search = (query.search || '').trim();
  const status = (query.status || '').trim();
  const period = (query.period || '').trim().toLowerCase();
  const from = (query.from || '').trim();
  const to = (query.to || '').trim();

  const filters: any[] = [];

  // ── Status filter ───────────────────────────────────────────────────────
  if (status && VALID_STATUSES.includes(status)) {
    if (status === 'Draft') {
      filters.push(['docstatus', '=', 0]);
    } else if (status === 'Cancelled') {
      filters.push(['docstatus', '=', 2]);
    } else {
      filters.push(['docstatus', '=', 1], ['status', '=', status]);
    }
  } else {
    // Default: exclude cancelled
    filters.push(['docstatus', '!=', 2]);
  }

  // ── Period filter (transaction_date range) ──────────────────────────────
  const { start, end } = getPeriodDates(period, from, to);
  if (start && end) {
    filters.push(['transaction_date', 'between', [start, end]]);
  }

  // ── Search ──────────────────────────────────────────────────────────────
  let orFilters = null;
  if (search) {
    orFilters = [
      ['name', 'like', `%${search}%`],
      ['customer_name', 'like', `%${search}%`],
      ['customer', 'like', `%${search}%`],
    ];
  }

  return { filters, orFilters };
}

// ── Source Quotation Extraction ─────────────────────────────────────────────

/**
 * Batch-load items for an array of Sales Orders and attach source_quotation.
 *
 * For each Sales Order, fetches its items (child table) and extracts the first
 * non-empty prevdoc_docname as the source_quotation.
 *
 * Mutates items in-place and returns them.
 *
 * @param {Array} orders - Sales Order objects (must have .name)
 * @returns {Promise<Array>}
 */
async function attachSourceQuotations(orders: Record<string, unknown>[]) {
  if (orders.length === 0) return orders;

  const fetchPromises = orders.map(async (order) => {
    try {
      const doc = await erpGetDoc('Sales Order', order.name as string, { fields: ITEM_FIELDS });
      const items = (doc?.items || []) as Record<string, unknown>[];
      // Find first non-empty prevdoc_docname
      const source =
        (items.find((item: Record<string, unknown>) => item.prevdoc_docname)?.prevdoc_docname as
          | string
          | undefined) || null;
      order.source_quotation = source;
    } catch (err: any) {
      console.warn(
        '[sales-orders] Failed to load items for',
        order.name,
        err?.logMessage || err?.message || err
      );
      order.source_quotation = null;
    }
  });

  await Promise.all(fetchPromises);
  return orders;
}

/**
 * Extract source_quotation from a single full Sales Order document (detail mode).
 *
 * @param {object} doc - Full Sales Order document from erpGetDoc
 * @returns {string|null}
 */
function getSourceQuotationFromDoc(doc: Record<string, unknown>) {
  const items = (doc?.items || []) as Record<string, unknown>[];
  const sourceItem = items.find((item: Record<string, unknown>) => item.prevdoc_docname);
  return (sourceItem?.prevdoc_docname as string) || null;
}

// ── Parameter Validation ────────────────────────────────────────────────────

function validateListParams(query: Record<string, string | undefined>) {
  // status
  const status = (query.status || '').trim();
  if (status && !VALID_STATUSES.includes(status)) {
    throw createHttpError(
      400,
      'Status inválido. Valores aceitos: ' + VALID_STATUSES.join(', '),
      `[sales-orders] invalid status: "${status}"`
    );
  }

  // page
  let page = parseInt(query.page || '', 10);
  if (isNaN(page) || page === 0) page = 1;
  if (page < 1) {
    throw createHttpError(400, 'Página inválida.', `[sales-orders] invalid page: ${query.page}`);
  }

  // limit
  let limit = parseInt(query.limit || '', 10);
  if (isNaN(limit) || limit === 0) limit = 25;
  if (limit > 200) {
    throw createHttpError(
      400,
      'Limite máximo é 200 registros por página.',
      `[sales-orders] limit exceeds 200: ${limit}`
    );
  }

  return { status, page, limit };
}

// ── Detail Endpoint ─────────────────────────────────────────────────────────

async function handleDetail(orderId: string) {
  let order;
  try {
    order = await erpGetDoc('Sales Order', orderId);
  } catch (err: any) {
    throw createHttpError(
      err?.statusCode === 404 ? 404 : 502,
      'Pedido de Venda não encontrado.',
      `[sales-orders] erpGetDoc(${orderId}) failed: ${err?.logMessage || err?.message || err}`
    );
  }

  if (!order) {
    throw createHttpError(
      404,
      'Pedido de Venda não encontrado.',
      `[sales-orders] null response for ${orderId}`
    );
  }

  // Map items with per-item source_quotation
  const items = ((order.items || []) as Record<string, unknown>[]).map(
    (item: Record<string, unknown>) => ({
      item_code: item.item_code || '',
      item_name: item.item_name || '',
      qty: item.qty ?? 0,
      uom: item.uom || '',
      rate: item.rate ?? 0,
      amount: item.amount ?? 0,
      source_quotation: item.prevdoc_docname || null,
    })
  );

  const sourceQuotation = getSourceQuotationFromDoc(order);

  return {
    id: order.name,
    date: order.transaction_date || '',
    customer: order.customer || '',
    customer_name: order.customer_name || '',
    grand_total: order.grand_total ?? 0,
    rounded_total: order.rounded_total ?? 0,
    status: order.status || '',
    docstatus: order.docstatus ?? 0,
    delivery_date: order.delivery_date || '',
    per_delivered: order.per_delivered ?? 0,
    per_billed: order.per_billed ?? 0,
    source_quotation: sourceQuotation,
    items,
  };
}

// ── List Endpoint ───────────────────────────────────────────────────────────

async function handleList(query: Record<string, string | undefined>) {
  const { page, limit } = validateListParams(query);
  const { filters, orFilters } = buildListFilters(query);
  const start = (page - 1) * limit;

  // 1. Fetch paginated data
  const rawOrders = await erpGetList('Sales Order', {
    fields: LIST_FIELDS,
    filters,
    or_filters: orFilters || undefined,
    order_by: 'transaction_date desc',
    limit,
    start,
  });

  // 2. Count total (same filters, no pagination)
  const countDocs = await erpGetList('Sales Order', {
    fields: ['name'],
    filters,
    or_filters: orFilters || undefined,
    limit: 10000,
  });
  const total = countDocs.length;

  // 3. Attach source_quotation from items (batch-load)
  await attachSourceQuotations(rawOrders);

  // 4. Map to response shape
  const items = rawOrders.map((o) => ({
    id: o.name,
    date: o.transaction_date || '',
    customer: o.customer || '',
    customer_name: o.customer_name || '',
    grand_total: o.grand_total ?? 0,
    status: o.status || '',
    docstatus: o.docstatus ?? 0,
    delivery_date: o.delivery_date || '',
    per_delivered: o.per_delivered ?? 0,
    per_billed: o.per_billed ?? 0,
    source_quotation: o.source_quotation,
  }));

  const hasMore = start + limit < total;

  return {
    success: true,
    items,
    page,
    limit,
    has_more: hasMore,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (isOperationalMode()) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'sales-orders não está disponível no modo operacional.' }) };
  }
  // GET only
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const qs = event.queryStringParameters || {};

    // GET Detail: /api/sales-orders?id=SAL-ORD-2026-00001
    if (qs.id) {
      const detail = await handleDetail(qs.id);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(detail),
      };
    }

    // GET List: /api/sales-orders?page=1&limit=25...
    const list = await handleList(qs);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(list),
    };
  } catch (err: any) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[sales-orders]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.statusCode ? err.message : 'Erro interno.' }),
    };
  }
}
