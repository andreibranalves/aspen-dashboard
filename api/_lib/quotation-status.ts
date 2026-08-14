export type QuotationStatus = 'rascunho' | 'emitido' | 'aprovado' | 'perdido';

export function canonicalQuotationStatus(value: unknown): QuotationStatus {
  if (value === 'enviado') return 'emitido';
  if (value === 'rascunho' || value === 'emitido' || value === 'aprovado' || value === 'perdido') return value;
  throw new Error('Estado comercial inválido.');
}

export function isIssuedQuotationStatus(value: unknown): boolean {
  const status = canonicalQuotationStatus(value);
  return status === 'emitido' || status === 'aprovado';
}

export function assertQuotationTransition(from: unknown, to: unknown, lossReason?: string): void {
  const source = canonicalQuotationStatus(from);
  if (to === 'enviado') throw new Error('Estado comercial inválido.');
  const target = canonicalQuotationStatus(to);
  const allowed = source === 'rascunho'
    ? target === 'emitido'
    : source === 'emitido'
      ? target === 'aprovado' || target === 'perdido'
      : false;
  if (!allowed) throw new Error('Transição comercial inválida.');
  if (target === 'perdido' && !lossReason?.trim()) throw new Error('Informe o motivo da perda.');
}
