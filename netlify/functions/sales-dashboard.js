// GET /api/sales-dashboard — aggregated sales metrics for the dashboard.
//
// Period shortcuts: today, 7d, 30d, 90d, month, last_month or custom from+to.
// Returns summary, top products/customers, sales by day, stale quotations, conversion rate.

import { erpGetList, createHttpError } from './lib/erpnext.js';

// ── Constants ───────────────────────────────────────────────────────────────

const PERIOD_LABELS = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  month: 'Este mês',
  last_month: 'Mês passado',
};

const SO_FIELDS = [
  'name', 'transaction_date', 'customer', 'customer_name',
  'grand_total', 'rounded_total', 'status', 'docstatus',
];

const ITEM_FIELDS = [
  'item_code', 'item_name', 'qty', 'amount', 'parent', 'prevdoc_docname',
];

// ── Period Helpers ──────────────────────────────────────────────────────────

/**
 * Convert period shortcut or custom from/to into { start, end } date strings.
 */
function getPeriodDates(period, from, to) {
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

/**
 * Return a human-readable Portuguese label for the period.
 */
function getPeriodLabel(period, from, to) {
  if (period && PERIOD_LABELS[period]) {
    return PERIOD_LABELS[period];
  }

  const fmt = (d) => {
    const parts = d.split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  };

  const today = new Date().toISOString().slice(0, 10);
  const start = from || today;
  const end = to || today;

  if (start === end) return fmt(start);
  return `De ${fmt(start)} a ${fmt(end)}`;
}

/**
 * Given a period [start, end], return the same-length period immediately before.
 */
function getPreviousPeriodDates(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  // Inclusive length in days
  const diffDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  const prevEnd = new Date(s.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (diffDays - 1) * 86400000);
  return {
    start: prevStart.toISOString().slice(0, 10),
    end: prevEnd.toISOString().slice(0, 10),
  };
}

// ── Data Fetching ───────────────────────────────────────────────────────────

/**
 * Fetch submitted Sales Orders in a date range, sorted ascending by date.
 */
async function fetchSalesOrders(start, end) {
  return erpGetList('Sales Order', {
    fields: SO_FIELDS,
    filters: [
      ['transaction_date', 'between', [start, end]],
      ['docstatus', '=', 1],
    ],
    order_by: 'transaction_date asc',
    limit: 10000,
  });
}

/**
 * Fetch child-table items for a list of Sales Order names.
 * Uses the 'in' filter to get all items in a single request.
 */
async function fetchSalesOrderItems(orderNames) {
  if (!orderNames || orderNames.length === 0) return [];
  return erpGetList('Sales Order Item', {
    fields: ITEM_FIELDS,
    filters: [['parent', 'in', orderNames]],
    limit: 10000,
  });
}

// ── Summary ─────────────────────────────────────────────────────────────────

/**
 * Compute revenue, orders count, average ticket, and open orders.
 *
 * @param {Array} orders - Submitted SOs (docstatus=1) in the period.
 * @returns {{ revenue: number, ordersCount: number, averageTicket: number, openOrders: number }}
 */
function computeSummary(orders) {
  // Revenue excludes Closed status
  const revenueOrders = orders.filter(o => o.status !== 'Closed');
  const revenue = revenueOrders.reduce(
    (sum, o) => sum + (o.rounded_total || o.grand_total || 0),
    0,
  );
  const ordersCount = orders.length;
  const averageTicket = ordersCount > 0 ? revenue / ordersCount : 0;
  const openOrders = orders.filter(
    o => !['Completed', 'Cancelled', 'Closed'].includes(o.status),
  ).length;

  return { revenue, ordersCount, averageTicket, openOrders };
}

// ── Top Products ────────────────────────────────────────────────────────────

/**
 * Aggregate items by item_code: sum qty + revenue, count distinct orders.
 * Sorted by revenue descending, limited to 10.
 */
function computeTopProducts(items) {
  const grouped = new Map();

  for (const item of items) {
    const code = item.item_code;
    if (!code) continue;

    let g = grouped.get(code);
    if (!g) {
      g = {
        item_code: code,
        item_name: item.item_name || '',
        qty: 0,
        revenue: 0,
        orders: new Set(),
      };
      grouped.set(code, g);
    }

    g.qty += item.qty || 0;
    g.revenue += item.amount || 0;
    if (item.parent) g.orders.add(item.parent);
  }

  return Array.from(grouped.values())
    .map(g => ({ ...g, orders: g.orders.size }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

// ── Top Customers ───────────────────────────────────────────────────────────

/**
 * Aggregate orders by customer: sum revenue, count orders.
 * Sorted by revenue descending, limited to 10.
 */
function computeTopCustomers(orders) {
  const grouped = new Map();

  for (const o of orders) {
    // Revenue for customer aggregation excludes Closed orders too
    if (o.status === 'Closed') continue;

    const c = o.customer;
    if (!c) continue;

    let g = grouped.get(c);
    if (!g) {
      g = {
        customer: c,
        customer_name: o.customer_name || '',
        revenue: 0,
        orders: 0,
      };
      grouped.set(c, g);
    }

    g.revenue += o.rounded_total || o.grand_total || 0;
    g.orders += 1;
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

// ── Sales by Day ────────────────────────────────────────────────────────────

/**
 * Group orders by transaction_date: sum revenue + count.
 * Sorted by date ascending.
 */
function computeSalesByDay(orders) {
  const grouped = new Map();

  for (const o of orders) {
    const d = o.transaction_date;
    if (!d) continue;

    let g = grouped.get(d);
    if (!g) {
      g = { date: d, revenue: 0, orders: 0 };
      grouped.set(d, g);
    }

    g.revenue += o.rounded_total || o.grand_total || 0;
    g.orders += 1;
  }

  return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Stale Quotations ────────────────────────────────────────────────────────

/**
 * Fetch quotations that need follow-up:
 * - Status Open or Replied, submitted (docstatus=1)
 * - transaction_date <= today - 3 days
 * - No linked Sales Order (checked via Sales Order Item prevdoc_docname)
 * - Sorted by age descending, limited to 20.
 */
async function fetchStaleQuotations() {
  const today = new Date();
  today.setDate(today.getDate() - 3);
  const cutoff = today.toISOString().slice(0, 10);

  const quotations = await erpGetList('Quotation', {
    fields: ['name', 'transaction_date', 'customer_name', 'grand_total', 'status'],
    filters: [
      ['status', 'in', ['Open', 'Replied']],
      ['docstatus', '=', 1],
      ['transaction_date', '<=', cutoff],
    ],
    order_by: 'transaction_date asc',
    limit: 10000,
  });

  if (quotations.length === 0) return [];

  // Batch-check which quotations have linked Sales Orders
  const quotationNames = quotations.map(q => q.name);
  const linkedSos = await erpGetList('Sales Order Item', {
    fields: ['prevdoc_docname'],
    filters: [['prevdoc_docname', 'in', quotationNames]],
    limit: 10000,
  });

  const linkedQuotations = new Set(
    linkedSos.map(i => i.prevdoc_docname).filter(Boolean),
  );

  // Filter stale (no linked SO), map to response shape, sort by age desc, limit 20
  const now = Date.now();
  return quotations
    .filter(q => !linkedQuotations.has(q.name))
    .map(q => {
      const ageDays = Math.floor(
        (now - new Date(q.transaction_date).getTime()) / (1000 * 60 * 60 * 24),
      );
      return {
        id: q.name,
        customer_name: q.customer_name || '',
        date: q.transaction_date || '',
        age_days: ageDays,
        grand_total: q.grand_total ?? 0,
        status: q.status || '',
      };
    })
    .sort((a, b) => b.age_days - a.age_days)
    .slice(0, 20);
}

// ── Conversion Rate ─────────────────────────────────────────────────────────

/**
 * Compute conversion rate from the items (already fetched for top products).
 *
 * @param {string} start - Period start date
 * @param {string} end - Period end date
 * @param {Array} allItems - All Sales Order Items in the period
 * @returns {{ quotationsCount: number, ordersFromQuotationCount: number, conversionRate: number }}
 */
async function computeConversionRate(start, end, allItems) {
  // Quotations created in the period (submitted)
  const quotations = await erpGetList('Quotation', {
    fields: ['name'],
    filters: [
      ['transaction_date', 'between', [start, end]],
      ['docstatus', '=', 1],
    ],
    limit: 10000,
  });
  const quotationsCount = quotations.length;

  // SOs in period that have at least one item with prevdoc_docname (from the fetched items)
  const parentsWithPrevdoc = new Set();
  for (const item of allItems) {
    if (item.prevdoc_docname) {
      parentsWithPrevdoc.add(item.parent);
    }
  }
  const ordersFromQuotationCount = parentsWithPrevdoc.size;

  return {
    quotationsCount,
    ordersFromQuotationCount,
    conversionRate:
      quotationsCount > 0
        ? Math.round((ordersFromQuotationCount / quotationsCount) * 100) / 100
        : 0,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const qs = event.queryStringParameters || {};
    const period = (qs.period || '').trim().toLowerCase() || undefined;
    const from = (qs.from || '').trim() || undefined;
    const to = (qs.to || '').trim() || undefined;

    // ── 1. Period ───────────────────────────────────────────────────────
    const periodDates = getPeriodDates(period, from, to);
    const periodLabel = getPeriodLabel(period, from, to);
    const { start, end } = periodDates;

    // ── 2. Current period: Sales Orders ─────────────────────────────────
    const currentOrders = await fetchSalesOrders(start, end);

    // ── 3. Current period: Items (for top products + conversion rate) ───
    const currentOrderNames = currentOrders.map(o => o.name);
    const currentItems = await fetchSalesOrderItems(currentOrderNames);

    // ── 4. Summary ──────────────────────────────────────────────────────
    const summary = computeSummary(currentOrders);

    // ── 5. Previous period summary (for delta) ──────────────────────────
    const prevDates = getPreviousPeriodDates(start, end);
    const prevOrders = await fetchSalesOrders(prevDates.start, prevDates.end);
    const prevSummary = computeSummary(prevOrders);

    const revenueDeltaPct =
      prevSummary.revenue > 0
        ? Math.round(
            ((summary.revenue - prevSummary.revenue) / prevSummary.revenue) * 100 * 100,
          ) / 100
        : summary.revenue > 0
          ? 100
          : 0;

    // ── 6. Top Products ─────────────────────────────────────────────────
    const topProducts = computeTopProducts(currentItems);

    // ── 7. Top Customers ────────────────────────────────────────────────
    const topCustomers = computeTopCustomers(currentOrders);

    // ── 8. Sales by Day ─────────────────────────────────────────────────
    const salesByDay = computeSalesByDay(currentOrders);

    // ── 9. Stale Quotations ─────────────────────────────────────────────
    const staleQuotations = await fetchStaleQuotations();

    // ── 10. Conversion Rate ─────────────────────────────────────────────
    const { quotationsCount, ordersFromQuotationCount, conversionRate } =
      await computeConversionRate(start, end, currentItems);

    // ── 11. Response ────────────────────────────────────────────────────
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        period: {
          label: periodLabel,
          from: start,
          to: end,
        },
        summary: {
          revenue: summary.revenue,
          orders: summary.ordersCount,
          average_ticket: Math.round(summary.averageTicket * 100) / 100,
          open_orders: summary.openOrders,
          conversion_rate: conversionRate,
          previous_revenue: prevSummary.revenue,
          revenue_delta_pct: revenueDeltaPct,
        },
        top_products: topProducts,
        top_customers: topCustomers,
        sales_by_day: salesByDay,
        stale_quotations: staleQuotations,
      }),
    };
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[sales-dashboard]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: err?.statusCode ? err.message : 'Erro interno.',
      }),
    };
  }
}
