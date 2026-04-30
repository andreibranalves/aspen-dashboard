const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';

export async function handler(event) {
  const quotationId = event.queryStringParameters?.q;
  if (!quotationId) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'Parâmetro ?q= obrigatório' };
  }

  const token = process.env.ERPNEXT_TOKEN;
  const url = `${ERPNEXT_BASE}/printview?doctype=Quotation&name=${encodeURIComponent(quotationId)}&format=Aspen%201.0&no_letterhead=0`;

  let html;
  let customerName = '';
  try {
    const [printRes, docRes] = await Promise.all([
      fetch(url, { headers: { Authorization: `token ${token}` } }),
      fetch(`${ERPNEXT_BASE}/api/resource/Quotation/${encodeURIComponent(quotationId)}?fields=["customer_name","party_name","quotation_to"]`, { headers: { Authorization: `token ${token}` } }),
    ]);
    if (!printRes.ok) return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Orçamento não encontrado' };
    html = await printRes.text();
    if (docRes.ok) {
      const doc = await docRes.json();
      customerName = doc.data?.customer_name || '';
      const partyName = doc.data?.party_name || '';
      const quotationTo = doc.data?.quotation_to || '';
      
      let cleanName = customerName;
      if (quotationTo === 'Lead' && partyName && (!customerName || customerName.includes('CRM-LEAD'))) {
        try {
          const leadRes = await fetch(`${ERPNEXT_BASE}/api/resource/Lead/${encodeURIComponent(partyName)}?fields=["first_name","lead_name"]`, { headers: { Authorization: `token ${token}` } });
          if (leadRes.ok) {
            const leadDoc = await leadRes.json();
            cleanName = leadDoc.data?.first_name || leadDoc.data?.lead_name || customerName;
          }
        } catch (e) {
          console.error('Error fetching lead:', e);
        }
      }

      if (cleanName && partyName && partyName !== cleanName) {
        const escapedParty = partyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(Nome(?:<[^>]+>)*\\s*:(?:\\s|&nbsp;|<[^>]+>)*)${escapedParty}`, 'g');
        html = html.replace(regex, `$1${cleanName}`);
        html = html.replace(new RegExp(escapedParty, 'g'), cleanName);
      }
      if (quotationTo === 'Lead' && partyName && html.includes(partyName)) {
        console.warn('CRM-LEAD still present in HTML for Quotation', quotationId);
      }
      customerName = cleanName;
    }
  } catch (err) {
    return { statusCode: 502, headers: { 'Content-Type': 'text/plain' }, body: 'Erro ao buscar orçamento' };
  }

  const pageTitle = customerName ? `${quotationId} - ${customerName}` : quotationId;
  html = html.includes('<title>')
    ? html.replace(/<title>[^<]*<\/title>/, `<title>${pageTitle}</title>`)
    : html.replace('<head>', `<head><title>${pageTitle}</title>`);

  // Remove Frappe toolbar, force print layout
  const inject = `
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
    /* Converter fixed → static para preview no browser, reordenar footer para o fim */
    .print-format { display: flex !important; flex-direction: column !important; }
    .fixed-header { position: static !important; height: auto !important; order: 1; }
    .content { padding-top: 0 !important; padding-bottom: 0 !important; order: 2; }
    .fixed-footer { position: static !important; margin-top: 40px; order: 3; }
    .page-2-content { padding-top: 32px !important; }
    .page-break { display: none !important; break-after: unset !important; page-break-after: unset !important; }
  }
  @media print { @page { margin: 0; } body { margin: 0; background: #fff; } #print-btn { display: none; } }
  #print-btn {
    position: fixed; top: 16px; right: 16px;
    background: #1D2F56; color: #fff; border: none; border-radius: 4px;
    padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer;
    font-family: -apple-system, sans-serif; z-index: 9999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18);
  }
  #print-btn:hover { background: #162344; }
</style>
<button id="print-btn" onclick="window.print()">Imprimir / Salvar PDF</button>
<script>
document.addEventListener('DOMContentLoaded', function() {
  // Remove Frappe "Print Get PDF" toolbar by finding links with text "Get PDF"
  document.querySelectorAll('a').forEach(function(a) {
    if (a.textContent.trim() === 'Get PDF') {
      var parent = a.parentElement;
      // Walk up to find the toolbar container and hide it
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
</script>`;

  html = html.replace('</head>', `${inject}</head>`);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
}
