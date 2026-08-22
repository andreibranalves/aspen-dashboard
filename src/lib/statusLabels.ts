// ── Canonical status vocabulary ──────────────────────────────────────────
// Single source of truth for status labels in pt-BR. Every screen must
// render status through these maps so the same state never appears under
// two different names (Emitido vs Enviado vs Rascunho persistido).

export type QuotationStatusCanonical =
  | 'rascunho'
  | 'emitido'
  | 'aprovado'
  | 'recusado'
  | 'expirado'
  | 'cancelado'
  | 'unknown';

interface StatusMeta {
  label: string;
  badge: string; // StatusBadge variant key
}

const QUOTATION_STATUS_META: Record<QuotationStatusCanonical, StatusMeta> = {
  rascunho: { label: 'Rascunho', badge: 'Draft' },
  emitido: { label: 'Emitido', badge: 'Issued' },
  aprovado: { label: 'Aprovado', badge: 'Ordered' },
  recusado: { label: 'Perdido', badge: 'Lost' },
  expirado: { label: 'Expirado', badge: 'Expired' },
  cancelado: { label: 'Cancelado', badge: 'Cancelled' },
  unknown: { label: 'Status desconhecido', badge: 'Draft' },
};

export function normalizeQuotationStatus(status: unknown): QuotationStatusCanonical {
  const value = String(status || '').toLowerCase();
  if (value in QUOTATION_STATUS_META) return value as QuotationStatusCanonical;
  // Sinônimos legados pt-BR usados pelo backend/listas antigas.
  if (value === 'issued' || value === 'enviado') return 'emitido';
  if (value === 'draft') return 'rascunho';
  if (value === 'approved' || value === 'ordered') return 'aprovado';
  if (
    value === 'lost' || value === 'refused' || value === 'rejected' ||
    value === 'recusado' || value === 'perdido'
  ) {
    return 'recusado';
  }
  if (value === 'expired') return 'expirado';
  if (value === 'cancelled' || value === 'canceled') return 'cancelado';
  // Status não reconhecido não pode virar um estado comercial válido.
  return 'unknown';
}

export function quotationStatusLabel(status: unknown): string {
  return QUOTATION_STATUS_META[normalizeQuotationStatus(status)].label;
}

export function quotationStatusBadgeKey(status: unknown): string {
  return QUOTATION_STATUS_META[normalizeQuotationStatus(status)].badge;
}

/** Rótulos pt-BR acentuados para as etapas do pipeline (valores crus do backend). */
export const PIPELINE_LABELS: Record<string, string> = {
  'Novo Lead': 'Novo lead',
  'Contato Feito': 'Contato feito',
  'Orcamento Enviado': 'Orçamento enviado',
  'Em Negociacao': 'Em negociação',
  'Arte Aprovada': 'Arte aprovada',
  'Pedido Fechado': 'Pedido fechado',
  Perdido: 'Perdido',
};

export function pipelineLabel(stage: string): string {
  return PIPELINE_LABELS[stage] ?? stage;
}
