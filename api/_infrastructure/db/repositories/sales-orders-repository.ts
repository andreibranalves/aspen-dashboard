import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from '../client.js';
import { appendProductActivityEvents } from './product-activity-repository.js';
import {
  clients,
  crmDeals,
  opportunityNextActions,
  quoteRevisionItems,
  quoteRevisions,
  quotations,
  quoteLeads,
  salesOrderItems,
  salesOrderNotes,
  salesOrderSequences,
  salesOrders,
  products,
} from '../schema.js';
import {
  addCalendarDays,
  calendarDateInSaoPaulo,
  resolveNamedPeriod,
} from '../../../_shared/calendar-sao-paulo.js';
import { cancelQuotationFollowUpForFact } from './quotation-follow-up-facts.js';
import { readQuotationOrigin, type QuotationOriginProjection } from './quotation-origin-repository.js';
import {
  DELIVERED_BOARD_DAYS,
  PRODUCTION_STAGE_LABELS,
  billedPercent,
  defaultDepositAmount,
  isProductionStage,
  needsAttention,
  nextProductionStage,
  productionDeadline,
  productionTimeline,
  receivedAmount,
  stageReached,
  type ProductionStage,
  type ProductionTimeline,
} from '../../../_modules/sales-order-production.js';
import { safeErrorSummary } from '../../../_shared/safe-error.js';

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
  production_stage: ProductionStage;
  production: ProductionTimeline;
  production_days: number;
  deadline_manual: boolean;
  deposit_received_on: string | null;
  deposit_amount: SalesOrderMoney | null;
  art_approved_on: string | null;
  ready_on: string | null;
  delivered_on: string | null;
  balance_received_on: string | null;
  received_amount: SalesOrderMoney;
}

export interface SalesOrderNoteDetail {
  id: string;
  kind: 'note' | 'stage';
  body: string;
  created_at: string;
  updated_at: string;
  undoable: boolean;
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
  quotation_origin: QuotationOriginProjection;
  notes: SalesOrderNoteDetail[];
}

export interface SalesOrderProductionUpdate {
  deposit_received_on?: string;
  deposit_amount?: number;
  art_approved_on?: string;
  production_days?: number;
  deadline?: string | null;
  ready_on?: string;
  delivered_on?: string;
  balance_received_on?: string | null;
}

export type SalesOrderAction =
  | { action: 'advance'; expected_stage: ProductionStage; date: string; deposit_amount?: number }
  | { action: 'undo'; note_id: string }
  | ({ action: 'update' } & SalesOrderProductionUpdate)
  | { action: 'add_note'; body: string }
  | { action: 'edit_note'; note_id: string; body: string }
  | { action: 'delete_note'; note_id: string };

export interface SalesOrderBoardResult {
  success: true;
  items: SalesOrderListItem[];
  attention_count: number;
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
  orders_by_source: Array<{ source: string; orders: number }>;
}

export interface SalesOrdersRepository {
  list(options?: SalesOrderListOptions): Promise<SalesOrderListResult>;
  get(id: string): Promise<SalesOrderDetail | null>;
  apply(id: string, action: SalesOrderAction): Promise<SalesOrderDetail>;
  board(): Promise<SalesOrderBoardResult>;
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
type SalesOrderNoteRow = typeof salesOrderNotes.$inferSelect;

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
  productionStage: string;
  productionStageChangedAt: Date | string;
  depositReceivedOn: string | null;
  depositAmount: string | number | null;
  artApprovedOn: string | null;
  productionDays: number;
  deadlineManual: boolean;
  readyOn: string | null;
  deliveredOn: string | null;
  balanceReceivedOn: string | null;
};

