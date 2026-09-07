export interface QuotationOriginView {
  status: 'linked' | 'missing' | 'conflict';
  source: string | null;
  sourceLabel: string;
  quotationNumber: string | null;
  salesOrderNumber: string | null;
  reason: string | null;
}

export function projectQuotationOrigin(value: unknown): QuotationOriginView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.status !== 'linked' && row.status !== 'missing' && row.status !== 'conflict') return null;
  if (typeof row.sourceLabel !== 'string') return null;
  const nullable = (field: unknown): string | null => typeof field === 'string' ? field : null;
  return {
    status: row.status,
    source: nullable(row.source),
    sourceLabel: row.sourceLabel,
    quotationNumber: nullable(row.quotationNumber),
    salesOrderNumber: nullable(row.salesOrderNumber),
    reason: nullable(row.reason),
  };
}
