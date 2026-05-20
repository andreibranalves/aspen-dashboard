import { erpGetDoc, erpGetList, erpPut, createHttpError, ERPNEXT_BASE } from './lib/erpnext.js';
import { LEAD_SOURCES, normalizeLeadSource, normalizeCnpj, isValidCnpj } from './lib/client-metadata.js';

// ── Constants ──

const ALLOWED_DOCTYPES = ['Lead', 'Customer'];

/**
 * Campos permitidos para edição por doctype.
 * Qualquer campo fora desta lista é rejeitado com 400.
 */
const EDITABLE_FIELDS = {
  Lead: ['lead_name', 'email_id', 'mobile_no', 'utm_source'],
  Customer: ['customer_name'],
  // tax_id e endereço tratados separadamente com regras de segurança
};

// ── Helpers ──

function buildErpUrl(doctype, name) {
  const route = doctype.toLowerCase().replace(/\s+/g, '-');
  return `${ERPNEXT_BASE}/app/${route}/${encodeURIComponent(name)}`;
}

function buildSummaryAddress(addr) {
  if (!addr) return null;
  const parts = [
    addr.address_line1,
    addr.address_line2,
  ].filter(Boolean);
  if (addr.city) parts.push(addr.city + (addr.state ? `/${addr.state}` : ''));
  const summary = parts.join(', ');
  return {
    summary: summary || null,
    complete: !!addr.address_line1 && !!addr.city,
    raw: addr,
  };
}

function computeQualityFlags(doc, doctype) {
  const flags = [];
  const phone = doc.mobile_no || doc.phone;
  const email = doc.email_id || doc.email;
  if (!phone) flags.push('sem_telefone');
  if (!email) flags.push('sem_email');
  if (doctype === 'Lead' && !doc.utm_source && !doc.source) flags.push('sem_origem');
  if (doctype === 'Customer' && !doc.tax_id) flags.push('sem_cnpj');
  return flags;
}

// ── GET: detalhe de Lead/Customer ──

async function handleGet(doctype, name) {
  // 1. Fetch documento principal
  const fields = doctype === 'Lead'
    ? ['name', 'lead_name', 'first_name', 'email_id', 'mobile_no', 'phone', 'utm_source', 'source', 'creation', 'modified']
    : ['name', 'customer_name', 'tax_id', 'creation', 'modified'];

  const doc = await erpGetDoc(doctype, name, { fields });
  if (!doc) throw createHttpError(404, `${doctype} "${name}" não encontrado.`);

  const email = doctype === 'Lead' ? (doc.email_id || null) : null;
  const telefone = doc.mobile_no || doc.phone || null;
  const origem = doctype === 'Lead' ? (doc.utm_source || doc.source || null) : null;
  const cnpj = doctype === 'Customer' ? normalizeCnpj(doc.tax_id) : null;
  const nome = doctype === 'Lead' ? doc.lead_name : doc.customer_name;

  // 2. Buscar Address vinculado
  let address = null;
  try {
    const addrs = await erpGetList('Address', {
      filters: [['link_doctype', '=', doctype], ['link_name', '=', name]],
      fields: ['name', 'address_line1', 'address_line2', 'city', 'state', 'pincode', 'email_id', 'phone'],
      order_by: 'creation desc',
      limit: 1,
    });
    if (addrs.length > 0) {
      address = buildSummaryAddress(addrs[0]);
    }
  } catch { /* best-effort */ }

  // 3. Buscar último orçamento (Quotation) por party_name
  let latestQuotation = null;
  try {
    const quotes = await erpGetList('Quotation', {
      filters: [['party_name', '=', name]],
      fields: ['name', 'status', 'grand_total', 'transaction_date'],
      order_by: 'transaction_date desc',
      limit: 1,
    });
    if (quotes.length > 0) {
      latestQuotation = {
        name: quotes[0].name,
        status: quotes[0].status,
        grand_total: quotes[0].grand_total,
        date: quotes[0].transaction_date,
      };
    }
  } catch { /* best-effort */ }

  // 4. Buscar CRM Deal vinculado (por lead_name ou email)
  let deal = null;
  try {
    const deals = await erpGetList('CRM Deal', {
      filters: [['lead_name', '=', nome]],
      fields: ['name', 'status', 'custom_quotation', 'custom_follow_up_stage', 'next_step'],
      order_by: 'creation desc',
      limit: 1,
    });
    if (deals.length > 0) {
      deal = {
        name: deals[0].name,
        status: deals[0].status,
        follow_up_stage: deals[0].custom_follow_up_stage,
        next_step: deals[0].next_step || null,
        quotation: deals[0].custom_quotation || null,
      };
    }
  } catch { /* best-effort */ }

  return {
    success: true,
    doctype,
    name,
    display_name: nome,
    email,
    telefone,
    origem,
    cnpj: cnpj || null,
    creation: doc.creation,
    modified: doc.modified,
    erp_url: buildErpUrl(doctype, name),
    address,
    latest_quotation: latestQuotation,
    deal,
    quality_flags: computeQualityFlags({ ...doc, email, mobile_no: telefone }, doctype),
  };
}