const joinedOrderSelection = {
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
  productionStage: salesOrders.productionStage,
  productionStageChangedAt: salesOrders.productionStageChangedAt,
  depositReceivedOn: salesOrders.depositReceivedOn,
  depositAmount: salesOrders.depositAmount,
  artApprovedOn: salesOrders.artApprovedOn,
  productionDays: salesOrders.productionDays,
  deadlineManual: salesOrders.deadlineManual,
  readyOn: salesOrders.readyOn,
  deliveredOn: salesOrders.deliveredOn,
  balanceReceivedOn: salesOrders.balanceReceivedOn,
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

/**
 * Acquisition channel of an order, strongest evidence first: the channel the
 * operator picked on the proposal, a Google Ads click id captured with the lead,
 * an earlier order from the same client, then the lead's own entry channel.
 */
function orderOriginExpression() {
  const adClick = sql`coalesce(
    nullif(btrim(${quoteLeads.attribution}->>'gclid'), ''),
    nullif(btrim(${quoteLeads.attribution}->>'gbraid'), ''),
    nullif(btrim(${quoteLeads.attribution}->>'wbraid'), '')
  )`;
  return sql<string>`case
    when ${quotations.leadSource} is not null then ${quotations.leadSource}
    when ${adClick} is not null then 'Google Ads'
    when exists (
      select 1
      from sales_orders prior
      where prior.client_id = ${salesOrders.clientId}
        and prior.id <> ${salesOrders.id}
        and prior.status in (${sql.join(
          FATURAMENTO_ORDER_STATUSES.map((status) => sql`${status}`),
          sql`, `
        )})
        and (prior.transaction_date, prior.created_at) < (${salesOrders.transactionDate}, ${salesOrders.createdAt})
    ) then 'Cliente recorrente'
    when ${quoteLeads.source} = 'whatsapp' then 'WhatsApp'
    when ${quoteLeads.source} = 'site_form' then 'Site'
    when ${quoteLeads.source} = 'typebot' then 'Typebot'
    when nullif(btrim(${quoteLeads.source}), '') is not null then ${quoteLeads.source}
    else 'sem_origem'
  end`;
}

async function dashboardOrdersBySource(
  database: SalesOrderDatabase,
  start: string,
  end: string
): Promise<SalesDashboardResult['orders_by_source']> {
  // Grouped by position: the expression carries bound parameters, so repeating
  // it in GROUP BY would not match the selected column.
  const rows = await database
    .select({ source: orderOriginExpression(), orders: sql<number>`count(*)::int` })
    .from(salesOrders)
    .leftJoin(quotations, eq(salesOrders.quotationId, quotations.id))
    .leftJoin(quoteLeads, eq(quotations.quoteLeadId, quoteLeads.id))
    .where(faturamentoOrdersPeriodFilter(start, end))
    .groupBy(sql`1`)
    .orderBy(desc(sql`count(*)`), sql`1`);
  return rows.map((row) => ({ source: row.source, orders: Number(row.orders) || 0 }));
}

/**
 * Conversion of one single cohort: of the quotations created in the period
 * (drafts excluded), how many became an order. The numerator is a subset of the
 * denominator by construction, so the ratio can never exceed 100% and no
 * artificial clamp is needed. An order counts regardless of when it was closed,
 * because the cohort is the quotation, not the order.
 */
async function dashboardConversion(
  database: SalesOrderDatabase,
  start: string,
  end: string
): Promise<number> {
  const quotationDate = quotationDateExpression();
  const cohortCondition = and(
    sql`${quotationDate} >= ${start}`,
    sql`${quotationDate} <= ${end}`,
    ne(quotations.status, 'rascunho')
  );
  const [quotationCount] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(quotations)
    .where(cohortCondition);
  const [convertedCount] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(quotations)
    .where(
      and(
        cohortCondition,
        sql`exists (
          select 1
          from sales_orders o
          where o.quotation_id = ${quotations.id}
            and o.status in (${sql.join(
              SUBMITTED_ORDER_STATUSES.map((status) => sql`${status}`),
              sql`, `
            )})
        )`
      )
    );
  const quotationsTotal = Number(quotationCount?.count) || 0;
  const quotationsConverted = Number(convertedCount?.count) || 0;
  // Zero quotations in the period: no conversion is defined, and 0% is the
  // honest reading (nothing was proposed, so nothing converted).
  return quotationsTotal > 0 ? roundNumber(quotationsConverted / quotationsTotal) : 0;
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
  console.error('[sales-orders-repository]', safeErrorSummary(error));
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

function rowStage(row: { productionStage: string }): ProductionStage {
  return isProductionStage(row.productionStage) ? row.productionStage : 'aguardando_entrada';
}

function mapListRow(row: JoinedOrderRow, today: string): SalesOrderListItem {
  const perDelivered = asMoney(row.perDelivered);
  const perBilled = asMoney(row.perBilled);
  const status = deriveSalesOrderStatus(row.status, perBilled, perDelivered);
  const stage = rowStage(row);
  const grandTotal = asMoney(row.grandTotal);
  const depositAmount = row.depositAmount === null ? null : asMoney(row.depositAmount);
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
    production_stage: stage,
    production: productionTimeline(
      {
        stage,
        artApprovedOn: row.artApprovedOn,
        deadline: row.artApprovedOn ? row.deliveryDate : null,
        readyOn: row.readyOn,
        stageChangedOn: dateOnly(asDate(row.productionStageChangedAt)),
      },
      today
    ),
    production_days: row.productionDays,
    deadline_manual: row.deadlineManual,
    deposit_received_on: row.depositReceivedOn,
    deposit_amount: depositAmount,
    art_approved_on: row.artApprovedOn,
    ready_on: row.readyOn,
    delivered_on: row.deliveredOn,
    balance_received_on: row.balanceReceivedOn,
    received_amount: receivedAmount(grandTotal, depositAmount, row.balanceReceivedOn),
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
    .select(joinedOrderSelection)
    .from(salesOrders)
    .innerJoin(clients, eq(salesOrders.clientId, clients.id))
    .leftJoin(quotations, eq(salesOrders.quotationId, quotations.id))
    .where(predicate)
    .limit(1);
  return row || null;
}

function detailFromJoined(
  row: JoinedOrderRow,
  items: SalesOrderItemRow[],
  quotationOrigin: QuotationOriginProjection,
  notes: SalesOrderNoteRow[],
  now: Date,
): SalesOrderDetail {
  const base = mapListRow(row, dateOnly(now));
  const latestStageNote = notes.find((note) => note.kind === 'stage');
  return {
    ...base,
    internal_id: row.internalId,
    quotation_id: row.quotationId,
    quotation_revision_id: row.quotationRevisionId,
    items: items.map((item) => mapItemRow(item, row.sourceQuotation)),
    quotation_origin: quotationOrigin,
    notes: notes.map((note) => ({
      id: note.id,
      kind: note.kind === 'stage' ? 'stage' : 'note',
      body: note.body,
      created_at: asDate(note.createdAt).toISOString(),
      updated_at: asDate(note.updatedAt).toISOString(),
      undoable: note === latestStageNote && canUndo(note, rowStage(row), now),
    })),
  };
}

async function readOrderDetail(
  database: SalesOrderDatabase,
  predicate: ReturnType<typeof orderPredicate>,
  now: Date,
): Promise<SalesOrderDetail | null> {
  const row = await readJoinedOrder(database, predicate);
  if (!row) return null;
  const items = await database
    .select()
    .from(salesOrderItems)
    .where(eq(salesOrderItems.salesOrderId, row.internalId))
    .orderBy(asc(salesOrderItems.position));
  const notes = await database
    .select()
    .from(salesOrderNotes)
    .where(eq(salesOrderNotes.salesOrderId, row.internalId))
    .orderBy(desc(salesOrderNotes.createdAt), desc(salesOrderNotes.id));
  const quotationOrigin = await originForJoinedOrder(database, row);
  return detailFromJoined(row, items, quotationOrigin, notes, now);
}

async function originForJoinedOrder(
  database: SalesOrderDatabase,
  row: JoinedOrderRow,
): Promise<QuotationOriginProjection> {
  if (row.quotationId) {
    return readQuotationOrigin(database, {
      quotationId: row.quotationId,
      salesOrderId: row.internalId,
      quotationRevisionId: row.quotationRevisionId,
    });
  }
  return {
    status: 'missing',
    source: null,
    sourceLabel: 'Origem ausente',
    quotationNumber: null,
    salesOrderNumber: row.orderNumber,
    reason: 'order_quotation_missing',
  };
}

async function updateDealForQuotation(
  transaction: SalesOrderTransaction,
  quotationId: string,
  now: Date
): Promise<boolean> {
  const [quotation] = await transaction
    .select({ opportunityId: quotations.opportunityId })
    .from(quotations)
    .where(eq(quotations.id, quotationId))
    .limit(1);
  const linkedDeals = await transaction
    .select({ id: crmDeals.id, status: crmDeals.status, updatedAt: crmDeals.updatedAt })
    .from(crmDeals)
    .where(eq(crmDeals.quotationId, quotationId));
  const opportunityIds = new Set<string>();
  if (quotation?.opportunityId) opportunityIds.add(String(quotation.opportunityId));
  for (const deal of linkedDeals) opportunityIds.add(String(deal.id));
  if (opportunityIds.size === 0) return false;

  const deals = await transaction
    .select({ id: crmDeals.id, status: crmDeals.status, updatedAt: crmDeals.updatedAt })
    .from(crmDeals)
    .where(inArray(crmDeals.id, [...opportunityIds]));
  let changed = false;
  let cancelledAt: Date | null = null;
  for (const deal of deals) {
    if (deal.status === 'Perdido' || deal.status === 'Pedido Fechado') {
      // Terminal already: still ensure the active commercial action is gone so
      // a repeated order event cannot leave stale queue work behind.
      await transaction
        .update(opportunityNextActions)
        .set({
          state: 'completed',
          updatedAt: now,
          transitionActor: 'system',
          transitionAt: now,
          transitionOrigin: 'event',
          transitionReason: 'Pedido comercial vinculado',
          replacedById: null,
        })
        .where(
          and(
            eq(opportunityNextActions.opportunityId, deal.id),
            eq(opportunityNextActions.state, 'active'),
          ),
        );
      continue;
    }
    const previous = asDate(deal.updatedAt, new Date(0));
    const updatedAt = now.getTime() > previous.getTime() ? now : new Date(previous.getTime() + 1);
    await transaction
      .update(crmDeals)
      .set({ status: 'Pedido Fechado', updatedAt })
      .where(eq(crmDeals.id, deal.id));
    await transaction
      .update(opportunityNextActions)
      .set({
        state: 'completed',
        updatedAt,
        transitionActor: 'system',
        transitionAt: updatedAt,
        transitionOrigin: 'event',
        transitionReason: 'Pedido comercial vinculado',
        replacedById: null,
      })
      .where(
        and(
          eq(opportunityNextActions.opportunityId, deal.id),
          eq(opportunityNextActions.state, 'active'),
        ),
      );
    cancelledAt = updatedAt;
    changed = true;
  }
  if (cancelledAt) {
    await cancelQuotationFollowUpForFact(transaction, quotationId, 'crm_not_eligible', cancelledAt);
  }
  return changed;
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
    const crmUpdated = (SUBMITTED_ORDER_STATUSES as readonly string[]).includes(existing.status)
      ? await updateDealForQuotation(transaction, quotation.id, options.now)
      : false;
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
      deliveryDate: null,
      productionStage: 'aguardando_entrada',
      productionStageChangedAt: createdAt,
      productionDays: revision.productionDays,
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

const UNDO_WINDOW_MS = 2 * 60 * 1000;
const MAX_NOTE_LENGTH = 4000;
const BOARD_LIMIT = 500;
const LOCKED_ORDER_STATUSES = new Set(['Draft', 'Cancelled', 'Closed']);

interface StageUndoState {
  to_stage: ProductionStage;
  previous: {
    productionStage: string;
    productionStageChangedAt: string;
    depositReceivedOn: string | null;
    depositAmount: string | null;
    artApprovedOn: string | null;
    deliveryDate: string | null;
    readyOn: string | null;
    deliveredOn: string | null;
    perBilled: string;
    perDelivered: string;
    status: string;
  };
}

function isStageUndoState(value: unknown): value is StageUndoState {
  const candidate = value as StageUndoState | null;
  return Boolean(
    candidate &&
      typeof candidate === 'object' &&
      isProductionStage(candidate.to_stage) &&
      candidate.previous &&
      typeof candidate.previous === 'object'
  );
}

function canUndo(note: SalesOrderNoteRow, currentStage: ProductionStage, now: Date): boolean {
  if (note.kind !== 'stage' || !isStageUndoState(note.undoState)) return false;
  if (note.undoState.to_stage !== currentStage) return false;
  return now.getTime() - asDate(note.createdAt).getTime() <= UNDO_WINDOW_MS;
}

function formatCivilDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function requiredDate(value: unknown, label: string): string {
  const date = validateDate(value, label);
  if (!date) throw new SalesOrderInputError(`${label} é obrigatória.`);
  return date;
}

function moneyInput(value: unknown, label: string, max: number): number {
  const amount = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) {
    throw new SalesOrderInputError(`${label} deve ser um valor maior ou igual a zero.`);
  }
  if (amount > max) {
    throw new SalesOrderInputError(`${label} não pode passar do total do pedido.`);
  }
  return roundNumber(amount);
}

function noteBody(value: unknown): string {
  const body = typeof value === 'string' ? value.trim() : '';
  if (!body) throw new SalesOrderInputError('Escreva a anotação.');
  if (body.length > MAX_NOTE_LENGTH) {
    throw new SalesOrderInputError('A anotação pode ter até 4000 caracteres.');
  }
  return body;
}

function noteId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!isUuid(id)) throw new SalesOrderInputError('Anotação inválida.');
  return id;
}

