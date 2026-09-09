export interface DashboardSummaryView {
  total_revenue: number;
  faturamento: number;
  custo: number;
  ads: number;
  ads_google: number;
  ads_meta: number;
  imposto: number;
  lucro: number;
  ads_google_unavailable: boolean;
  meta_editable: boolean;
  orders_count: number;
  avg_ticket: number;
  open_orders: number;
  conversion_rate: number;
  revenue_delta: number | null;
  orders_delta: number | null;
  avg_ticket_delta: number | null;
  conversion_delta: number | null;
}

export interface DashboardProductView {
  sku: string;
  product: string;
  quantity: number;
  revenue: number;
  custo: number;
  margem: number;
  orders: number;
}

export interface DashboardCustomerView {
  name: string;
  revenue: number;
  orders: number;
}

export interface DashboardDayView {
  date: string;
  revenue: number;
  orders: number;
}

export interface DashboardQuotationView {
  id: string;
  customer: string;
  age: number;
  value: number;
  status: string;
}

export interface DashboardListView<T> {
  items: T[];
  omitted: number;
}

export interface DashboardViewData {
  periodLabel: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  summary: DashboardSummaryView | null;
  topProducts: DashboardListView<DashboardProductView> | null;
  topCustomers: DashboardListView<DashboardCustomerView> | null;
  salesByDay: DashboardListView<DashboardDayView> | null;
  attention: DashboardListView<DashboardQuotationView> | null;
}

type RecordValue = Record<string, unknown>;

type Projector<T> = (value: unknown) => T | null;

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function identifier(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function nonnegativeNumber(value: unknown): number | undefined {
  const result = finiteNumber(value);
  return result !== undefined && result >= 0 ? result : undefined;
}

function safeCount(value: unknown): number | undefined {
  const result = nonnegativeNumber(value);
  return result !== undefined && Number.isSafeInteger(result) ? result : undefined;
}

function delta(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return finiteNumber(value) ?? null;
}

function projectList<T>(value: unknown, projector: Projector<T>): DashboardListView<T> | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  let omitted = 0;
  for (const entry of value) {
    const projected = projector(entry);
    if (projected) items.push(projected);
    else omitted += 1;
  }
  return { items, omitted };
}

function projectSummary(value: unknown): DashboardSummaryView | null {
  const source = asRecord(value);
  if (!source) return null;
  const totalRevenue = nonnegativeNumber(source.total_revenue);
  const faturamento = nonnegativeNumber(source.faturamento) ?? totalRevenue;
  const custo = nonnegativeNumber(source.custo) ?? 0;
  const ads = nonnegativeNumber(source.ads) ?? 0;
  const adsGoogle = nonnegativeNumber(source.ads_google) ?? 0;
  const adsMeta = nonnegativeNumber(source.ads_meta) ?? 0;
  const imposto = nonnegativeNumber(source.imposto) ?? 0;
  const lucro = finiteNumber(source.lucro) ?? 0;
  const ordersCount = safeCount(source.orders_count);
  const avgTicket = nonnegativeNumber(source.avg_ticket);
  const openOrders = safeCount(source.open_orders);
  const conversionRate = nonnegativeNumber(source.conversion_rate);
  if (
    totalRevenue === undefined ||
    faturamento === undefined ||
    ordersCount === undefined ||
    avgTicket === undefined ||
    openOrders === undefined ||
    conversionRate === undefined ||
    conversionRate > 1
  )
    return null;
  return {
    total_revenue: totalRevenue,
    faturamento,
    custo,
    ads,
    ads_google: adsGoogle,
    ads_meta: adsMeta,
    imposto,
    lucro,
    ads_google_unavailable: source.ads_google_unavailable === true,
    meta_editable: source.meta_editable === true,
    orders_count: ordersCount,
    avg_ticket: avgTicket,
    open_orders: openOrders,
    conversion_rate: conversionRate,
    revenue_delta: delta(source.revenue_delta),
    orders_delta: delta(source.orders_delta),
    avg_ticket_delta: delta(source.avg_ticket_delta),
    conversion_delta: delta(source.conversion_delta),
  };
}

function projectProduct(value: unknown): DashboardProductView | null {
  const source = asRecord(value);
  if (!source) return null;
  const sku = identifier(source.sku);
  const product = identifier(source.product);
  const quantity = nonnegativeNumber(source.quantity);
  const revenue = nonnegativeNumber(source.revenue);
  const custo = nonnegativeNumber(source.custo) ?? 0;
  const margem =
    finiteNumber(source.margem) ?? (revenue && revenue > 0 ? (revenue - custo) / revenue : 0);
  const orders = safeCount(source.orders);
  if (!sku || !product || quantity === undefined || revenue === undefined || orders === undefined)
    return null;
  return { sku, product, quantity, revenue, custo, margem, orders };
}

function projectCustomer(value: unknown): DashboardCustomerView | null {
  const source = asRecord(value);
  if (!source) return null;
  const name = identifier(source.name);
  const revenue = nonnegativeNumber(source.revenue);
  const orders = safeCount(source.orders);
  if (!name || revenue === undefined || orders === undefined) return null;
  return { name, revenue, orders };
}

function projectDay(value: unknown): DashboardDayView | null {
  const source = asRecord(value);
  if (!source) return null;
  const date = identifier(source.date);
  const revenue = nonnegativeNumber(source.revenue);
  const orders = safeCount(source.orders);
  if (!date || revenue === undefined || orders === undefined) return null;
  return { date, revenue, orders };
}

function projectQuotation(value: unknown): DashboardQuotationView | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = identifier(source.id);
  const customer = identifier(source.customer);
  const age = safeCount(source.age);
  const amount = nonnegativeNumber(source.value);
  const status = identifier(source.status);
  if (!id || !customer || age === undefined || amount === undefined || !status) return null;
  return { id, customer, age, value: amount, status };
}

/**
 * Keeps a successful response usable when an optional metric/list is absent.
 * Invalid rows are omitted instead of being rendered as invented values.
 */
export function projectDashboardView(value: unknown): DashboardViewData | null {
  const source = asRecord(value);
  if (!source || source.success !== true) return null;
  const period = asRecord(source.period);
  return {
    periodLabel: identifier(period?.label),
    periodFrom: identifier(period?.from),
    periodTo: identifier(period?.to),
    summary: projectSummary(source.summary),
    topProducts: projectList(source.top_products, projectProduct),
    topCustomers: projectList(source.top_customers, projectCustomer),
    salesByDay: projectList(source.sales_by_day, projectDay),
    attention: projectList(source.stale_quotations, projectQuotation),
  };
}
