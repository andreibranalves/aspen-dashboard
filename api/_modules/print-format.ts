export const DEFAULT_PRINT_FORMAT = 'padrao';
export const SIMPLE_PRINT_FORMAT = 'minimalista';

export const PRINT_FORMATS: Record<string, { value: string; label: string }> = {
  standard: { value: DEFAULT_PRINT_FORMAT, label: 'Tabela padrão' },
  comparison: { value: 'comparativo', label: 'Tabela comparativo' },
  simple: { value: SIMPLE_PRINT_FORMAT, label: 'Aspen Simples' },
};

export function normalizePrintFormat(value: unknown): string {
  const raw = String(value || '').trim();
  if (PRINT_FORMATS[raw]) return PRINT_FORMATS[raw].value;
  const match = Object.values(PRINT_FORMATS).find((format) => format.value === raw);
  return match?.value || DEFAULT_PRINT_FORMAT;
}

export function getPrintFormatLabel(value: unknown): string {
  const printFormat = normalizePrintFormat(value);
  const match = Object.values(PRINT_FORMATS).find((format) => format.value === printFormat);
  return match?.label || PRINT_FORMATS.standard.label;
}

export function shouldIncludePrintFormatParam(value: unknown): boolean {
  return normalizePrintFormat(value) !== DEFAULT_PRINT_FORMAT;
}

export async function resolvePrintFormat(
  _quotationId: string,
  explicitFormat?: string,
): Promise<string> {
  return normalizePrintFormat(explicitFormat);
}