function stageNoteBody(
  stage: ProductionStage,
  date: string,
  depositAmount: number | undefined
): string {
  const label = PRODUCTION_STAGE_LABELS[stage];
  if (stage === 'aguardando_arte' && depositAmount !== undefined) {
    return `${label} · entrada de ${formatMoney(depositAmount)} em ${formatCivilDate(date)}`;
  }
  if (stage === 'em_producao') return `${label} · arte aprovada em ${formatCivilDate(date)}`;
  return `${label} em ${formatCivilDate(date)}`;
}

function paymentState(
  current: SalesOrderRow,
  depositAmount: number | null,
  balanceReceivedOn: string | null,
  perDelivered: number
): { perBilled: string; perDelivered: string; status: string } {
  const perBilled = billedPercent(asMoney(current.grandTotal), depositAmount, balanceReceivedOn);
  return {
    perBilled: String(perBilled),
    perDelivered: String(perDelivered),
    status: deriveSalesOrderStatus(current.status, perBilled, perDelivered),
  };
}

async function lockOrder(
  transaction: SalesOrderTransaction,
  id: string
): Promise<SalesOrderRow> {
  const [current] = await transaction
    .select()
    .from(salesOrders)
    .where(orderPredicate(id))
    .for('update')
    .limit(1);
  if (!current) throw new SalesOrderNotFoundError();
  return current;
}

