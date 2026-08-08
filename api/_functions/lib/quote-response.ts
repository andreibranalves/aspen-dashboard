// api/_functions/lib/quote-response.ts
// Response assembly for the quotation pipeline.
// Extracted from orcamento.js — no behavior changes.

const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';
const ERPNEXT_TOKEN = process.env.ERPNEXT_TOKEN;

import { resolvePrintFormat } from './print-format.js';

export interface VercelEventLike {
  headers?: Record<string, string | undefined>;
}

export interface SavedQuoteItem {
  item_code: string;
  qty: number;
  rate: number;
}

export interface BuildQuoteResponseOptions {
  event: VercelEventLike;
  quotationId: string;
  dealId: string;
  entityId: string;
  entityType: string;
  customerIsNew: boolean;
  nomeCliente: string;
  urgente: boolean;
  savedItems: SavedQuoteItem[];
  origem: string;
  warnings?: Array<{ code: string; message: string }>;
  /** Only a revision-bound public URL may be emitted to customers. */
  publicUrl?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildViewUrl(_baseUrl: string, _quotationId: string): string {
  // Generic /api/view is admin-protected and must never be shared as a
  // customer link. PostgreSQL callers provide a revision-bound publicUrl.
  return '';
}

function buildBaseUrl(event: VercelEventLike): string {
  const host = event.headers?.host || 'project-xr5jg.vercel.app';
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);
  const protocol = isLocalHost
    ? 'http'
    : (event.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${protocol}://${host}`;
}

// ── PDF HTML fetch ───────────────────────────────────────────────────────────

/**
 * Fetch and enhance the ERPNext printview HTML.
 */
async function fetchPrintHtml(
  quotationId: string,
  entityType: string,
  entityId: string,
  nomeCliente: string
): Promise<string | null> {
  const printFormat = await resolvePrintFormat(quotationId);
  const pdfUrl = `${ERPNEXT_BASE}/printview?doctype=Quotation&name=${encodeURIComponent(quotationId)}&format=${encodeURIComponent(printFormat)}&no_letterhead=0`;

  try {
    const htmlRes = await fetch(pdfUrl, {
      headers: { Authorization: `token ${ERPNEXT_TOKEN}` },
    });
    if (!htmlRes.ok) return null;

    let html = (await htmlRes.text()).replace(
      '</head>',
      `<style>
body > div:first-child:not(.print-format-gutter) { display: none !important; }
@media print { @page { margin: 0; } body { margin: 0; } }
</style></head>`
    );

    // For Leads, replace the auto-generated name with the real client name
    if (entityType === 'Lead' && html && entityId) {
      const escapedId = entityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const leadNameRegex = new RegExp(
        `(Nome(?:<[^>]+>)*\\s*:(?:\\s|&nbsp;|<[^>]+>)*)${escapedId}`,
        'g'
      );
      html = html.replace(leadNameRegex, `$1${nomeCliente}`);
    }

    return html;
  } catch (htmlErr) {
    const err = htmlErr as Error;
    console.error('[quote-response] Printview fetch failed:', err.message);
    return null;
  }
}

// ── URL shortening ───────────────────────────────────────────────────────────

async function shortenUrl(longUrl: string): Promise<string> {
  try {
    const tinyRes = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`
    );
    if (tinyRes.ok) {
      const tiny = (await tinyRes.text()).trim();
      if (tiny.startsWith('https://') && tiny.length < longUrl.length) {
        return tiny;
      }
    }
  } catch {
    // non-fatal — keep full URL
  }
  return longUrl;
}

// ── Result builder ───────────────────────────────────────────────────────────

export async function buildQuoteResponse(
  opts: BuildQuoteResponseOptions
): Promise<Record<string, unknown>> {
  const {
    event,
    quotationId,
    dealId,
    entityId,
    entityType,
    customerIsNew,
    nomeCliente,
    urgente,
    savedItems,
    origem,
    warnings = [],
  } = opts;

  const baseUrl = buildBaseUrl(event);
  const fullUrl = opts.publicUrl && !/\/api\/view(?:[/?]|$)/i.test(opts.publicUrl)
    ? opts.publicUrl
    : buildViewUrl(baseUrl, quotationId);
  const shortUrl = fullUrl ? await shortenUrl(fullUrl) : '';
  const printHtml = await fetchPrintHtml(quotationId, entityType, entityId, nomeCliente);

  const printFormat = await resolvePrintFormat(quotationId);
  const pdfUrl = `${ERPNEXT_BASE}/printview?doctype=Quotation&name=${encodeURIComponent(quotationId)}&format=${encodeURIComponent(printFormat)}&no_letterhead=0`;

  const result: Record<string, unknown> = {
    success: true,
    quotation_id: quotationId,
    deal_id: dealId,
    customer_id: entityId,
    customer_new: customerIsNew,
    cliente: nomeCliente,
    urgente,
    items: savedItems.map((i: SavedQuoteItem) => ({ sku: i.item_code, qty: i.qty, rate: i.rate })),
    pdf_url: pdfUrl,
    print_html: printHtml,
    view_url: fullUrl,
    short_url: shortUrl,
    origem,
    ...(fullUrl ? {} : { public_link_unavailable: 'O link público requer uma revisão PostgreSQL compartilhável.' }),
  };

  if (warnings.length > 0) {
    result.warnings = warnings;
  }

  return result;
}