// ── PUT: edição segura ──

async function handlePut(doctype, name, rawBody) {
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { throw createHttpError(400, 'JSON inválido.'); }

  if (!payload || typeof payload !== 'object') {
    throw createHttpError(400, 'Corpo da requisição é obrigatório.');
  }

  const updates = {};
  const allowed = EDITABLE_FIELDS[doctype] || [];

  // 4.1 Campos básicos da allowlist
  for (const field of allowed) {
    if (payload[field] !== undefined) {
      const val = String(payload[field]).trim();
      updates[field] = val || null;
    }
  }

  // 4.2 CNPJ (apenas Customer)
  if (doctype === 'Customer' && payload.cnpj !== undefined) {
    const rawCnpj = normalizeCnpj(payload.cnpj);
    if (rawCnpj && !isValidCnpj(rawCnpj)) {
      throw createHttpError(400, 'CNPJ inválido.');
    }
    // Buscar valor atual para não sobrescrever divergente
    const current = await erpGetDoc('Customer', name, { fields: ['tax_id'] });
    const existingCnpj = normalizeCnpj(current?.tax_id || '');
    if (existingCnpj && rawCnpj && existingCnpj !== rawCnpj) {
      throw createHttpError(409, 'CNPJ diverge do cadastro atual. Edite diretamente no ERPNext.');
    }
    if (rawCnpj && !existingCnpj) {
      updates.tax_id = rawCnpj;
    }
  }

  // 4.3 Origem (apenas Lead, via utm_source)
  if (doctype === 'Lead' && payload.origem !== undefined) {
    const origemVal = normalizeLeadSource(payload.origem);
    if (origemVal && !LEAD_SOURCES.includes(origemVal)) {
      throw createHttpError(400, `Origem "${origemVal}" não reconhecida. Valores aceitos: ${LEAD_SOURCES.join(', ')}.`);
    }
    updates.utm_source = origemVal || null;
  }

  if (Object.keys(updates).length === 0) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Nenhum campo para atualizar.' }),
    };
  }

  // Executar update
  await erpPut(doctype, name, updates);

  // Retornar detalhe atualizado
  const result = await handleGet(doctype, name);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...result, updated: true }),
  };
}

// ── Handler principal ──

export async function handler(event) {
  const params = event.queryStringParameters || {};
  const doctype = params.doctype;
  const name = params.name;

  // Validar parâmetros
  if (!doctype || !name) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Parâmetros doctype e name são obrigatórios.' }),
    };
  }

  if (!ALLOWED_DOCTYPES.includes(doctype)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Doctype inválido. Valores aceitos: ${ALLOWED_DOCTYPES.join(', ')}.` }),
    };
  }

  try {
    if (event.httpMethod === 'GET') {
      const data = await handleGet(doctype, name);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }

    if (event.httpMethod === 'PUT') {
      return await handlePut(doctype, name, event.body);
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[client-detail]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Erro interno.' }),
    };
  }
}