function assertEditable(current: SalesOrderRow): void {
  if (LOCKED_ORDER_STATUSES.has(current.status)) {
    throw new SalesOrderConflictError(
      'Pedidos em rascunho, cancelados ou fechados não podem ser alterados.'
    );
  }
}

async function advanceStage(
  transaction: SalesOrderTransaction,
  current: SalesOrderRow,
  input: Extract<SalesOrderAction, { action: 'advance' }>,
  now: Date,
  idFactory: () => string
): Promise<void> {
  assertEditable(current);
  const stage = rowStage(current);
  if (input.expected_stage !== stage) {
    throw new SalesOrderConflictError(
      'O pedido já está em outra etapa. Atualize a página; etapas não voltam.'
    );
  }
  const target = nextProductionStage(stage);
  if (!target) throw new SalesOrderConflictError('O pedido já foi entregue.');
  const date = requiredDate(input.date, 'Data');
  const grandTotal = asMoney(current.grandTotal);
  const changes: Partial<typeof salesOrders.$inferInsert> = {
    productionStage: target,
    productionStageChangedAt: now,
    updatedAt: now,
  };
  let depositAmount: number | undefined;
  if (target === 'aguardando_arte') {
    depositAmount =
      input.deposit_amount === undefined
        ? defaultDepositAmount(grandTotal)
        : moneyInput(input.deposit_amount, 'Valor da entrada', grandTotal);
    changes.depositReceivedOn = date;
    changes.depositAmount = depositAmount.toFixed(2);
    Object.assign(
      changes,
      paymentState(current, depositAmount, current.balanceReceivedOn, asMoney(current.perDelivered))
    );
  } else if (target === 'em_producao') {
    changes.artApprovedOn = date;
    if (!current.deadlineManual) {
      changes.deliveryDate = productionDeadline(date, current.productionDays);
    }
  } else if (target === 'pronto') {
    changes.readyOn = date;
  } else {
    changes.deliveredOn = date;
    const depositValue = current.depositAmount === null ? null : asMoney(current.depositAmount);
    Object.assign(changes, paymentState(current, depositValue, current.balanceReceivedOn, 100));
  }
  const undoState: StageUndoState = {
    to_stage: target,
    previous: {
      productionStage: current.productionStage,
      productionStageChangedAt: asDate(current.productionStageChangedAt).toISOString(),
      depositReceivedOn: current.depositReceivedOn,
      depositAmount: current.depositAmount,
      artApprovedOn: current.artApprovedOn,
      deliveryDate: current.deliveryDate,
      readyOn: current.readyOn,
      deliveredOn: current.deliveredOn,
      perBilled: String(current.perBilled),
      perDelivered: String(current.perDelivered),
      status: current.status,
    },
  };
  await transaction.update(salesOrders).set(changes).where(eq(salesOrders.id, current.id));
  await transaction.insert(salesOrderNotes).values({
    id: idFactory(),
    salesOrderId: current.id,
    kind: 'stage',
    body: stageNoteBody(target, date, depositAmount),
    undoState,
    createdAt: now,
    updatedAt: now,
  });
}

