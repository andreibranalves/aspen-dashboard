const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';
const ERPNEXT_TOKEN = process.env.ERPNEXT_TOKEN;

const ERPNEXT_HEADERS = {
  'Authorization': `token ${ERPNEXT_TOKEN}`,
  'Content-Type': 'application/json',
};

// ── ERPNext helpers ──────────────────────────────────────────────────────────

async function erpGet(doctype, filters) {
  const params = new URLSearchParams({ filters: JSON.stringify(filters) });
  const res = await fetch(
    `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}?${params}`,
    { headers: ERPNEXT_HEADERS }
  );
  const body = await res.json();
  return body.data || [];
}

async function erpPost(doctype, payload) {
  const res = await fetch(
    `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}`,
    { method: 'POST', headers: ERPNEXT_HEADERS, body: JSON.stringify(payload) }
  );
  const body = await res.json();
  return body.data || {};
}

async function erpPut(doctype, name, payload) {
  const res = await fetch(
    `${ERPNEXT_BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    { method: 'PUT', headers: ERPNEXT_HEADERS, body: JSON.stringify(payload) }
  );
  const body = await res.json();
  return body.data || {};
}

// ── Pricing ──────────────────────────────────────────────────────────────────

function getBracket(qty) {
  if (qty >= 1000) return 1000;
  if (qty >= 500) return 500;
  if (qty >= 300) return 300;
  if (qty >= 100) return 100;
  return 30;
}

async function getRate(itemCode, qty) {
  const bracket = getBracket(qty);

  // 1. Tiered rule (e.g. LNC-SED-70-30)
  let data = await erpGet('Pricing Rule', [['title', '=', `${itemCode}-${bracket}`]]);
  if (data.length > 0) {
    const full = await fetch(
      `${ERPNEXT_BASE}/api/resource/Pricing%20Rule/${encodeURIComponent(data[0].name)}`,
      { headers: ERPNEXT_HEADERS }
    ).then(r => r.json());
    const rate = full.data?.rate;
    if (rate) return rate;
  }

  // 2. SKU rule
  data = await erpGet('Pricing Rule', [['title', '=', itemCode]]);
  if (data.length > 0) {
    const full = await fetch(
      `${ERPNEXT_BASE}/api/resource/Pricing%20Rule/${encodeURIComponent(data[0].name)}`,
      { headers: ERPNEXT_HEADERS }
    ).then(r => r.json());
    const rate = full.data?.rate;
    if (rate) return rate;
  }

  // 3. Item Price fallback
  const params = new URLSearchParams({
    filters: JSON.stringify([['item_code', '=', itemCode], ['price_list', '=', 'Standard Selling']]),
    fields: JSON.stringify(['price_list_rate']),
  });
  const res = await fetch(
    `${ERPNEXT_BASE}/api/resource/Item%20Price?${params}`,
    { headers: ERPNEXT_HEADERS }
  );
  const body = await res.json();
  return body.data?.[0]?.price_list_rate || 0;
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
    let items = extracted.items;

    // 1. Busca preços
    for (const item of items) {
      if (!item.rate) {
        item.rate = await getRate(item.item_code, item.qty);
      }
      if (urgente) {
        item.rate = Math.round(item.rate * 1.30 * 100) / 100;
      }
    }

    let entityId;
    let entityType = 'Customer';
    let contactId = null;
    let customerIsNew = false;

    if (email) {
      const contData = await erpGet('Contact', [['email_id', '=', email]]);
      if (contData.length > 0) {
        contactId = contData[0].name;
        const fullContact = await fetch(
          `${ERPNEXT_BASE}/api/resource/Contact/${encodeURIComponent(contactId)}`,
          { headers: ERPNEXT_HEADERS }
        ).then(r => r.json());
        const customerLink = fullContact.data?.links?.find(l => l.link_doctype === 'Customer');
        if (customerLink) {
          entityId = customerLink.link_name;
          entityType = 'Customer';
        }
      }
    }

    if (!entityId && email) {
      const leadData = await erpGet('Lead', [['email_id', '=', email]]);
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
      const custData = await erpGet('Customer', [['name', '=', entityId]]);
      if (custData.length > 0 && custData[0].customer_name !== nomeCliente) {
        await erpPut('Customer', entityId, { customer_name: nomeCliente });
      }
    } else if (entityType === 'Lead') {
      const leadData = await erpGet('Lead', [['name', '=', entityId]]);
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
      const dealData = await erpGet('CRM Deal', [['email', '=', email]]);
      if (dealData.length > 0) dealId = dealData[0].name;
    }
    if (!dealId) {
      for (const nomeBusca of [extracted.nome.trim(), nomeCliente]) {
        const dd = await erpGet('CRM Deal', [['lead_name', '=', nomeBusca]]);
        if (dd.length > 0) { dealId = dd[0].name; break; }
      }
    }

    // 5. Quotation
    const hoje = new Date().toISOString().slice(0, 10);
    const validade = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

    const prazo = extracted.prazo_producao?.trim() || '';
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
      remarks: `Contato: ${nomeCliente} | ${email} | ${telefone}${urgente ? ' | URGENTE' : ''}`,
    };
    if (prazo) quotePayload.custom_prazo_producao = prazo;
    if (email) quotePayload.contact_email = email;
    if (telefone) quotePayload.contact_mobile = telefone;

    const q = await erpPost('Quotation', quotePayload);
    const quotationId = q.name;

    // 6. CRM Deal update/create
    const nextStep = items.map(i => `${i.qty}x ${i.item_code}`).join(', ');
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
        products: items.map(i => ({ product_name: i.item_code, qty: i.qty, rate: i.rate })),
      };
      if (email) dp.email = email;
      if (contactId) dp.contacts = [{ contact: contactId, is_primary: 1 }];
      const d = await erpPost('CRM Deal', dp);
      dealId = d.name;
    }

    const pdfUrl = `${ERPNEXT_BASE}/printview?doctype=Quotation&name=${encodeURIComponent(quotationId)}&format=Aspen%201.0&no_letterhead=0`;

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

    const host = event.headers?.host || 'aspen-orcamento.netlify.app';
    const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);
    const protocol = isLocalHost
      ? 'http'
      : (event.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();

    const shortUrl = `${protocol}://${host}/api/view?q=${encodeURIComponent(quotationId)}`;

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
        items: items.map(i => ({ sku: i.item_code, qty: i.qty, rate: i.rate })),
        pdf_url: pdfUrl,
        print_html: printHtml,
        short_url: shortUrl,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
}
