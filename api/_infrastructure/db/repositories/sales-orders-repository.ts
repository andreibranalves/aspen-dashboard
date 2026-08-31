import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from '../client.js';
import { appendProductActivityEvents } from './product-activity-repository.js';
import {
  clients,
  crmDeals,
  quoteRevisionItems,
  quoteRevisions,
  quotations,
  salesOrderItems,
  salesOrderSequences,
  salesOrders,
  products,
} from '../schema.js';
import {
  addCalendarDays,
  calendarDateInSaoPaulo,
  resolveNamedPeriod,
} from '../../../_shared/calendar-sao-paulo.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const MAX_SEARCH_LENGTH = 200;
const ACTIVE_ORDER_STATUS = 'Cancelled';
const CREATED_ORDER_STATUS = 'To Deliver and Bill';

export const SALES_ORDER_STATUSES = [
  'Draft',
  'To Deliver and Bill',
  'To Deliver',
  'To Bill',
  'Completed',
  'Cancelled',
  'Closed',
] as const;

export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];
const SUBMITTED_ORDER_STATUSES = SALES_ORDER_STATUSES.filter(
  (status) => status !== 'Draft' && status !== ACTIVE_ORDER_STATUS
);
const FATURAMENTO_ORDER_STATUSES = SUBMITTED_ORDER_STATUSES.filter((status) => status !== 'Closed');

export type SalesOrderTimestamp = Date | string;
export type SalesOrderMoney = number;

export class SalesOrderInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'SalesOrderInputError';
  }
}

export class SalesOrderNotFoundError extends Error {
  readonly statusCode = 404;
  readonly expose = true;

  constructor(message = 'Pedido de Venda não encontrado.') {
    super(message);
    this.name = 'SalesOrderNotFoundError';
  }
}

export class SalesOrderConflictError extends Error {
  readonly statusCode = 409;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'SalesOrderConflictError';
  }
}

export class SalesOrderRepositoryError extends Error {
  readonly statusCode = 503;
  readonly expose = false;

  constructor(message = 'Não foi possível acessar os pedidos locais.') {
    super(message);
    this.name = 'SalesOrderRepositoryError';
  }
}

export interface SalesOrderListOptions {
  page?: number;
  limit?: number;
  period?: string;
  from?: string;
  to?: string;
  status?: string;
  search?: string;
}

export interface SalesOrderListItem {
  id: string;
  order_number: string;
  date: string;
  customer: string;
  customer_name: string;
  grand_total: SalesOrderMoney;
  rounded_total: SalesOrderMoney;
  status: string;
  docstatus: number;
  delivery_date: string;
  per_delivered: SalesOrderMoney;
  per_billed: SalesOrderMoney;
  source_quotation: string | null;
}

export interface SalesOrderItemDetail {
  item_code: string;
  item_name: string;
  qty: SalesOrderMoney;
  uom: string;
  rate: SalesOrderMoney;
  amount: SalesOrderMoney;
  source_quotation: string | null;
}

export interface SalesOrderDetail extends SalesOrderListItem {
  internal_id: string;
  quotation_id: string | null;
  quotation_revision_id: string | null;
  items: SalesOrderItemDetail[];
}

export interface SalesOrderProgressInput {
  per_billed?: number;
  per_delivered?: number;
}

export interface SalesOrderListResult {
  success: true;
  items: SalesOrderListItem[];
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
}

export interface CreateSalesOrderResult {
  success: true;
  id: string;
  order_number: string;
  internal_id: string;
  quotation_id: string;
  quotation_revision_id: string;
  status: string;
  docstatus: number;
  alreadyExists: boolean;
  crmUpdated: boolean;
}

export interface DashboardPeriod {
  period?: string;
  from?: string;
  to?: string;
}

export interface SalesDashboardSummary {
  total_revenue: number;
  custo?: number;
  faturamento?: number;
  ads?: number;
  ads_google?: number;
  ads_meta?: number;
  imposto?: number;
  lucro?: number;
  ads_google_unavailable?: boolean;
  meta_editable?: boolean;
  orders_count: number;
  avg_ticket: number;
  open_orders: number;
  conversion_rate: number;
  revenue_delta?: number;
  orders_delta?: number;
  avg_ticket_delta?: number;
  conversion_delta?: number;
}

export interface SalesDashboardResult {
  success: true;
  period: {
    label: string;
    from: string;
    to: string;
  };
  summary: SalesDashboardSummary;
  top_products: Array<{
    sku: string;
    product: string;
    quantity: number;
    revenue: number;
    custo: number;
    margem: number;
    orders: number;
  }>;
  top_customers: Array<{
    name: string;
    revenue: number;
    orders: number;
  }>;
  sales_by_day: Array<{
    date: string;
    revenue: number;
    orders: number;
  }>;
  stale_quotations: Array<{
    id: string;
    customer: string;
    age: number;
    value: number;
    status: string;
  }>;
}

export interface SalesOrdersRepository {
  list(options?: SalesOrderListOptions): Promise<SalesOrderListResult>;
  get(id: string): Promise<SalesOrderDetail | null>;
  update(id: string, input: SalesOrderProgressInput): Promise<SalesOrderDetail>;
  createFromQuotation(quotationId: string): Promise<CreateSalesOrderResult>;
  dashboard(options?: DashboardPeriod): Promise<SalesDashboardResult>;
  itemCount?(id: string): Promise<number>;
}