async function undoStage(
  transaction: SalesOrderTransaction,
  current: SalesOrderRow,
  rawNoteId: unknown,
  now: Date
): Promise<void> {
  const id = noteId(rawNoteId);
  const [latest] = await transaction
    .select()
    .from(salesOrderNotes)
    .where(and(eq(salesOrderNotes.salesOrderId, current.id), eq(salesOrderNotes.kind, 'stage')))
    .orderBy(desc(salesOrderNotes.createdAt), desc(salesOrderNotes.id))
    .limit(1);
  if (!latest || latest.id !== id || !canUndo(latest, rowStage(current), now)) {
    throw new SalesOrderConflictError('Esta mudança de etapa não pode mais ser desfeita.');
  }
  const { previous } = latest.undoState as StageUndoState;
  await transaction
    .update(salesOrders)
    .set({
      productionStage: previous.productionStage,
      productionStageChangedAt: asDate(previous.productionStageChangedAt),
      depositReceivedOn: previous.depositReceivedOn,
      depositAmount: previous.depositAmount,
      artApprovedOn: previous.artApprovedOn,
      deliveryDate: previous.deliveryDate,
      readyOn: previous.readyOn,
      deliveredOn: previous.deliveredOn,
      perBilled: previous.perBilled,
      perDelivered: previous.perDelivered,
      status: previous.status,
      updatedAt: now,
    })
    .where(eq(salesOrders.id, current.id));
  await transaction.delete(salesOrderNotes).where(eq(salesOrderNotes.id, latest.id));
}

