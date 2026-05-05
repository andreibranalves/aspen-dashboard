// Shared ERPNext REST client — centralized HTTP access, error handling, pagination.
// All new dashboard-facing functions MUST use this module instead of raw fetch calls.
//
// Usage:
//   import { erpGetList, erpGetDoc, erpPost, erpPut, erpDelete, createHttpError } from './lib/erpnext.js';

const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';
const ERPNEXT_TOKEN = process.env.ERPNEXT_TOKEN;

// ── Error handling ──────────────────────────────────────────────────────────

/**
 * Create a structured error with separate public (user-facing) and internal (log) messages.
 * Non-2xx ERPNext responses throw these; handler catch blocks read .statusCode and .logMessage.
 *
 * @param {number} statusCode - HTTP status code
 * @param {string} publicMessage - Safe Portuguese message for the client
 * @param {string} [logMessage] - Internal details for server logs (defaults to publicMessage)
 * @returns {Error} Error with statusCode and logMessage properties
 */
function createHttpError(statusCode, publicMessage, logMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.logMessage = logMessage || publicMessage;
  return error;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function buildHeaders() {
  return {
    'Authorization': `token ${ERPNEXT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Core fetch wrapper: makes the HTTP call, parses JSON, and throws structured
 * errors for non-2xx responses. Never returns raw ERPNext error data to callers.
 */
async function erpRequest(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (fetchErr) {
    throw createHttpError(
      502,
      'Falha de conexão com o sistema. Verifique sua rede e tente novamente.',
      `[erpnext] fetch() failed for ${url}: ${fetchErr.message}`
    );
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const serverMsg = body?.message || body?.exception || body?._server_messages || '';
    const logDetail = typeof serverMsg === 'string' ? serverMsg : JSON.stringify(serverMsg);
    throw createHttpError(
      res.status >= 500 ? 502 : 400,
      `Erro ao acessar o sistema (${res.status}). Tente novamente.`,
      `[erpnext] ${options.method || 'GET'} ${url} → ${res.status}: ${logDetail}`
    );
  }

  return body;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch a paginated list of documents from an ERPNext DocType.
 *
 * order_by is MANDATORY for reliable pagination (ERPNext bug #49037).
 * Default page size is 20 (ERPNext default).
 *
 * @param {string} doctype - ERPNext DocType name (e.g., 'Quotation', 'Item')
 * @param {object} [opts]
 * @param {string[]} [opts.fields] - Fields to include in the response
 * @param {Array} [opts.filters] - ERPNext filter array, e.g. [['status', '=', 'Draft']]
 * @param {Array} [opts.or_filters] - ERPNext OR filter array (OR-joined with each other, AND-joined with filters)
 * @param {string} [opts.order_by='creation desc'] - Sort order. Do NOT omit for paginated queries.
 * @param {number} [opts.limit] - Page size (limit_page_length, default 20)
 * @param {number} [opts.start] - Offset (limit_start, default 0)
 * @returns {Promise<Array>} Array of document objects
 */
export async function erpGetList(doctype, opts = {}) {
  const { fields, filters, or_filters, order_by = 'creation desc', limit, start } = opts;
  const params = new URLSearchParams();
  params.set('order_by', order_by);
  if (filters) params.set('filters', JSON.stringify(filters));
  if (or_filters) params.set('or_filters', JSON.stringify(or_filters));
  if (fields) params.set('fields', JSON.stringify(fields));
  if (limit != null) params.set('limit_page_length', String(limit));
  if (start != null) params.set('limit_start', String(start));

  const url = `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}?${params}`;
  const body = await erpRequest(url);
  return body.data || [];
}

/**
 * Fetch a single document by DocType and name.
 *
 * @param {string} doctype - ERPNext DocType name
 * @param {string} name - Document name/ID
 * @param {object} [opts]
 * @param {string[]} [opts.fields] - Fields to include (best-effort in V1 API)
 * @returns {Promise<object|null>} Document data or null if not found
 */
export async function erpGetDoc(doctype, name, opts = {}) {
  const { fields } = opts;
  const params = new URLSearchParams();
  if (fields) params.set('fields', JSON.stringify(fields));

  const qs = params.toString();
  const url = `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}${qs ? '?' + qs : ''}`;
  const body = await erpRequest(url);
  return body.data || null;
}

/**
 * Create a new ERPNext document.
 *
 * @param {string} doctype - ERPNext DocType name
 * @param {object} payload - Document fields
 * @returns {Promise<object>} Created document data (includes .name)
 */
export async function erpPost(doctype, payload) {
  const url = `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}`;
  const body = await erpRequest(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  return body.data || {};
}

/**
 * Update an existing ERPNext document.
 *
 * @param {string} doctype - ERPNext DocType name
 * @param {string} name - Document name/ID to update
 * @param {object} payload - Fields to update
 * @returns {Promise<object>} Updated document data
 */
export async function erpPut(doctype, name, payload) {
  const url = `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
  const body = await erpRequest(url, {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  return body.data || {};
}

/**
 * Delete an ERPNext document.
 *
 * @param {string} doctype - ERPNext DocType name
 * @param {string} name - Document name/ID to delete
 * @returns {Promise<void>}
 */
export async function erpDelete(doctype, name) {
  const url = `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
  await erpRequest(url, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
}

export { createHttpError, ERPNEXT_BASE, ERPNEXT_TOKEN };
