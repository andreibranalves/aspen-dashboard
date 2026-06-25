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
  baseUrl: string | undefined,
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
  baseUrl: string | undefined,
  quotationId: string,
): string | null {
  return buildErpDocUrl(baseUrl, 'Quotation', quotationId);
}

export function buildSalesOrderErpUrl(
  baseUrl: string | undefined,
  salesOrderId: string,
): string | null {
  return buildErpDocUrl(baseUrl, 'Sales Order', salesOrderId);
}

export function buildCustomerErpUrl(
  baseUrl: string | undefined,
  customerId: string,
): string | null {
  return buildErpDocUrl(baseUrl, 'Customer', customerId);
}

export function buildLeadErpUrl(
  baseUrl: string | undefined,
  leadId: string,
): string | null {
  return buildErpDocUrl(baseUrl, 'Lead', leadId);
}

export function buildCrmDealErpUrl(
  baseUrl: string | undefined,
  dealId: string,
): string | null {
  return buildErpDocUrl(baseUrl, 'CRM Deal', dealId);
}
