import { projectQuotationOrigin, type QuotationOriginView } from '../quotations/quotationOrigin.ts';
import {
  PRODUCTION_STAGES,
  type DeadlineState,
  type ProductionOrder,
  type ProductionStage,
  type ProductionTimeline,
  type SalesOrderNote,
} from './productionModel.ts';

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
  quotation_origin?: QuotationOriginView;
  production?: ProductionOrder;
  notes: SalesOrderNote[];
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

const DEADLINE_STATES: readonly DeadlineState[] = [
  'sem_prazo',
  'no_prazo',
  'em_risco',
  'atrasado',
  'concluido',
];
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function civilDate(value: unknown): string | null {
  return typeof value === 'string' && CIVIL_DATE.test(value) ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function projectTimeline(value: unknown): ProductionTimeline | null {
  const source = asRecord(value);
  if (!source || !DEADLINE_STATES.includes(source.state as DeadlineState)) return null;
  return {
    deadline: civilDate(source.deadline),
    total_days: count(source.total_days),
    elapsed_days: count(source.elapsed_days),
    state: source.state as DeadlineState,
    stalled_days: count(source.stalled_days),
  };
}

/** Campos de produção de um pedido (quadro ou detalhe); null quando o contrato não confere. */
export function projectProductionOrder(value: unknown): ProductionOrder | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = text(source.id);
  const stage = source.production_stage as ProductionStage;
  const production = projectTimeline(source.production);
  const grandTotal = money(source.grand_total);
  if (!id || !PRODUCTION_STAGES.includes(stage) || !production || grandTotal === undefined) {
    return null;
  }
  return {
    id,
    order_number: text(source.order_number) || id,
    customer_name: text(source.customer_name) || '',
    grand_total: grandTotal,
    status: text(source.status) || '',
    date: civilDate(source.date) || '',
    production_stage: stage,
    production,
    production_days: count(source.production_days) || 20,
    deadline_manual: source.deadline_manual === true,
    deposit_received_on: civilDate(source.deposit_received_on),
    deposit_amount: money(source.deposit_amount) ?? null,
    art_approved_on: civilDate(source.art_approved_on),
    ready_on: civilDate(source.ready_on),
    delivered_on: civilDate(source.delivered_on),
    balance_received_on: civilDate(source.balance_received_on),
    received_amount: money(source.received_amount) ?? 0,
  };
}

function projectNote(value: unknown): SalesOrderNote | null {
  const source = asRecord(value);
  const id = text(source?.id);
  const body = text(source?.body);
  const createdAt = text(source?.created_at);
  if (!source || !id || !body || !createdAt || (source.kind !== 'note' && source.kind !== 'stage')) {
    return null;
  }
  return {
    id,
    kind: source.kind,
    body,
    created_at: createdAt,
    updated_at: text(source.updated_at) || createdAt,
    undoable: source.undoable === true,
  };
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
    ...(projectProductionOrder(source) ? { production: projectProductionOrder(source)! } : {}),
    notes: Array.isArray(source.notes)
      ? source.notes.map(projectNote).filter((note): note is SalesOrderNote => note !== null)
      : [],
    ...(projectQuotationOrigin(source.quotation_origin)
      ? { quotation_origin: projectQuotationOrigin(source.quotation_origin)! }
      : {}),
  };
}
