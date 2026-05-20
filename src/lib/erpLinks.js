/**
 * erpLinks.js — Centraliza montagem de URLs para documentos ERPNext.
 *
 * Todas as funções retornam null se parâmetros obrigatórios estiverem ausentes,
 * permitindo que a UI mostre a ação desabilitada ou oculta.
 */

const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';

/**
 * Monta URL genérica para qualquer doctype do ERPNext.
 *
 * @param {string} [baseUrl] — URL base do ERPNext (usa default se ausente)
 * @param {string} doctype  — Nome do doctype (ex: 'Quotation', 'CRM Deal')
 * @param {string} name      — ID/nome do documento
 * @returns {string|null}
 */
export function buildErpDocUrl(baseUrl, doctype, name) {
  const base = baseUrl || ERPNEXT_BASE;
  if (!doctype || !name) return null;
  // Frappe Cloud Desk usa /app/<doctype>/<name> (lowercase, hífens)
  const route = doctype.toLowerCase().replace(/\s+/g, '-');
  return `${base}/app/${route}/${encodeURIComponent(name)}`;
}

// ── Conveniências tipadas ──

/**
 * @param {string} [baseUrl]
 * @param {string} quotationId — ex: 'ORC-20261143'
 * @returns {string|null}
 */
export function buildQuotationErpUrl(baseUrl, quotationId) {
  return buildErpDocUrl(baseUrl, 'Quotation', quotationId);
}

/**
 * @param {string} [baseUrl]
 * @param {string} salesOrderId — ex: 'SAL-ORD-2026-00001'
 * @returns {string|null}
 */
export function buildSalesOrderErpUrl(baseUrl, salesOrderId) {
  return buildErpDocUrl(baseUrl, 'Sales Order', salesOrderId);
}

/**
 * @param {string} [baseUrl]
 * @param {string} customerId
 * @returns {string|null}
 */
export function buildCustomerErpUrl(baseUrl, customerId) {
  return buildErpDocUrl(baseUrl, 'Customer', customerId);
}

/**
 * @param {string} [baseUrl]
 * @param {string} leadId
 * @returns {string|null}
 */
export function buildLeadErpUrl(baseUrl, leadId) {
  return buildErpDocUrl(baseUrl, 'Lead', leadId);
}

/**
 * @param {string} [baseUrl]
 * @param {string} dealId
 * @returns {string|null}
 */
export function buildCrmDealErpUrl(baseUrl, dealId) {
  return buildErpDocUrl(baseUrl, 'CRM Deal', dealId);
}
