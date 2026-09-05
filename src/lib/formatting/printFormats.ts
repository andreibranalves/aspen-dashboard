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
