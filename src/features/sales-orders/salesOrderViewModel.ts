export interface SalesOrderItemView {
  item_code: string;
  item_name?: string;
  qty: number;
  rate: number;
  amount?: number;
  uom?: string;
}

export interface SalesOrderDetailView {
  id: string;
  status: string;
  customer_name?: string;
  date?: string;
  data?: string;
  delivery_date?: string;
  source_quotation?: string;
  grand_total?: number;
  rounded_total?: number;
  per_delivered?: number;
  per_billed?: number;
  items?: SalesOrderItemView[];
  omitted_items: number;
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function money(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}

function projectItem(value: unknown): SalesOrderItemView | null {
  const source = asRecord(value);
  if (!source) return null;
  const itemCode = text(source.item_code);
  const qty = money(source.qty);
  const rate = money(source.rate);
  if (!itemCode || qty === undefined || rate === undefined) return null;
  const itemName = text(source.item_name);
  const amount = money(source.amount);
  const uom = text(source.uom);
  return {
    item_code: itemCode,
    ...(itemName ? { item_name: itemName } : {}),
    qty,
    rate,
    ...(amount !== undefined ? { amount } : {}),
    ...(uom ? { uom } : {}),
  };
}

/**
 * Projects only fields the sales-order detail endpoint confirms. Missing
 * optional fields remain absent so the page can show an honest placeholder.
 */
export function projectSalesOrderDetail(value: unknown): SalesOrderDetailView | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = text(source.id);
  const status = text(source.status);
  if (!id || !status) return null;

  let items: SalesOrderItemView[] | undefined;
  let omittedItems = 0;
  if (Array.isArray(source.items)) {
    items = [];
    for (const entry of source.items) {
      const item = projectItem(entry);
      if (item) items.push(item);
      else omittedItems += 1;
    }
  }

  return {
    id,
    status,
    ...(text(source.customer_name) ? { customer_name: text(source.customer_name) } : {}),
    ...(text(source.date) ? { date: text(source.date) } : {}),
    ...(text(source.data) ? { data: text(source.data) } : {}),
    ...(text(source.delivery_date) ? { delivery_date: text(source.delivery_date) } : {}),
    ...(text(source.source_quotation) ? { source_quotation: text(source.source_quotation) } : {}),
    ...(money(source.grand_total) !== undefined ? { grand_total: money(source.grand_total) } : {}),
    ...(money(source.rounded_total) !== undefined
      ? { rounded_total: money(source.rounded_total) }
      : {}),
    ...(money(source.per_delivered) !== undefined
      ? { per_delivered: money(source.per_delivered) }
      : {}),
    ...(money(source.per_billed) !== undefined ? { per_billed: money(source.per_billed) } : {}),
    ...(items ? { items } : {}),
    omitted_items: omittedItems,
  };
}
