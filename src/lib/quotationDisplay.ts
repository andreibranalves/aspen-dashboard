export function quotationDisplayTitle(businessNumber: string | null | undefined): string {
  const value = String(businessNumber || '').trim();
  if (!value) return 'Orçamento';
  return /^ORC-/i.test(value) ? `Orçamento ${value}` : `Orçamento #${value}`;
}

export function quotationItemCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'itens'}`;
}

function normalizedText(value: string | null | undefined): string {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function quotationContentHasText(value: string | null | undefined): boolean {
  return Boolean(normalizedText(value));
}

export function quotationContentsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const normalizedLeft = normalizedText(left);
  return Boolean(normalizedLeft) && normalizedLeft === normalizedText(right);
}
