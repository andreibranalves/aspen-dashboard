export const PRINT_FORMAT_OPTIONS = [
  {
    value: 'Aspen 1.0',
    label: 'Tabela padrão',
    description: 'Linhas tradicionais com preço, quantidade e subtotal.',
  },
  {
    value: 'Aspen 1.1',
    label: 'Tabela comparativo',
    description: 'Produtos agrupados com preços por faixa de quantidade.',
  },
];

export const DEFAULT_PRINT_FORMAT = PRINT_FORMAT_OPTIONS[0].value;
export const LS_ACTIVE_PRINT_FORMAT = 'aspen_active_print_format';

export function normalizePrintFormat(value) {
  const raw = String(value || '').trim();
  return PRINT_FORMAT_OPTIONS.find(option => option.value === raw)?.value || DEFAULT_PRINT_FORMAT;
}

export function loadActivePrintFormat() {
  try {
    return normalizePrintFormat(localStorage.getItem(LS_ACTIVE_PRINT_FORMAT));
  } catch {
    return DEFAULT_PRINT_FORMAT;
  }
}

export function saveActivePrintFormat(value) {
  const normalized = normalizePrintFormat(value);
  try {
    localStorage.setItem(LS_ACTIVE_PRINT_FORMAT, normalized);
  } catch {
    // localStorage can be unavailable in private/sandboxed contexts.
  }
  return normalized;
}

export function getPrintFormatLabel(value) {
  return PRINT_FORMAT_OPTIONS.find(option => option.value === normalizePrintFormat(value))?.label || PRINT_FORMAT_OPTIONS[0].label;
}

export function buildQuotationViewUrl(quotationId, printFormat = loadActivePrintFormat()) {
  const params = new URLSearchParams({ q: quotationId });
  const normalized = normalizePrintFormat(printFormat);
  if (normalized !== DEFAULT_PRINT_FORMAT) {
    params.set('format', normalized);
  }
  return `/api/view?${params.toString()}`;
}
