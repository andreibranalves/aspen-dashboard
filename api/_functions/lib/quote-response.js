// api/_functions/lib/quote-response.js
// Response assembly for the quotation pipeline.
// Extracted from orcamento.js — no behavior changes.

const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';
const ERPNEXT_TOKEN = process.env.ERPNEXT_TOKEN;

import { DEFAULT_PRINT_FORMAT } from './print-format.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildViewUrl(baseUrl, quotationId) {
  const params = new URLSearchParams({ q: quotationId });
  return `${baseUrl}/api/view?${params.toString()}`;
}

function buildBaseUrl(event) {
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
 *
 * @param {string} quotationId
 * @param {string} entityType - 'Customer' or 'Lead'
 * @param {string} entityId - ERPNext entity ID
 * @param {string} nomeCliente - sanitized client name (for Lead display fix)
 * @returns {Promise<string|null>} HTML string or null
 */
async function fetchPrintHtml(quotationId, entityType, entityId, nomeCliente) {
  const pdfUrl = `${ERPNEXT_BASE}/printview?doctype=Quotation&name=${encodeURIComponent(quotationId)}&format=${encodeURIComponent(DEFAULT_PRINT_FORMAT)}&no_letterhead=0`;

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
</style></head>`,
    );

    // For Leads, replace the auto-generated name with the real client name
    if (entityType === 'Lead' && html && entityId) {
      const escapedId = entityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const leadNameRegex = new RegExp(
        `(Nome(?:<[^>]+>)*\\s*:(?:\\s|&nbsp;|<[^>]+>)*)${escapedId}`,
        'g',
      );
      html = html.replace(leadNameRegex, `$1${nomeCliente}`);
    }

    return html;
  } catch (htmlErr) {
    console.error('[quote-response] Printview fetch failed:', htmlErr.message);
    return null;
  }
}

// ── URL shortening ───────────────────────────────────────────────────────────

async function shortenUrl(longUrl) {
  try {
    const tinyRes = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`,
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

/**
 * Build the full API response object for a completed quotation.
 *
 * @param {object} opts
 * @param {object} opts.event - Vercel event object (for host/protocol)
 * @param {string} opts.quotationId
 * @param {string} opts.dealId
 * @param {string} opts.entityId
 * @param {string} opts.entityType
 * @param {boolean} opts.customerIsNew
 * @param {string} opts.nomeCliente
 * @param {boolean} opts.urgente
 * @param {Array} opts.savedItems - [{item_code, qty, rate}]
 * @param {string} opts.origem
 * @param {Array} [opts.warnings] - optional warning objects
 * @returns {Promise<object>} result object ready for JSON.stringify
 */
export async function buildQuoteResponse({
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
}) {
  const baseUrl = buildBaseUrl(event);
  const fullUrl = buildViewUrl(baseUrl, quotationId);
  const shortUrl = await shortenUrl(fullUrl);
  const printHtml = await fetchPrintHtml(quotationId, entityType, entityId, nomeCliente);

  const pdfUrl = `${ERPNEXT_BASE}/printview?doctype=Quotation&name=${encodeURIComponent(quotationId)}&format=${encodeURIComponent(DEFAULT_PRINT_FORMAT)}&no_letterhead=0`;

  const result = {
    success: true,
    quotation_id: quotationId,
    deal_id: dealId,
    customer_id: entityId,
    customer_new: customerIsNew,
    cliente: nomeCliente,
    urgente,
    items: savedItems.map((i) => ({ sku: i.item_code, qty: i.qty, rate: i.rate })),
    pdf_url: pdfUrl,
    print_html: printHtml,
    view_url: fullUrl,
    short_url: shortUrl,
    origem,
  };

  if (warnings.length > 0) {
    result.warnings = warnings;
  }

  return result;
}
