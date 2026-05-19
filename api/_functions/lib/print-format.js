export const DEFAULT_PRINT_FORMAT = 'Aspen 1.0';

export const PRINT_FORMATS = {
  standard: {
    value: 'Aspen 1.0',
    label: 'Tabela padrão',
  },
  comparison: {
    value: 'Aspen 1.1',
    label: 'Tabela comparativo',
  },
};

export function normalizePrintFormat(value) {
  const raw = String(value || '').trim();
  if (PRINT_FORMATS[raw]) return PRINT_FORMATS[raw].value;
  const match = Object.values(PRINT_FORMATS).find(format => format.value === raw);
  return match?.value || DEFAULT_PRINT_FORMAT;
}

export function getPrintFormatLabel(value) {
  const printFormat = normalizePrintFormat(value);
  const match = Object.values(PRINT_FORMATS).find(format => format.value === printFormat);
  return match?.label || PRINT_FORMATS.standard.label;
}

export function shouldIncludePrintFormatParam(value) {
  return normalizePrintFormat(value) !== DEFAULT_PRINT_FORMAT;
}