const UPDATE_KEYS = new Set([
  'deposit_received_on',
  'deposit_amount',
  'art_approved_on',
  'production_days',
  'deadline',
  'ready_on',
  'delivered_on',
  'balance_received_on',
]);

async function updateProduction(
  transaction: SalesOrderTransaction,
  current: SalesOrderRow,
  input: Record<string, unknown>,
  now: Date
): Promise<void> {
  assertEditable(current);
  const keys = Object.keys(input).filter((key) => key !== 'action');
  if (keys.length === 0 || keys.some((key) => !UPDATE_KEYS.has(key))) {
    throw new SalesOrderInputError('Informe os campos de produção que devem mudar.');
  }
  const stage = rowStage(current);
  const grandTotal = asMoney(current.grandTotal);
  const changes: Partial<typeof salesOrders.$inferInsert> = { updatedAt: now };
  const requireStage = (target: ProductionStage, label: string) => {
    if (!stageReached(stage, target)) {
      throw new SalesOrderConflictError(`${label} só pode ser editada depois que o pedido chegar a essa etapa.`);
    }
  };

  let depositAmount = current.depositAmount === null ? null : asMoney(current.depositAmount);
  let balanceReceivedOn = current.balanceReceivedOn;
  let artApprovedOn = current.artApprovedOn;
  let productionDays = current.productionDays;
  let deadlineManual = current.deadlineManual;
  let deliveryDate = current.deliveryDate;

  if ('deposit_received_on' in input) {
    requireStage('aguardando_arte', 'A entrada');
    changes.depositReceivedOn = requiredDate(input.deposit_received_on, 'Data da entrada');
  }
  if ('deposit_amount' in input) {
    requireStage('aguardando_arte', 'A entrada');
    depositAmount = moneyInput(input.deposit_amount, 'Valor da entrada', grandTotal);
    changes.depositAmount = depositAmount.toFixed(2);
  }
  if ('balance_received_on' in input) {
    balanceReceivedOn =
      input.balance_received_on === null
        ? null
        : requiredDate(input.balance_received_on, 'Data do saldo');
    changes.balanceReceivedOn = balanceReceivedOn;
  }
  if ('art_approved_on' in input) {
    requireStage('em_producao', 'A arte aprovada');
    artApprovedOn = requiredDate(input.art_approved_on, 'Data da arte aprovada');
    changes.artApprovedOn = artApprovedOn;
  }
  if ('production_days' in input) {
    const days = input.production_days;
    if (!Number.isInteger(days) || Number(days) < 1 || Number(days) > 365) {
      throw new SalesOrderInputError('O prazo de produção deve ter de 1 a 365 dias úteis.');
    }
    productionDays = Number(days);
    changes.productionDays = productionDays;
  }
  if ('deadline' in input) {
    if (!artApprovedOn) {
      throw new SalesOrderConflictError('O prazo final só pode ser ajustado depois da arte aprovada.');
    }
    if (input.deadline === null) {
      deadlineManual = false;
    } else {
      deliveryDate = requiredDate(input.deadline, 'Prazo final');
      if (deliveryDate < artApprovedOn) {
        throw new SalesOrderInputError('O prazo final não pode ser antes da arte aprovada.');
      }
      deadlineManual = true;
    }
    changes.deadlineManual = deadlineManual;
  }
  if (artApprovedOn && !deadlineManual) {
    deliveryDate = productionDeadline(artApprovedOn, productionDays);
  }
  if (artApprovedOn) changes.deliveryDate = deliveryDate;
  if ('ready_on' in input) {
    requireStage('pronto', 'A data de pronto');
    changes.readyOn = requiredDate(input.ready_on, 'Data de pronto');
  }
  if ('delivered_on' in input) {
    requireStage('entregue', 'A data de entrega');
    changes.deliveredOn = requiredDate(input.delivered_on, 'Data de entrega');
  }
  if ('deposit_amount' in input || 'balance_received_on' in input) {
    Object.assign(
      changes,
      paymentState(current, depositAmount, balanceReceivedOn, asMoney(current.perDelivered))
    );
  }
  await transaction.update(salesOrders).set(changes).where(eq(salesOrders.id, current.id));
}