export interface SalesOrdersRepositoryOptions {
  now?: () => Date;
  idFactory?: () => string;
}

type DatabaseProvider = () => AppDatabase;
type SalesOrderTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type SalesOrderDatabase = AppDatabase | SalesOrderTransaction;
type SalesOrderRow = typeof salesOrders.$inferSelect;
type SalesOrderItemRow = typeof salesOrderItems.$inferSelect;

type JoinedOrderRow = {
  internalId: string;
  orderNumber: string;
  quotationId: string | null;
  quotationRevisionId: string | null;
  clientId: string;
  status: string;
  transactionDate: string;
  deliveryDate: string | null;
  perDelivered: string | number;
  perBilled: string | number;
  grandTotal: string | number;
  sourceQuotation: string | null;
  customerName: string;
};

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function cleanId(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new SalesOrderInputError(`${label} é obrigatório.`);
  return normalized;
}

function asDate(value: unknown, fallback = new Date()): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(fallback.getTime());
}

function utcIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateOnly(value: Date): string {
  return calendarDateInSaoPaulo(value);
}

function addDays(value: Date, days: number): string {
  return addCalendarDays(calendarDateInSaoPaulo(value), days);
}

function asMoney(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : fallback;
}

function docstatusFor(status: string): number {
  if (status === 'Draft') return 0;
  if (status === 'Cancelled') return 2;
  return 1;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function normalizedSearch(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length > MAX_SEARCH_LENGTH) throw new SalesOrderInputError('Busca muito longa.');
  return normalized;
}

function normalizeStatus(value: unknown): SalesOrderStatus | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  const status = SALES_ORDER_STATUSES.find(
    (candidate) => candidate.toLowerCase() === normalized.toLowerCase()
  );
  if (!status) {
    throw new SalesOrderInputError(
      `Status inválido. Valores aceitos: ${SALES_ORDER_STATUSES.join(', ')}`
    );
  }
  return status;
}

function validateDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const normalized = String(value).trim();
  if (!DATE_PATTERN.test(normalized)) throw new SalesOrderInputError(`${label} inválida.`);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || utcIsoDate(parsed) !== normalized) {
    throw new SalesOrderInputError(`${label} inválida.`);
  }
  return normalized;
}

function periodDates(
  period: string | undefined,
  from: string | undefined,
  to: string | undefined,
  now: Date
): { start?: string; end?: string } {
  const today = dateOnly(now);
  const named = resolveNamedPeriod(period, now);
  let start = named?.start;
  let end = named?.end;

  if (!start && !end) {
    start = validateDate(from, 'Data inicial') || today;
    end = validateDate(to, 'Data final') || today;
  } else {
    validateDate(from, 'Data inicial');
    validateDate(to, 'Data final');
  }
  if (start && end && start > end) {
    throw new SalesOrderInputError('O período informado é inválido.');
  }
  return { start, end };
}

function salesOrderListWhere(rawOptions: SalesOrderListOptions, now: Date): SQL {
  const status = normalizeStatus(rawOptions.status);
  const search = normalizedSearch(rawOptions.search);
  const { start, end } = periodDates(rawOptions.period, rawOptions.from, rawOptions.to, now);
  const filters: SQL[] = [
    status ? eq(salesOrders.status, status) : ne(salesOrders.status, ACTIVE_ORDER_STATUS),
  ];
  if (start) filters.push(gte(salesOrders.transactionDate, start));
  if (end) filters.push(lte(salesOrders.transactionDate, end));
  if (search) {
    const needle = `%${escapeLike(search)}%`;
    filters.push(
      or(
        ilike(salesOrders.orderNumber, needle),
        ilike(clients.nome, needle),
        ilike(clients.email, needle),
        ilike(clients.telefone, needle),
        ilike(clients.documento, needle),
        ilike(quotations.businessNumber, needle),
        sql`${salesOrders.clientId}::text ILIKE ${needle}`
      )!
    );
  }
  return and(...filters)!;
}

function salesOrderListOrder(): SQL[] {
  return [
    desc(salesOrders.transactionDate),
    desc(salesOrders.createdAt),
    desc(salesOrders.orderNumber),
  ];
}

const PERIOD_LABELS: Record<string, string> = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  month: 'Este mês',
  last_month: 'Mês passado',
};

function periodLabel(
  period: string | undefined,
  from: string | undefined,
  to: string | undefined,
  start: string,
  end: string
): string {
  const normalized = (period || '').trim().toLowerCase();
  if (PERIOD_LABELS[normalized]) return PERIOD_LABELS[normalized];
  const format = (value: string) => {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  };
  const customStart = from || start;
  const customEnd = to || end;
  if (customStart === customEnd) return format(customStart);
  return `De ${format(customStart)} a ${format(customEnd)}`;
}

function previousPeriodDates(start: string, end: string): { start: string; end: string } {
  const currentStart = new Date(`${start}T00:00:00.000Z`);
  const currentEnd = new Date(`${end}T00:00:00.000Z`);
  const days = Math.round((currentEnd.getTime() - currentStart.getTime()) / 86400000) + 1;
  const previousEnd = new Date(currentStart.getTime() - 86400000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86400000);
  return { start: utcIsoDate(previousStart), end: utcIsoDate(previousEnd) };
}

