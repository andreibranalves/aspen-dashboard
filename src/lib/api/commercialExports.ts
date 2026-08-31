import { createApiError } from '../../types/api.ts';

export const COMMERCIAL_EXPORT_RESOURCES = [
  'clients',
  'products',
  'product-pricing',
  'sales-orders',
  'sales-order-items',
] as const;

export type CommercialExportResource = (typeof COMMERCIAL_EXPORT_RESOURCES)[number];
export type CommercialExportFilters = Record<string, string | number | null | undefined>;

const FILTER_KEYS: Record<CommercialExportResource, readonly string[]> = {
  clients: ['search', 'status'],
  products: ['search', 'status', 'order_by', 'categoria'],
  'product-pricing': ['search', 'status', 'order_by', 'categoria'],
  'sales-orders': ['period', 'status', 'search', 'from', 'to'],
  'sales-order-items': ['period', 'status', 'search', 'from', 'to'],
};

export function commercialExportPath(
  resource: CommercialExportResource,
  filters: CommercialExportFilters
): string {
  const params = new URLSearchParams({ resource });
  for (const key of FILTER_KEYS[resource]) {
    const value = filters[key];
    if (value === null || value === undefined || String(value).trim() === '') continue;
    params.set(key, String(value));
  }
  return `/commercial-exports?${params.toString()}`;
}


export async function downloadCommercialExport(
  resource: CommercialExportResource,
  filters: CommercialExportFilters
): Promise<void> {
  const path = commercialExportPath(resource, filters);
  const response = await fetch(`/api${path}`, { method: 'GET' });
  if (response.status === 401) {
    window.location.hash = '#/login';
    const error = createApiError(new Error('Sessão expirada.'));
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível gerar a exportação. Tente novamente.';
    const error = createApiError(new Error(message));
    error.status = response.status;
    error.data = payload;
    throw error;
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    const disposition = response.headers.get('Content-Disposition') || '';
    const fileNameMatch = /filename="([^"\r\n]+)"/i.exec(disposition);
    anchor.download = fileNameMatch?.[1] || 'exportacao.csv';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
