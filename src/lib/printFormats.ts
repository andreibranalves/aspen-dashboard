export interface PrintFormatOption {
  value: string;
  label: string;
  description: string;
}

export const PRINT_FORMAT_OPTIONS: PrintFormatOption[] = [
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

export function normalizePrintFormat(value: unknown): string {
  const raw = String(value || '').trim();
  return PRINT_FORMAT_OPTIONS.find(option => option.value === raw)?.value || DEFAULT_PRINT_FORMAT;
}

export function loadActivePrintFormat(): string {
  try {
    return normalizePrintFormat(localStorage.getItem(LS_ACTIVE_PRINT_FORMAT));
  } catch {
    return DEFAULT_PRINT_FORMAT;
  }
}

export function saveActivePrintFormat(value: unknown): string {
  const normalized = normalizePrintFormat(value);
  try {
    localStorage.setItem(LS_ACTIVE_PRINT_FORMAT, normalized);
  } catch {
    // localStorage can be unavailable in private/sandboxed contexts.
  }
  return normalized;
}

export function getPrintFormatLabel(value: unknown): string {
  return PRINT_FORMAT_OPTIONS.find(option => option.value === normalizePrintFormat(value))?.label || PRINT_FORMAT_OPTIONS[0].label;
}

/** Immutable PostgreSQL revision preview URL. Never include this value in customer messages. */
export function buildQuotationPreviewUrl(revisionId: string, format: 'html' | 'pdf' = 'pdf'): string {
  const params = new URLSearchParams({ id: revisionId });
  if (format === 'pdf') params.set('format', 'pdf');
  return `/api/quotation-preview?${params.toString()}`;
}

/** Accept only revision-bound public quotation links for customer messages. */
export function normalizePublicQuotationUrl(value: unknown, applicationOrigin?: string): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  try {
    const origin = applicationOrigin || (typeof window !== 'undefined' ? window.location.origin : '');
    const parsed = new URL(raw, origin || 'https://public-quotation.invalid');
    const token = parsed.searchParams.get('token') || '';
    const relative = raw.startsWith('/') && !raw.startsWith('//');
    return parsed.pathname === '/api/public-quotation' && /^[A-Za-z0-9_-]{32,256}$/.test(token) &&
      (relative || Boolean(origin && parsed.origin === new URL(origin).origin))
      ? raw
      : '';
  } catch {
    return '';
  }
}