function roundNumber(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundQuantity(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function percentageDelta(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return roundNumber(((current - previous) / previous) * 100);
}

function submittedOrdersPeriodFilter(start: string, end: string) {
  return and(
    inArray(salesOrders.status, SUBMITTED_ORDER_STATUSES),
    gte(salesOrders.transactionDate, start),
    lte(salesOrders.transactionDate, end)
  );
}

function faturamentoOrdersPeriodFilter(start: string, end: string) {
  return and(
    inArray(salesOrders.status, FATURAMENTO_ORDER_STATUSES),
    gte(salesOrders.transactionDate, start),
    lte(salesOrders.transactionDate, end)
  );
}

function quotationDateExpression() {
  return sql`(${quotations.createdAt} AT TIME ZONE 'UTC')::date`;
}

async function dashboardSummary(
  database: SalesOrderDatabase,
  start: string,
  end: string
): Promise<{ revenue: number; custo: number; orders: number; openOrders: number }> {
  const [row] = await database
    .select({
      revenue: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)`,
      custo: sql<string>`coalesce((
        select coalesce(sum(i.quantity * coalesce(i.custo_unitario, 0)), 0)
        from sales_order_items i
        inner join sales_orders o on i.sales_order_id = o.id
        where o.status in ('To Deliver and Bill', 'To Deliver', 'To Bill', 'Completed')
          and o.transaction_date >= ${start}
          and o.transaction_date <= ${end}
      ), 0)`,
      orders: sql<number>`count(*)::int`,
      openOrders: sql<number>`count(*) filter (where ${salesOrders.status} not in ('Completed', 'Cancelled', 'Closed'))::int`,
    })
    .from(salesOrders)
    .where(faturamentoOrdersPeriodFilter(start, end));
  return {
    revenue: roundNumber(asMoney(row?.revenue)),
    custo: roundNumber(asMoney(row?.custo)),
    orders: Number(row?.orders) || 0,
    openOrders: Number(row?.openOrders) || 0,
  };
}

async function dashboardConversion(
  database: SalesOrderDatabase,
  start: string,
  end: string
): Promise<number> {
  const quotationDate = quotationDateExpression();
  const [quotationCount] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(quotations)
    .where(
      and(
        sql`${quotationDate} >= ${start}`,
        sql`${quotationDate} <= ${end}`,
        ne(quotations.status, 'rascunho')
      )
    );
  const [convertedCount] = await database
    .select({ count: sql<number>`count(distinct ${salesOrders.id})::int` })
    .from(salesOrders)
    .where(and(submittedOrdersPeriodFilter(start, end), isNotNull(salesOrders.quotationId)));
  const quotationsTotal = Number(quotationCount?.count) || 0;
  const ordersFromQuotation = Number(convertedCount?.count) || 0;
  return quotationsTotal > 0 ? roundNumber(ordersFromQuotation / quotationsTotal) : 0;
}

async function dashboardTopProducts(
  database: SalesOrderDatabase,
  start: string,
  end: string
): Promise<SalesDashboardResult['top_products']> {
  const rows = await database
    .select({
      sku: salesOrderItems.productSku,
      product: sql<string>`max(${salesOrderItems.productName})`,
      quantity: sql<string>`coalesce(sum(${salesOrderItems.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${salesOrderItems.lineTotal}), 0)`,
      custo: sql<string>`coalesce(sum(coalesce(${salesOrderItems.quantity} * coalesce(${salesOrderItems.custoUnitario}, 0), 0)), 0)`,
      orders: sql<number>`count(distinct ${salesOrderItems.salesOrderId})::int`,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrderItems.salesOrderId, salesOrders.id))
    .where(faturamentoOrdersPeriodFilter(start, end))
    .groupBy(salesOrderItems.productSku)
    .orderBy(desc(sql`sum(${salesOrderItems.lineTotal})`), asc(salesOrderItems.productSku))
    .limit(10);
  return rows.map((row) => {
    const revenue = roundNumber(asMoney(row.revenue));
    const custo = roundNumber(asMoney(row.custo));
    return {
      sku: row.sku,
      product: String(row.product || ''),
      quantity: roundQuantity(asMoney(row.quantity)),
      revenue,
      custo,
      margem: revenue > 0 ? roundNumber((revenue - custo) / revenue) : 0,
      orders: Number(row.orders) || 0,
    };
  });
}

async function dashboardTopCustomers(
  database: SalesOrderDatabase,
  start: string,
  end: string
): Promise<SalesDashboardResult['top_customers']> {
  const rows = await database
    .select({
      name: clients.nome,
      revenue: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)`,
      orders: sql<number>`count(*)::int`,
    })
    .from(salesOrders)
    .innerJoin(clients, eq(salesOrders.clientId, clients.id))
    .where(faturamentoOrdersPeriodFilter(start, end))
    .groupBy(salesOrders.clientId, clients.nome)
    .orderBy(desc(sql`sum(${salesOrders.grandTotal})`), asc(clients.nome))
    .limit(10);
  return rows.map((row) => ({
    name: row.name,
    revenue: roundNumber(asMoney(row.revenue)),
    orders: Number(row.orders) || 0,
  }));
}

async function dashboardSalesByDay(
  database: SalesOrderDatabase,
  start: string,
  end: string
): Promise<SalesDashboardResult['sales_by_day']> {
  const rows = await database
    .select({
      date: salesOrders.transactionDate,
      revenue: sql<string>`coalesce(sum(${salesOrders.grandTotal}), 0)`,
      orders: sql<number>`count(*)::int`,
    })
    .from(salesOrders)
    .where(faturamentoOrdersPeriodFilter(start, end))
    .groupBy(salesOrders.transactionDate)
    .orderBy(asc(salesOrders.transactionDate));
  return rows.map((row) => ({
    date: row.date,
    revenue: roundNumber(asMoney(row.revenue)),
    orders: Number(row.orders) || 0,
  }));
}

async function dashboardStaleQuotations(
  database: SalesOrderDatabase,
  now: Date
): Promise<SalesDashboardResult['stale_quotations']> {
  const staleRevision = alias(quoteRevisions, 'dashboard_stale_revision');
  const linkedOrder = alias(salesOrders, 'dashboard_stale_order');
  const cutoff = addDays(now, -3);
  const quotationDate = quotationDateExpression();
  const rows = await database
    .select({
      id: quotations.businessNumber,
      customer: clients.nome,
      createdAt: quotations.createdAt,
      value: staleRevision.total,
      status: quotations.status,
    })
    .from(quotations)
    .innerJoin(clients, eq(quotations.clientId, clients.id))
    .leftJoin(
      staleRevision,
      and(
        eq(staleRevision.quotationId, quotations.id),
        sql`${staleRevision.version} = (
          select max(${quoteRevisions.version})
          from ${quoteRevisions}
          where ${quoteRevisions.quotationId} = ${quotations.id}
        )`
      )
    )
    .leftJoin(linkedOrder, eq(linkedOrder.quotationId, quotations.id))
    .where(
      and(
        eq(quotations.status, 'emitido'),
        sql`${quotationDate} <= ${cutoff}`,
        isNull(linkedOrder.id)
      )
    )
    .orderBy(asc(quotations.createdAt), asc(quotations.businessNumber))
    .limit(20);
  return rows.map((row) => ({
    id: row.id,
    customer: row.customer,
    age: Math.max(0, Math.floor((now.getTime() - asDate(row.createdAt, now).getTime()) / 86400000)),
    value: roundNumber(asMoney(row.value)),
    status: row.status,
  }));
}

function quotationPredicate(id: string) {
  return isUuid(id) ? eq(quotations.id, id) : eq(quotations.businessNumber, id);
}

function orderPredicate(id: string) {
  return isUuid(id) ? eq(salesOrders.id, id) : eq(salesOrders.orderNumber, id);
}

function knownError(error: unknown): boolean {
  return (
    error instanceof SalesOrderInputError ||
    error instanceof SalesOrderNotFoundError ||
    error instanceof SalesOrderConflictError ||
    error instanceof SalesOrderRepositoryError
  );
}

function safeRepositoryError(error: unknown): never {
  if (knownError(error)) throw error;
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (
    candidate?.code === '23505' &&
    String(candidate.constraint || candidate.message || '').includes(
      'sales_orders_active_quotation_unique'
    )
  ) {
    throw new SalesOrderConflictError(
      'Já existe um pedido ativo para este orçamento. Atualize a página e tente novamente.'

    );
  }
  console.error('[sales-orders-repository]', error instanceof Error ? error.name : typeof error);
  throw new SalesOrderRepositoryError();
}
const PROGRESS_ORDER_STATUSES: Record<string, true> = {
  'To Deliver and Bill': true,
  'To Deliver': true,
  'To Bill': true,
  Completed: true,
};

export function deriveSalesOrderStatus(
  status: string,
  perBilled: number,
  perDelivered: number
): string {
  if (!PROGRESS_ORDER_STATUSES[status]) return status;
  if (perBilled === 100 && perDelivered < 100) return 'To Deliver';
  if (perDelivered === 100 && perBilled < 100) return 'To Bill';
  if (perBilled === 100 && perDelivered === 100) return 'Completed';
  return 'To Deliver and Bill';
}

function mapListRow(row: JoinedOrderRow): SalesOrderListItem {
  const perDelivered = asMoney(row.perDelivered);
  const perBilled = asMoney(row.perBilled);
  const status = deriveSalesOrderStatus(row.status, perBilled, perDelivered);
  return {
    id: row.orderNumber,
    order_number: row.orderNumber,
    date: row.transactionDate,
    customer: row.clientId,
    customer_name: row.customerName,
    grand_total: asMoney(row.grandTotal),
    rounded_total: asMoney(row.grandTotal),
    status,
    docstatus: docstatusFor(status),
    delivery_date: row.deliveryDate || '',
    per_delivered: perDelivered,
    per_billed: perBilled,
    source_quotation: row.sourceQuotation,
  };
}

function mapItemRow(row: SalesOrderItemRow, sourceQuotation: string | null): SalesOrderItemDetail {
  return {
    item_code: row.productSku,
    item_name: row.productName,
    qty: asMoney(row.quantity),
    uom: row.unit,
    rate: asMoney(row.unitPrice),
    amount: asMoney(row.lineTotal),
    source_quotation: sourceQuotation,
  };
}

function mapCreateResult(
  row: SalesOrderRow,
  alreadyExists: boolean,
  crmUpdated: boolean
): CreateSalesOrderResult {
  return {
    success: true,
    id: row.orderNumber,
    order_number: row.orderNumber,
    internal_id: row.id,
    quotation_id: row.quotationId!,
    quotation_revision_id: row.quotationRevisionId!,
    status: row.status,
    docstatus: docstatusFor(row.status),
    alreadyExists,
    crmUpdated,
  };
}

async function readJoinedOrder(
  database: SalesOrderDatabase,
  predicate: ReturnType<typeof orderPredicate>
): Promise<JoinedOrderRow | null> {
  const [row] = await database
    .select({
      internalId: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      quotationId: salesOrders.quotationId,
      quotationRevisionId: salesOrders.quotationRevisionId,
      clientId: salesOrders.clientId,
      status: salesOrders.status,
      transactionDate: salesOrders.transactionDate,
      deliveryDate: salesOrders.deliveryDate,
      perDelivered: salesOrders.perDelivered,
      perBilled: salesOrders.perBilled,
      grandTotal: salesOrders.grandTotal,
      sourceQuotation: quotations.businessNumber,
      customerName: clients.nome,
    })
    .from(salesOrders)
    .innerJoin(clients, eq(salesOrders.clientId, clients.id))
    .leftJoin(quotations, eq(salesOrders.quotationId, quotations.id))
    .where(predicate)
    .limit(1);
  return row || null;
}

function detailFromJoined(row: JoinedOrderRow, items: SalesOrderItemRow[]): SalesOrderDetail {
  const base = mapListRow(row);
  return {
    ...base,
    internal_id: row.internalId,
    quotation_id: row.quotationId,
    quotation_revision_id: row.quotationRevisionId,
    items: items.map((item) => mapItemRow(item, row.sourceQuotation)),
  };
}

async function updateDealForQuotation(
  transaction: SalesOrderTransaction,
  quotationId: string,
  now: Date
): Promise<boolean> {
  const deals = await transaction
    .select({ id: crmDeals.id, updatedAt: crmDeals.updatedAt })
    .from(crmDeals)
    .where(and(eq(crmDeals.quotationId, quotationId), ne(crmDeals.status, 'Perdido')));
  if (deals.length === 0) return false;
  for (const deal of deals) {
    const previous = asDate(deal.updatedAt, new Date(0));
    const updatedAt = now.getTime() > previous.getTime() ? now : new Date(previous.getTime() + 1);
    await transaction
      .update(crmDeals)
      .set({ status: 'Pedido Fechado', updatedAt })
      .where(eq(crmDeals.id, deal.id));
  }
  return true;
}

async function reserveOrderNumber(
  transaction: SalesOrderTransaction,
  year: number
): Promise<string> {
  await transaction
    .insert(salesOrderSequences)
    .values({ year, lastNumber: 0 })
    .onConflictDoNothing({ target: salesOrderSequences.year });
  const [sequence] = await transaction
    .select()
    .from(salesOrderSequences)
    .where(eq(salesOrderSequences.year, year))
    .for('update')
    .limit(1);
  if (!sequence)
    throw new SalesOrderRepositoryError('Não foi possível reservar o número do pedido.');
  if (sequence.lastNumber >= 9999) {
    throw new SalesOrderConflictError('A numeração de pedidos deste ano está esgotada.');
  }
  const nextNumber = sequence.lastNumber + 1;
  await transaction
    .update(salesOrderSequences)
    .set({ lastNumber: nextNumber })
    .where(eq(salesOrderSequences.year, year));
  return `PED-${year}-${String(nextNumber).padStart(4, '0')}`;
}

export async function createSalesOrderFromApprovedQuotation(
  transaction: SalesOrderTransaction,
  quotation: { id: string; clientId: string; status: string },
  options: { now: Date; idFactory: () => string }
): Promise<CreateSalesOrderResult> {
  try {
    return await insertSalesOrderFromApprovedQuotation(transaction, quotation, options);
  } catch (error) {
    return safeRepositoryError(error);
  }
}

async function insertSalesOrderFromApprovedQuotation(
  transaction: SalesOrderTransaction,
  quotation: { id: string; clientId: string; status: string },
  options: { now: Date; idFactory: () => string }
): Promise<CreateSalesOrderResult> {
  const [existing] = await transaction
    .select()
    .from(salesOrders)
    .where(
      and(eq(salesOrders.quotationId, quotation.id), ne(salesOrders.status, ACTIVE_ORDER_STATUS))
    )
    .for('update')
    .limit(1);
  if (existing) {
    const crmUpdated = await updateDealForQuotation(transaction, quotation.id, options.now);
    return mapCreateResult(existing, true, crmUpdated);
  }

  if (quotation.status !== 'aprovado') {
    throw new SalesOrderInputError('Este orçamento não pode ser convertido em pedido de venda.');
  }
  const [revision] = await transaction
    .select()
    .from(quoteRevisions)
    .where(and(eq(quoteRevisions.quotationId, quotation.id), eq(quoteRevisions.status, 'aprovado')))
    .orderBy(desc(quoteRevisions.version))
    .limit(1);
  if (!revision) {
    throw new SalesOrderInputError('A revisão aprovada do orçamento não está disponível.');
  }
  const revisionItems = await transaction
    .select()
    .from(quoteRevisionItems)
    .where(eq(quoteRevisionItems.revisionId, revision.id))
    .orderBy(asc(quoteRevisionItems.position));
  const current = asDate(options.now);
  const businessDate = calendarDateInSaoPaulo(current);
  const orderNumber = await reserveOrderNumber(transaction, Number(businessDate.slice(0, 4)));
  const orderId = options.idFactory();
  const createdAt = current;
  const [order] = await transaction
    .insert(salesOrders)
    .values({
      id: orderId,
      orderNumber,
      quotationId: quotation.id,
      quotationRevisionId: revision.id,
      clientId: quotation.clientId,
      status: CREATED_ORDER_STATUS,
      transactionDate: businessDate,
      deliveryDate: addDays(current, 30),
      subtotal: revision.subtotal,
      grandTotal: revision.total,
      createdAt,
      updatedAt: createdAt,
    })
    .returning();
  if (!order) throw new SalesOrderRepositoryError('Não foi possível criar o pedido local.');
  if (revisionItems.length > 0) {
    const skus = [...new Set(revisionItems.map((item) => item.produtoSku || item.productSku))];
    const catalog = skus.length
      ? await transaction
          .select({ sku: products.sku, custoUnitario: products.custoUnitario })
          .from(products)
          .where(inArray(products.sku, skus))
      : [];
    const costBySku = new Map(catalog.map((row) => [row.sku, row.custoUnitario ?? null]));
    await transaction.insert(salesOrderItems).values(
      revisionItems.map((item) => {
        const sku = item.produtoSku || item.productSku;
        return {
          id: options.idFactory(),
          salesOrderId: order.id,
          position: item.position,
          productSku: sku,
          productName: item.produtoNome,
          unit: item.produtoUnidade,
          quantity: item.quantidade,
          unitPrice: item.precoAplicado,
          lineTotal: item.totalLinha,
          custoUnitario: costBySku.get(sku) ?? null,
        };
      })
    );
  }
  await appendProductActivityEvents(
    transaction,
    [...new Set(revisionItems.map((item) => item.produtoSku || item.productSku))].map((sku) => ({
      sku,
      tipo: 'pedido' as const,
      texto: `Pedido ${order.orderNumber} criado`,
      reference_id: `pedido:${order.id}:${sku}`,
      created_at: createdAt,
    }))
  );
  await transaction
    .update(quoteRevisions)
    .set({ orderLinkage: 'ordered', orderPending: false })
    .where(eq(quoteRevisions.id, revision.id));
  const crmUpdated = await updateDealForQuotation(transaction, quotation.id, createdAt);
  return mapCreateResult(order, false, crmUpdated);
}

export async function listSalesOrdersForExport(
  options: SalesOrderListOptions,
  limit: number,
  now: Date,
  getDb: DatabaseProvider = getDatabase
) {
  return getDb()
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      quotationId: salesOrders.quotationId,
      quotationNumber: quotations.businessNumber,
      quotationRevisionId: salesOrders.quotationRevisionId,
      clientId: salesOrders.clientId,
      clientName: quoteRevisions.clienteNome,
      clientDocument: quoteRevisions.clienteDocumento,
      clientEmail: quoteRevisions.clienteEmail,
      clientPhone: quoteRevisions.clienteTelefone,
      clientAddress: quoteRevisions.clienteEndereco,
      clientAddressNumber: quoteRevisions.clienteNumero,
      clientDistrict: quoteRevisions.clienteBairro,
      clientAddressExtra: quoteRevisions.clienteComplemento,
      clientCity: quoteRevisions.clienteMunicipio,
      clientState: quoteRevisions.clienteUf,
      clientPostalCode: quoteRevisions.clienteCep,
      status: salesOrders.status,
      transactionDate: salesOrders.transactionDate,
      deliveryDate: salesOrders.deliveryDate,
      perDelivered: salesOrders.perDelivered,
      perBilled: salesOrders.perBilled,
      subtotal: salesOrders.subtotal,
      grandTotal: salesOrders.grandTotal,
      createdAt: salesOrders.createdAt,
      updatedAt: salesOrders.updatedAt,
    })
    .from(salesOrders)
    .innerJoin(clients, eq(salesOrders.clientId, clients.id))
    .leftJoin(quotations, eq(salesOrders.quotationId, quotations.id))
    .leftJoin(quoteRevisions, eq(salesOrders.quotationRevisionId, quoteRevisions.id))
    .where(salesOrderListWhere(options, now))
    .orderBy(...salesOrderListOrder())
    .limit(limit);
}