async function lockedNote(
  transaction: SalesOrderTransaction,
  current: SalesOrderRow,
  rawNoteId: unknown
): Promise<SalesOrderNoteRow> {
  const id = noteId(rawNoteId);
  const [note] = await transaction
    .select()
    .from(salesOrderNotes)
    .where(and(eq(salesOrderNotes.id, id), eq(salesOrderNotes.salesOrderId, current.id)))
    .for('update')
    .limit(1);
  if (!note) throw new SalesOrderNotFoundError('Anotação não encontrada.');
  if (note.kind !== 'note') {
    throw new SalesOrderConflictError('Mudanças de etapa não podem ser editadas nem apagadas.');
  }
  return note;
}

async function applyOrderAction(
  transaction: SalesOrderTransaction,
  current: SalesOrderRow,
  action: SalesOrderAction,
  now: Date,
  idFactory: () => string
): Promise<void> {
  switch (action.action) {
    case 'advance':
      return advanceStage(transaction, current, action, now, idFactory);
    case 'undo':
      return undoStage(transaction, current, action.note_id, now);
    case 'update':
      return updateProduction(transaction, current, action as unknown as Record<string, unknown>, now);
    case 'add_note':
      await transaction.insert(salesOrderNotes).values({
        id: idFactory(),
        salesOrderId: current.id,
        kind: 'note',
        body: noteBody(action.body),
        createdAt: now,
        updatedAt: now,
      });
      return;
    case 'edit_note': {
      const note = await lockedNote(transaction, current, action.note_id);
      await transaction
        .update(salesOrderNotes)
        .set({ body: noteBody(action.body), updatedAt: now })
        .where(eq(salesOrderNotes.id, note.id));
      return;
    }
    case 'delete_note': {
      const note = await lockedNote(transaction, current, action.note_id);
      await transaction.delete(salesOrderNotes).where(eq(salesOrderNotes.id, note.id));
      return;
    }
    default:
      throw new SalesOrderInputError('Ação inválida para o pedido.');
  }
}

