import type {
  QuoteDraftManagementDetail,
  QuoteDraftManagementItem,
  QuoteDraftManagementListRow,
} from '../_infrastructure/db/repositories/quote-draft-management-repository.js';
import { canonicalQuotationStatus, type QuotationStatus } from './quotation-status.js';

/**
 * Canonical quotation contract: exactly one name per concept (revision,
 * status, expiration, values, concurrency token). Legacy aliases remain
 * emitted by the repository and mapped to this shape only at the HTTP edge;
 * the repository model never changes.
 */
export interface CanonicalQuotationItem {
  code: string;
  sku: string;
  quantity: string;
  name: string;
  description: string;
  unit: string;
  category: string | null;
  brand: string | null;
  unitPrice: string;
  lineTotal: string;
  manualRate: boolean;
}

export interface CanonicalQuotationRevisionEntry {
  revisionId: string;
  revision: number;
  createdAt: string;
  validadeDias: number;
  subtotal: string;
  total: string;
  status: QuotationStatus;
  expired: boolean;
}

export interface CanonicalQuotationBase {
  revisionId: string;
  revision: number;
  status: QuotationStatus;
  clienteId: string;
  cliente: string;
  data: string;
  /** Canonical expiration date (ISO). */
  validade: string;
  validadeDias: number;
  subtotal: string;
  /** Canonical total amount. */
  total: string;
  frete: string;
  /** Canonical expiration flag. */
  expired: boolean;
  /** Canonical optimistic-concurrency token. */
  concurrencyToken: string;
  updatedAt: string;
}

export interface CanonicalQuotationListRow extends CanonicalQuotationBase {
  id: string;
  businessNumber: string;
  name: string;
  emailSent: boolean;
}

export interface CanonicalQuotationDetail extends CanonicalQuotationBase {
  id: string;
  businessNumber: string;
  name: string;
  emailSent: boolean;
  emailSentAt: string | null;
  pagamento: string;
  entrega: string;
  observacoes: string;
  prazoProducao: string;
  templateKey: string;
  templateHash: string;
  items: CanonicalQuotationItem[];
  revisionHistory: CanonicalQuotationRevisionEntry[];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function firstBoolean(...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return false;
}

function mapItem(item: QuoteDraftManagementItem): CanonicalQuotationItem {
  return {
    code: item.item_code,
    sku: item.sku,
    quantity: item.qty,
    name: item.nome,
    description: item.descricao,
    unit: item.unidade,
    category: item.categoria,
    brand: item.marca,
    unitPrice: item.applied_unit_price,
    lineTotal: item.line_total,
    manualRate: item.manual_rate,
  };
}

export function mapRevisionHistoryEntry(entry: QuoteDraftManagementDetail['revision_history'][number]): CanonicalQuotationRevisionEntry {
  return {
    revisionId: entry.revision_id,
    revision: entry.revision_number,
    createdAt: entry.created_at,
    validadeDias: entry.validade_dias,
    subtotal: entry.subtotal,
    total: entry.total,
    status: canonicalQuotationStatus(entry.status_canonical || entry.status),
    expired: firstBoolean(entry.derived_expired, entry.expiration_derived, entry.is_expired, entry.expirada),
  };
}

function baseFields(row: QuoteDraftManagementDetail | QuoteDraftManagementListRow) {
  return {
    revisionId: row.revision_id,
    revision: row.revision_number,
    status: canonicalQuotationStatus(row.status_canonical || row.status),
    clienteId: firstString(row.client_id, (row as { cliente_id?: unknown }).cliente_id),
    cliente: row.cliente,
    data: row.data,
    validade: firstString(row.validade, (row as { validity_date?: unknown }).validity_date),
    validadeDias: row.validade_dias,
    subtotal: row.subtotal,
    total: firstString(row.total, (row as { valor?: unknown }).valor),
    frete: row.frete,
    expired: firstBoolean(
      (row as { derived_expired?: unknown }).derived_expired,
      (row as { expiration_derived?: unknown }).expiration_derived,
      (row as { is_expired?: unknown }).is_expired,
      (row as { expirada?: unknown }).expirada,
    ),
    concurrencyToken: firstString(row.concurrency_token, row.optimistic_concurrency_token),
    updatedAt: firstString(row.updated_at, (row as { updatedAt?: unknown }).updatedAt),
  };
}

export function toCanonicalQuotationListRow(row: QuoteDraftManagementListRow): CanonicalQuotationListRow {
  return {
    ...baseFields(row),
    id: row.quotation_uuid,
    businessNumber: row.quotation_id,
    name: row.cliente,
    emailSent: row.email_sent,
  };
}

export function toCanonicalQuotationDetail(detail: QuoteDraftManagementDetail): CanonicalQuotationDetail {
  return {
    ...baseFields(detail),
    id: detail.quotation_uuid,
    businessNumber: detail.quotation_id,
    name: detail.quotation_name,
    emailSent: detail.email_sent,
    emailSentAt: detail.email_sent_at,
    pagamento: detail.pagamento,
    entrega: detail.entrega,
    observacoes: detail.observacoes,
    prazoProducao: detail.prazo_producao,
    templateKey: detail.template_key,
    templateHash: detail.template_hash,
    items: (detail.items || []).map(mapItem),
    revisionHistory: (detail.revision_history || []).map(mapRevisionHistoryEntry),
  };
}