export async function listSalesOrderItemsForExport(
  options: SalesOrderListOptions,
  limit: number,
  now: Date,
  getDb: DatabaseProvider = getDatabase
) {
  return getDb()
    .select({
      id: salesOrderItems.id,
      salesOrderId: salesOrderItems.salesOrderId,
      orderNumber: salesOrders.orderNumber,
      position: salesOrderItems.position,
      productSku: salesOrderItems.productSku,
      productName: salesOrderItems.productName,
      unit: salesOrderItems.unit,
      quantity: salesOrderItems.quantity,
      unitPrice: salesOrderItems.unitPrice,
      lineTotal: salesOrderItems.lineTotal,
      custoUnitario: salesOrderItems.custoUnitario,
    })
    .from(salesOrderItems)
    .innerJoin(salesOrders, eq(salesOrderItems.salesOrderId, salesOrders.id))
    .innerJoin(clients, eq(salesOrders.clientId, clients.id))
    .leftJoin(quotations, eq(salesOrders.quotationId, quotations.id))
    .where(salesOrderListWhere(options, now))
    .orderBy(...salesOrderListOrder(), asc(salesOrderItems.position))
    .limit(limit);
}

function validateProgressInput(rawInput: SalesOrderProgressInput): SalesOrderProgressInput {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new SalesOrderInputError('Envie um payload válido.');
  }
  const input = rawInput as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.length === 0 ||
    keys.some((key) => key !== 'per_billed' && key !== 'per_delivered')
  ) {
    throw new SalesOrderInputError(
      'Informe per_billed ou per_delivered com um percentual inteiro de 0 a 100.'
    );
  }
  for (const key of ['per_billed', 'per_delivered'] as const) {
    if (input[key] === undefined) continue;
    if (!Number.isInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > 100) {
      throw new SalesOrderInputError(
        `${key} deve ser um percentual inteiro entre 0 e 100.`
      );
    }
  }
  return {
    ...(input.per_billed === undefined ? {} : { per_billed: input.per_billed as number }),
    ...(input.per_delivered === undefined
      ? {}
      : { per_delivered: input.per_delivered as number }),
  };
}

