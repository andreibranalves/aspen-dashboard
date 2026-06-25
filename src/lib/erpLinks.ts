/**
 * erpLinks.ts — Centraliza montagem de URLs para documentos ERPNext.
 *
 * Todas as funções retornam null se parâmetros obrigatórios estiverem ausentes,
 * permitindo que a UI mostre a ação desabilitada ou oculta.
 */

const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';

/**
 * Monta URL genérica para qualquer doctype do ERPNext.
 */
export function buildErpDocUrl(
  baseUrl: string | null | undefined,
  doctype: string,
  name: string,
): string | null {
  const base = baseUrl || ERPNEXT_BASE;
  if (!doctype || !name) return null;
  // Frappe Cloud Desk usa /app/<doctype>/<name> (lowercase, hífens)
  const route = doctype.toLowerCase().replace(/\s+/g, '-');
  return `${base}/app/${route}/${encodeURIComponent(name)}`;
}

// ── Conveniências ──

export function buildQuotationErpUrl(
  baseUrl: string | null | undefined,
  quotationId: string,
): string | null {
  return buildErpDocUrl(baseUrl, 'Quotation', quotationId);
}

export function buildSalesOrderErpUrl(
  baseUrl: string | null | undefined,
  salesOrderId: string,
): string | null {
  return buildErpDocUrl(baseUrl, 'Sales Order', salesOrderId);
}

export function buildCustomerErpUrl(
  baseUrl: string | null | undefined,
  customerId: string,
): string | null {
  return buildErpDocUrl(baseUrl, 'Customer', customerId);
}

export function buildLeadErpUrl(
  baseUrl: string | null | undefined,
  leadId: string,
): string | null {
  return buildErpDocUrl(baseUrl, 'Lead', leadId);
}

export function buildCrmDealErpUrl(
  baseUrl: string | null | undefined,
  dealId: string,
): string | null {
  return buildErpDocUrl(baseUrl, 'CRM Deal', dealId);
}
