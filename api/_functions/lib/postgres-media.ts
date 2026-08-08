import { ERPNEXT_BASE } from './erpnext.js';

const PUBLIC_BLOB_HOST = /(^|\.)public\.blob\.vercel-storage\.com$/i;

function parsedOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

export function isFrappeMediaUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim(), ERPNEXT_BASE);
    const frappe = new URL(ERPNEXT_BASE);
    return (
      parsed.protocol === frappe.protocol &&
      parsed.hostname.toLowerCase() === frappe.hostname.toLowerCase() &&
      parsed.port === frappe.port &&
      parsed.origin === frappe.origin
    );
  } catch {
    return false;
  }
}

/**
 * Return a canonical URL only for same-origin public assets or Vercel Blob
 * public assets. Frappe, API routes, data URLs, credentials and arbitrary
 * external hosts are rejected before a PostgreSQL message can be sent.
 */
export function normalizePostgresMediaUrl(value: unknown, applicationOrigin: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Mídia pública inválida.');
  }
  const raw = value.trim();
  if (raw.startsWith('//') || /^data:/i.test(raw) || /^javascript:/i.test(raw)) {
    throw new Error('Mídia pública inválida.');
  }

  const origin = parsedOrigin(applicationOrigin);
  if (!origin) throw new Error('Origem da aplicação inválida.');
  let parsed: URL;
  try {
    parsed = new URL(raw, origin);
  } catch {
    throw new Error('Mídia pública inválida.');
  }

  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error('Mídia pública inválida.');
  }
  if (isFrappeMediaUrl(parsed.href)) throw new Error('Mídia Frappe não permitida.');
  if (parsed.pathname.startsWith('/api/')) throw new Error('Mídia pública inválida.');

  const sameOrigin = parsed.origin === origin;
  const publicBlob = PUBLIC_BLOB_HOST.test(parsed.hostname);
  if (!sameOrigin && !publicBlob) throw new Error('Mídia pública inválida.');
  return parsed.href;
}