export function createPostgresSalesOrdersRepository(
  getDb: DatabaseProvider = getDatabase,
  options: SalesOrdersRepositoryOptions = {}
): SalesOrdersRepository & { itemCount(id: string): Promise<number> } {
  const nowFactory = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;

  const repository = {
    async list(rawOptions: SalesOrderListOptions = {}): Promise<SalesOrderListResult> {
      const page = rawOptions.page === undefined ? 1 : asInteger(rawOptions.page, 0);
      if (page < 1) throw new SalesOrderInputError('Página inválida.');
      const limit = rawOptions.limit === undefined ? DEFAULT_LIMIT : asInteger(rawOptions.limit, 0);
      if (limit < 1) throw new SalesOrderInputError('Limite inválido.');
      if (limit > MAX_LIMIT) {
        throw new SalesOrderInputError('Limite máximo é 200 registros por página.');
      }
      const where = salesOrderListWhere(rawOptions, asDate(nowFactory()));
      try {
        const database = getDb();
        const [{ total }] = await database
          .select({ total: sql<number>`count(*)::int` })
          .from(salesOrders)
          .innerJoin(clients, eq(salesOrders.clientId, clients.id))
          .leftJoin(quotations, eq(salesOrders.quotationId, quotations.id))
          .where(where);
        const offset = (page - 1) * limit;
        const rows = await database
          .select({
            internalId: salesOrders.id,
            orderNumber: salesOrders.orderNumber,
            quotationId: salesOrders.quotationId,
            quotationRevisionId: salesOrders.quotationRevisionId,
            clientId: salesOrders.clientId,
            status: salesOrders.status,
            transactionDate: salesOrders.transactionDate,
            deliveryDate: salesOrders.deliveryDate,
            perDelivered: salesOrders.perDelivered,
            perBilled: salesOrders.perBilled,
            grandTotal: salesOrders.grandTotal,
            sourceQuotation: quotations.businessNumber,
            customerName: clients.nome,
          })
          .from(salesOrders)
          .innerJoin(clients, eq(salesOrders.clientId, clients.id))
          .leftJoin(quotations, eq(salesOrders.quotationId, quotations.id))
          .where(where)
          .orderBy(...salesOrderListOrder())
          .limit(limit)
          .offset(offset);

        const numericTotal = Number(total) || 0;
        return {
          success: true,
          items: rows.map(mapListRow),
          page,
          limit,
          total: numericTotal,
          has_more: offset + rows.length < numericTotal,
        };
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async get(id: string): Promise<SalesOrderDetail | null> {
      const normalized = cleanId(id, 'ID do pedido');
      try {
        const database = getDb();
        const row = await readJoinedOrder(database, orderPredicate(normalized));
        if (!row) return null;
        const items = await database
          .select()
          .from(salesOrderItems)
          .where(eq(salesOrderItems.salesOrderId, row.internalId))
          .orderBy(asc(salesOrderItems.position));
        return detailFromJoined(row, items);
      } catch (error) {
        return safeRepositoryError(error);
      }
    },
    async update(id: string, rawInput: SalesOrderProgressInput): Promise<SalesOrderDetail> {
      const normalized = cleanId(id, 'ID do pedido');
      const input = validateProgressInput(rawInput);
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
          const [current] = await transaction
            .select()
            .from(salesOrders)
            .where(orderPredicate(normalized))
            .for('update')
            .limit(1);
          if (!current) throw new SalesOrderNotFoundError();
          if (
            current.status === 'Draft' ||
            current.status === 'Cancelled' ||
            current.status === 'Closed'
          ) {
            throw new SalesOrderConflictError(
              'Pedidos em rascunho, cancelados ou fechados não podem ser alterados.'
            );
          }
          const perBilled =
            input.per_billed === undefined ? asMoney(current.perBilled) : input.per_billed;
          const perDelivered =
            input.per_delivered === undefined
              ? asMoney(current.perDelivered)
              : input.per_delivered;
          const status = deriveSalesOrderStatus(current.status, perBilled, perDelivered);
          await transaction
            .update(salesOrders)
            .set({
              perBilled: String(perBilled),
              perDelivered: String(perDelivered),
              status,
              updatedAt: asDate(nowFactory()),
            })
            .where(eq(salesOrders.id, current.id));
          const row = await readJoinedOrder(transaction, eq(salesOrders.id, current.id));
          if (!row) throw new SalesOrderRepositoryError('Não foi possível ler o pedido atualizado.');
          const items = await transaction
            .select()
            .from(salesOrderItems)
            .where(eq(salesOrderItems.salesOrderId, row.internalId))
            .orderBy(asc(salesOrderItems.position));
          return detailFromJoined(row, items);
        });
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async createFromQuotation(quotationId: string): Promise<CreateSalesOrderResult> {
      const normalizedQuotationId = cleanId(quotationId, 'quotation_id');
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
          const [quotation] = await transaction
            .select()
            .from(quotations)
            .where(quotationPredicate(normalizedQuotationId))
            .for('update')
            .limit(1);
          if (!quotation) throw new SalesOrderNotFoundError('Orçamento não encontrado.');

          return createSalesOrderFromApprovedQuotation(transaction, quotation, {
            now: asDate(nowFactory()),
            idFactory,
          });
        });
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async dashboard(rawOptions: DashboardPeriod = {}): Promise<SalesDashboardResult> {
      const now = asDate(nowFactory());
      const { start: resolvedStart, end: resolvedEnd } = periodDates(
        rawOptions.period,
        rawOptions.from,
        rawOptions.to,
        now
      );
      const start = resolvedStart || dateOnly(now);
      const end = resolvedEnd || dateOnly(now);
      const previous = previousPeriodDates(start, end);
      try {
        const database = getDb();
        const currentSummary = await dashboardSummary(database, start, end);
        const previousSummary = await dashboardSummary(database, previous.start, previous.end);
        const currentConversion = await dashboardConversion(database, start, end);
        const previousConversion = await dashboardConversion(
          database,
          previous.start,
          previous.end
        );
        const [topProducts, topCustomers, salesByDay, staleQuotations] = await Promise.all([
          dashboardTopProducts(database, start, end),
          dashboardTopCustomers(database, start, end),
          dashboardSalesByDay(database, start, end),
          dashboardStaleQuotations(database, now),
        ]);
        const currentAverage = currentSummary.orders
          ? roundNumber(currentSummary.revenue / currentSummary.orders)
          : 0;
        const previousAverage = previousSummary.orders
          ? roundNumber(previousSummary.revenue / previousSummary.orders)
          : 0;
        const hasComparison =
          currentSummary.orders > 0 ||
          previousSummary.orders > 0 ||
          currentConversion > 0 ||
          previousConversion > 0;
        const summary: SalesDashboardSummary = {
          total_revenue: currentSummary.revenue,
          custo: currentSummary.custo,
          orders_count: currentSummary.orders,
          avg_ticket: currentAverage,
          open_orders: currentSummary.openOrders,
          conversion_rate: currentConversion,
          revenue_delta: hasComparison
            ? percentageDelta(currentSummary.revenue, previousSummary.revenue)
            : 0,
          orders_delta: hasComparison
            ? percentageDelta(currentSummary.orders, previousSummary.orders)
            : 0,
          avg_ticket_delta: hasComparison ? percentageDelta(currentAverage, previousAverage) : 0,
          conversion_delta: hasComparison
            ? percentageDelta(currentConversion, previousConversion)
            : 0,
        };
        return {
          success: true,
          period: {
            label: periodLabel(rawOptions.period, rawOptions.from, rawOptions.to, start, end),
            from: start,
            to: end,
          },
          summary,
          top_products: topProducts,
          top_customers: topCustomers,
          sales_by_day: salesByDay,
          stale_quotations: staleQuotations,
        };
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async itemCount(id: string): Promise<number> {
      const normalized = cleanId(id, 'ID do pedido');
      try {
        const database = getDb();
        const [{ total }] = await database
          .select({ total: sql<number>`count(*)::int` })
          .from(salesOrderItems)
          .innerJoin(salesOrders, eq(salesOrderItems.salesOrderId, salesOrders.id))
          .where(orderPredicate(normalized));
        return Number(total) || 0;
      } catch (error) {
        return safeRepositoryError(error);
      }
    },
  };
  return repository;
}

export const createSalesOrdersRepository = createPostgresSalesOrdersRepository;
export const createPostgresSalesOrderRepository = createPostgresSalesOrdersRepository;
