// Shared ERPNext REST client — centralized HTTP access, error handling, pagination.
// All new dashboard-facing functions MUST use this module instead of raw fetch calls.
//
// Usage:
//   import { erpGetList, erpGetDoc, erpPost, erpPut, erpDelete, createHttpError } from './lib/erpnext.js';

export interface HttpError extends Error {
  statusCode: number;
  logMessage: string;
}

const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';
const ERPNEXT_TOKEN = process.env.ERPNEXT_TOKEN;

// ── Error handling ──────────────────────────────────────────────────────────

/**
 * Create a structured error with separate public (user-facing) and internal (log) messages.
 * Non-2xx ERPNext responses throw these; handler catch blocks read .statusCode and .logMessage.
 */
function createHttpError(
  statusCode: number,
  publicMessage: string,
  logMessage?: string
): HttpError {
  const error = new Error(publicMessage) as HttpError;
  error.statusCode = statusCode;
  error.logMessage = logMessage || publicMessage;
  return error;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function buildHeaders(): Record<string, string> {
  return {
    'Authorization': `token ${ERPNEXT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Core fetch wrapper: makes the HTTP call, parses JSON, and throws structured
 * errors for non-2xx responses. Never returns raw ERPNext error data to callers.
 */
async function erpRequest(url: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (fetchErr) {
    throw createHttpError(
      502,
      'Falha de conexão com o sistema. Verifique sua rede e tente novamente.',
      `[erpnext] fetch() failed for ${url}: ${(fetchErr as Error).message}`
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

  return body as Record<string, unknown>;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface ErpGetListOpts {
  fields?: string[];
  filters?: Array<Array<string | number>>;
  or_filters?: Array<Array<string | number>>;
  order_by?: string;
  limit?: number;
  start?: number;
}

/**
 * Fetch a paginated list of documents from an ERPNext DocType.
 *
 * order_by is MANDATORY for reliable pagination (ERPNext bug #49037).
 * Default page size is 20 (ERPNext default).
 */
export async function erpGetList(
  doctype: string,
  opts: ErpGetListOpts = {}
): Promise<Array<Record<string, unknown>>> {
  const { fields, filters, or_filters, order_by = 'creation desc', limit, start } = opts;
  const params = new URLSearchParams();
  params.set('order_by', order_by);
  if (filters) params.set('filters', JSON.stringify(filters));
  if (or_filters) params.set('or_filters', JSON.stringify(or_filters));
  if (fields) params.set('fields', JSON.stringify(fields));
  if (limit != null) params.set('limit_page_length', String(limit));
  if (start != null) params.set('limit_start', String(start));

  const url = `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}?${params}`;
  const body = await erpRequest(url, { headers: buildHeaders() });
  return (body.data as Array<Record<string, unknown>>) || [];
}

export interface ErpGetDocOpts {
  fields?: string[];
}

/**
 * Fetch a single document by DocType and name.
 *
 * fields is best-effort in V1 API.
 */
export async function erpGetDoc(
  doctype: string,
  name: string,
  opts: ErpGetDocOpts = {}
): Promise<Record<string, unknown> | null> {
  const { fields } = opts;
  const params = new URLSearchParams();
  if (fields) params.set('fields', JSON.stringify(fields));

  const qs = params.toString();
  const url = `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}${qs ? '?' + qs : ''}`;
  const body = await erpRequest(url, { headers: buildHeaders() });
  return (body.data as Record<string, unknown>) || null;
}

/**
 * Create a new ERPNext document.
 */
export async function erpPost(
  doctype: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}`;
  const body = await erpRequest(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  return (body.data as Record<string, unknown>) || {};
}

/**
 * Update an existing ERPNext document.
 */
export async function erpPut(
  doctype: string,
  name: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
  const body = await erpRequest(url, {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  return (body.data as Record<string, unknown>) || {};
}

/**
 * Delete an ERPNext document.
 */
export async function erpDelete(doctype: string, name: string): Promise<void> {
  const url = `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
  await erpRequest(url, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
}

export { createHttpError, ERPNEXT_BASE, ERPNEXT_TOKEN };

// ── Frappe Method calls (whitelisted RPC) ──────────────────────────────────

/**
 * Call a whitelisted Frappe/ERPNext method via /api/method/<path>.
 * Used for server-side document operations: submit, make_sales_order, etc.
 */
export async function erpCallMethod(
  methodPath: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  const url = `${ERPNEXT_BASE}/api/method/${encodeURIComponent(methodPath)}`;
  const body = await erpRequest(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  // Frappe wraps method responses in { message: ... }
  return (body as Record<string, unknown>).message ?? (body as Record<string, unknown>).data ?? body;
}
