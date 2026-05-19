const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';
const ERPNEXT_TOKEN = process.env.ERPNEXT_TOKEN;

import { createHttpError, erpGetList, erpGetDoc, erpPost, erpPut } from './lib/erpnext.js';
import { DEFAULT_PRINT_FORMAT } from './lib/print-format.js';

const ERPNEXT_HEADERS = {
  'Authorization': `token ${ERPNEXT_TOKEN}`,
  'Content-Type': 'application/json',
};

// ── Pricing (delegated to shared module) ─────────────────────────────────────

import { getBracket, getRate, getUrgentRate } from './pricing.js';

async function localGetRate(itemCode, qty) {
  return getRate(itemCode, qty, ERPNEXT_BASE, ERPNEXT_TOKEN);
}

function buildViewUrl(baseUrl, quotationId) {
  const params = new URLSearchParams({ q: quotationId });
  return `${baseUrl}/api/view?${params.toString()}`;
}

// ── Name helpers ─────────────────────────────────────────────────────────────

function sanitizeName(name) {
  return name.trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatPhone(phone) {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '')
    .replace(/^55(\d{10,11})$/, '$1')   // remove DDI 55
    .replace(/^0(\d{10,11})$/, '$1');   // remove 0 inicial
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return phone;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const extracted = payload.extracted;
  if (!extracted) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Campo "extracted" obrigatório' }) };
  }

  try {
    const nomeCliente = sanitizeName(extracted.nome);
    const email = extracted.email?.trim().toLowerCase() || '';
    const telefone = formatPhone(extracted.telefone || '');
    const urgente = extracted.urgente || false;
    let items = (extracted.items || []).map(item => ({
      item_code: item.item_code,
      qty: item.qty,
      rate: item.rate,
      manual_rate: item.manual_rate === true,
    }));
    items = items.filter(item => item.item_code && item.qty > 0);
    if (items.length === 0) {
      throw createHttpError(400, 'Nenhum item válido informado para criar o orçamento.');
    }
    const hasAnyManualRate = items.some(item => item.manual_rate === true);

    // 1. Busca preços
    for (const item of items) {
      const isManualRate = item.manual_rate === true;
      if (!isManualRate) {
        item.rate = await localGetRate(item.item_code, item.qty);
      }
      if (urgente && !isManualRate) {
        item.rate = getUrgentRate(item.rate);
      }
    }

    items = items.map(({ manual_rate, ...item }) => ({ ...item, _rateManual: true }));

    let entityId;
    let entityType = 'Customer';
    let contactId = null;
    let customerIsNew = false;

    if (email) {
      const contData = await erpGetList('Contact', { filters: [['email_id', '=', email]] });
      if (contData.length > 0) {
        contactId = contData[0].name;
        const fullContact = await erpGetDoc('Contact', contactId);
        const customerLink = fullContact?.links?.find(l => l.link_doctype === 'Customer');
        if (customerLink) {
          entityId = customerLink.link_name;
          entityType = 'Customer';
        }
      }
    }

    if (!entityId && email) {
      const leadData = await erpGetList('Lead', { filters: [['email_id', '=', email]] });
      if (leadData.length > 0) {
        entityId = leadData[0].name;
        entityType = 'Lead';
      }
    }

    if (!entityId) {
      customerIsNew = true;
      entityType = 'Lead';
      const l = await erpPost('Lead', {
        first_name: nomeCliente,
        email_id: email,
        mobile_no: telefone,
        status: 'Lead',
        type: 'Client',
      });
      entityId = l.name;
    } else if (entityType === 'Customer') {
      const custData = await erpGetList('Customer', { filters: [['name', '=', entityId]] });
      if (custData.length > 0 && custData[0].customer_name !== nomeCliente) {
        await erpPut('Customer', entityId, { customer_name: nomeCliente });
      }
    } else if (entityType === 'Lead') {
      const leadData = await erpGetList('Lead', { filters: [['name', '=', entityId]] });
      if (leadData.length > 0 && leadData[0].first_name !== nomeCliente) {
        await erpPut('Lead', entityId, { first_name: nomeCliente });
      }
    }

    if (contactId) {
      const upd = {};
      if (email) upd.email_ids = [{ email_id: email, is_primary: 1 }];
      if (telefone) upd.phone_nos = [{ phone: telefone, is_primary_mobile_no: 1 }];
      if (Object.keys(upd).length) await erpPut('Contact', contactId, upd);
    } else {
      const cp = {
        first_name: nomeCliente,
        links: [{ link_doctype: entityType, link_name: entityId }],
      };
      if (email) cp.email_ids = [{ email_id: email, is_primary: 1 }];
      if (telefone) cp.phone_nos = [{ phone: telefone, is_primary_mobile_no: 1 }];
      const con = await erpPost('Contact', cp);
      contactId = con.name || null;
    }

    // 4. CRM Deal
    let dealId = null;
    if (email) {
      const dealData = await erpGetList('CRM Deal', { filters: [['email', '=', email]] });
      if (dealData.length > 0) dealId = dealData[0].name;
    }
    if (!dealId) {
      for (const nomeBusca of [extracted.nome.trim(), nomeCliente]) {
        const dd = await erpGetList('CRM Deal', { filters: [['lead_name', '=', nomeBusca]] });
        if (dd.length > 0) { dealId = dd[0].name; break; }
      }
    }

    // 5. Quotation
    const hoje = new Date().toISOString().slice(0, 10);
    const validade = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

    const prazo = extracted.prazo_producao?.trim() || '';
    const observacoes = extracted.observacoes?.trim() || '';
    const remarksParts = [`Contato: ${nomeCliente} | ${email} | ${telefone}`];
    if (urgente) remarksParts.push('URGENTE');
    if (observacoes) remarksParts.push(`Obs: ${observacoes}`);
    const quotePayload = {
      quotation_to: entityType,
      party_name: entityId,
      customer_name: nomeCliente,
      transaction_date: hoje,
      valid_till: validade,
      selling_price_list: 'Standard Selling',
      currency: 'BRL',
      exchange_rate: 1,
      items,
      remarks: remarksParts.join(' | '),
    };
    quotePayload.ignore_pricing_rule = 1;
    if (prazo) quotePayload.custom_prazo_producao = prazo;
    if (email) quotePayload.contact_email = email;
    if (telefone) quotePayload.contact_mobile = telefone;

    const q = await erpPost('Quotation', quotePayload);
    const quotationId = q.name;
    const savedQuotation = await erpGetDoc('Quotation', quotationId);
    const savedItems = savedQuotation?.items || items;

    // 6. CRM Deal update/create
    const rawNextStep = savedItems.map(i => `${i.qty}x ${i.item_code}`).join(', ');
    const MAX_NEXT_STEP = 140;
    const nextStep = rawNextStep.length > MAX_NEXT_STEP
      ? rawNextStep.substring(0, MAX_NEXT_STEP - 3) + '...'
      : rawNextStep;
    if (dealId) {
      const upd = {
        status: 'Orcamento Enviado',
        custom_quotation: quotationId,
        custom_quotation_sent_date: hoje,
        custom_follow_up_stage: 0,
        next_step: nextStep,
      };
      if (email) upd.email = email;
      if (telefone) upd.mobile_no = telefone;
      if (contactId) upd.contacts = [{ contact: contactId, is_primary: 1 }];
      await erpPut('CRM Deal', dealId, upd);
    } else {
      const dp = {
        lead_name: nomeCliente,
        source: 'Brindice',
        status: 'Orcamento Enviado',
        currency: 'BRL',
        exchange_rate: 1,
        custom_quotation: quotationId,
        custom_quotation_sent_date: hoje,
        custom_follow_up_stage: 0,
        next_step: nextStep,
        products: savedItems.map(i => ({ product_name: i.item_code, qty: i.qty, rate: i.rate })),
      };
      if (email) dp.email = email;
      if (contactId) dp.contacts = [{ contact: contactId, is_primary: 1 }];
      const d = await erpPost('CRM Deal', dp);
      dealId = d.name;
    }

    const pdfUrl = `${ERPNEXT_BASE}/printview?doctype=Quotation&name=${encodeURIComponent(quotationId)}&format=${encodeURIComponent(DEFAULT_PRINT_FORMAT)}&no_letterhead=0`;

    let printHtml = null;
    try {
      const htmlRes = await fetch(pdfUrl, { headers: { 'Authorization': `token ${ERPNEXT_TOKEN}` } });
      if (htmlRes.ok) {
        printHtml = (await htmlRes.text()).replace('</head>', `<style>
body > div:first-child:not(.print-format-gutter) { display: none !important; }
@media print { @page { margin: 0; } body { margin: 0; } }
</style></head>`);
        if (entityType === 'Lead' && printHtml && entityId) {
          const escapedId = entityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const leadNameRegex = new RegExp(`(Nome(?:<[^>]+>)*\\s*:(?:\\s|&nbsp;|<[^>]+>)*)${escapedId}`, 'g');
          printHtml = printHtml.replace(leadNameRegex, `$1${nomeCliente}`);
        }
      }
    } catch (htmlErr) {
      console.error('Printview fetch failed:', htmlErr.message);
    }

    const host = event.headers?.host || 'project-xr5jg.vercel.app';
    const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);
    const protocol = isLocalHost
      ? 'http'
      : (event.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();

    const baseUrl = `${protocol}://${host}`;
    const fullUrl = buildViewUrl(baseUrl, quotationId);

    // ── URL shortening via TinyURL (free, no API key) ──
    let shortUrl = fullUrl;
    try {
      const tinyRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(fullUrl)}`);
      if (tinyRes.ok) {
        const tiny = (await tinyRes.text()).trim();
        if (tiny.startsWith('https://') && tiny.length < fullUrl.length) {
          shortUrl = tiny;
        }
      }
    } catch {
      // Keep full URL as fallback — non-fatal
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        quotation_id: quotationId,
        deal_id: dealId,
        customer_id: entityId,
        customer_new: customerIsNew,
        cliente: nomeCliente,
        urgente,
        items: savedItems.map(i => ({ sku: i.item_code, qty: i.qty, rate: i.rate })),
        pdf_url: pdfUrl,
        print_html: printHtml,
        view_url: fullUrl,
        short_url: shortUrl,
      }),
    };
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[orcamento]', err?.logMessage || err?.message || err);
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.statusCode ? err.message : 'Erro interno.' }),
    };
  }
}
