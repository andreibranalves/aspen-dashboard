// Shared quotation HTML rendering — extracted from view.js.
// Used by view.js (preview) and quotation-pdf.js (PDF generation).
// All functions require ERPNEXT_TOKEN in the environment.

const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';

import { normalizePrintFormat } from './print-format.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Escape a string for use in a RegExp constructor.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a clean customer name from ERPNext Lead if the quotation
 * is for a Lead and the customer_name contains CRM-LEAD.
 */
async function resolveLeadName(partyName) {
  const token = process.env.ERPNEXT_TOKEN;
  try {
    const res = await fetch(
      `${ERPNEXT_BASE}/api/resource/Lead/${encodeURIComponent(partyName)}?fields=["first_name","lead_name"]`,
      { headers: { Authorization: `token ${token}` } }
    );
    if (!res.ok) return null;
    const doc = await res.json();
    return doc.data?.first_name || doc.data?.lead_name || null;
  } catch {
    return null;
  }
}

/**
 * Fetch and render the quotation HTML from ERPNext printview.
 *
 * @param {string} quotationId
 * @param {object} [opts]
 * @param {boolean} [opts.includePrintButton=true] — inject "Imprimir / Salvar PDF" button
 * @param {boolean} [opts.forPdf=false] — tweak CSS for PDF output (hide print button, etc.)
 * @returns {Promise<{ html: string, customerName: string }>}
 */
export async function renderQuotationHtml(quotationId, opts = {}) {
  const { includePrintButton = true, forPdf = false } = opts;
  const printFormat = normalizePrintFormat(opts.printFormat);
  const token = process.env.ERPNEXT_TOKEN;
  const url = `${ERPNEXT_BASE}/printview?doctype=Quotation&name=${encodeURIComponent(quotationId)}&format=${encodeURIComponent(printFormat)}&no_letterhead=0`;

  let html;
  let customerName = '';

  const [printRes, docRes] = await Promise.all([
    fetch(url, { headers: { Authorization: `token ${token}` } }),
    fetch(
      `${ERPNEXT_BASE}/api/resource/Quotation/${encodeURIComponent(quotationId)}?fields=["customer_name","party_name","quotation_to"]`,
      { headers: { Authorization: `token ${token}` } }
    ),
  ]);

  if (!printRes.ok) {
    throw Object.assign(new Error('Orçamento não encontrado'), { statusCode: 404 });
  }

  html = await printRes.text();

  if (docRes.ok) {
    const doc = await docRes.json();
    customerName = doc.data?.customer_name || '';
    const partyName = doc.data?.party_name || '';
    const quotationTo = doc.data?.quotation_to || '';

    let cleanName = customerName;
    if (quotationTo === 'Lead' && partyName && (!customerName || customerName.includes('CRM-LEAD'))) {
      const leadName = await resolveLeadName(partyName);
      if (leadName) cleanName = leadName;
    }

    if (cleanName && partyName && partyName !== cleanName) {
      const escapedParty = escapeRegExp(partyName);
      const regex = new RegExp(`(Nome(?:<[^>]+>)*\\s*:(?:\\s|&nbsp;|<[^>]+>)*)${escapedParty}`, 'g');
      html = html.replace(regex, `$1${cleanName}`);
      html = html.replace(new RegExp(escapedParty, 'g'), cleanName);
    }

    customerName = cleanName;
  }

  const pageTitle = customerName ? `${quotationId} - ${customerName}` : quotationId;
  html = html.includes('<title>')
    ? html.replace(/<title>[^<]*<\/title>/, `<title>${pageTitle}</title>`)
    : html.replace('<head>', `<head><title>${pageTitle}</title>`);

  // ── CSS / JS injection ──
  const injections = [];

  // Core print CSS (shared)
  injections.push(`
<style>
  .print-toolbar, .page-head, .navbar, .container > .row:first-child,
  body > nav, body > header, body > .toolbar,
  [data-page-route], .frappe-toolbar, #toolbar-area,
  .print-preview-header, .web-header,
  body > div:first-child:not(.print-format-gutter):not(.print-preview) { display: none !important; }
  @media screen {
    html, body { background: #e8e8e8 !important; margin: 0 !important; padding: 24px 0 !important; display: flex; justify-content: center; }
    .print-format-gutter { padding: 0 !important; height: auto !important; display: flex; justify-content: center; }
    .print-format { padding: 0 !important; margin: 0 auto !important; box-shadow: 0 2px 16px rgba(0,0,0,0.12) !important; height: auto !important; min-height: unset !important; }
    .print-format { display: flex !important; flex-direction: column !important; }
    .fixed-header { position: static !important; height: auto !important; order: 1; }
    .content { padding-top: 0 !important; padding-bottom: 0 !important; order: 2; }
    .fixed-footer { position: static !important; margin-top: 40px; order: 3; }
    .page-2-content { padding-top: 32px !important; }
    .page-break { display: none !important; break-after: unset !important; page-break-after: unset !important; }
  }
  @media print { @page { margin: 0; } body { margin: 0; background: #fff; } #print-btn { display: none; } }
</style>`);

  // Print button (only for preview)
  if (includePrintButton && !forPdf) {
    injections.push(`
<style>
  #print-btn {
    position: fixed; top: 16px; right: 16px;
    background: #1D2F56; color: #fff; border: none; border-radius: 4px;
    padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer;
    font-family: -apple-system, sans-serif; z-index: 9999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18);
  }
  #print-btn:hover { background: #162344; }
</style>
<button id="print-btn" onclick="window.print()">Imprimir / Salvar PDF</button>`);
  }

  // "Get PDF" toolbar removal script
  injections.push(`
<script>
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('a').forEach(function(a) {
    if (a.textContent.trim() === 'Get PDF') {
      var parent = a.parentElement;
      while (parent && parent !== document.body) {
        var style = window.getComputedStyle(parent);
        if (parent.children.length <= 3 && (parent.tagName === 'DIV' || parent.tagName === 'P')) {
          parent.style.display = 'none';
          break;
        }
        parent = parent.parentElement;
      }
    }
  });
});
</script>`);

  html = html.replace('</head>', `${injections.join('\n')}</head>`);

  return { html, customerName };
}