const ATTENTION_ORDER: Record<string, number> = { atrasado: 0, em_risco: 1 };

function boardOrder(a: SalesOrderListItem, b: SalesOrderListItem): number {
  const attention =
    (ATTENTION_ORDER[a.production.state] ?? 2) - (ATTENTION_ORDER[b.production.state] ?? 2);
  if (attention !== 0) return attention;
  const deadlineA = a.production.deadline || '9999-12-31';
  const deadlineB = b.production.deadline || '9999-12-31';
  if (deadlineA !== deadlineB) return deadlineA < deadlineB ? -1 : 1;
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.order_number.localeCompare(b.order_number);
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
      const now = asDate(nowFactory());
      const where = salesOrderListWhere(rawOptions, now);
      const today = dateOnly(now);
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
          .select(joinedOrderSelection)
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
          items: rows.map((row) => mapListRow(row, today)),
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
        return await readOrderDetail(getDb(), orderPredicate(normalized), asDate(nowFactory()));
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async apply(id: string, action: SalesOrderAction): Promise<SalesOrderDetail> {
      const normalized = cleanId(id, 'ID do pedido');
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        throw new SalesOrderInputError('Envie um payload válido.');
      }
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
          const now = asDate(nowFactory());
          const current = await lockOrder(transaction, normalized);
          await applyOrderAction(transaction, current, action, now, idFactory);
          const detail = await readOrderDetail(transaction, eq(salesOrders.id, current.id), now);
          if (!detail) throw new SalesOrderRepositoryError('Não foi possível ler o pedido atualizado.');
          return detail;
        });
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async board(): Promise<SalesOrderBoardResult> {
      try {
        const now = asDate(nowFactory());
        const today = dateOnly(now);
        const rows = await getDb()
          .select(joinedOrderSelection)
          .from(salesOrders)
          .innerJoin(clients, eq(salesOrders.clientId, clients.id))
          .leftJoin(quotations, eq(salesOrders.quotationId, quotations.id))
          .where(
            and(
              notInArray(salesOrders.status, [...LOCKED_ORDER_STATUSES]),
              or(
                ne(salesOrders.productionStage, 'entregue'),
                gte(salesOrders.deliveredOn, addCalendarDays(today, -DELIVERED_BOARD_DAYS))
              )
            )
          )
          .orderBy(asc(salesOrders.transactionDate), asc(salesOrders.orderNumber))
          .limit(BOARD_LIMIT);
        const items = rows.map((row) => mapListRow(row, today)).sort(boardOrder);
        return {
          success: true,
          items,
          attention_count: items.filter((item) => needsAttention(item.production.state)).length,
        };
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
        const [topProducts, topCustomers, salesByDay, ordersBySource] = await Promise.all([
          dashboardTopProducts(database, start, end),
          dashboardTopCustomers(database, start, end),
          dashboardSalesByDay(database, start, end),
          dashboardOrdersBySource(database, start, end),
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
          orders_by_source: ordersBySource,
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
