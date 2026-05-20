import { erpGetDoc, erpGetList, erpPut, erpPost, createHttpError, ERPNEXT_BASE } from './lib/erpnext.js';
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
  // Parse address_line1: "Rua X, 123" → endereco="Rua X", numero="123"
  const line1 = addr.address_line1 || '';
  const lastComma = line1.lastIndexOf(',');
  const endereco = lastComma > 0 ? line1.substring(0, lastComma).trim() : line1.trim();
  const numero = lastComma > 0 ? line1.substring(lastComma + 1).trim() : null;

  // Parse address_line2: "Centro - Sala 2" → bairro="Centro", complemento="Sala 2"
  const line2 = addr.address_line2 || '';
  const dash = line2.indexOf(' - ');
  const bairro = dash > 0 ? line2.substring(0, dash).trim() : (line2.trim() || null);
  const complemento = dash > 0 ? line2.substring(dash + 3).trim() : null;

  const parts = [line1, line2].filter(Boolean);
  if (addr.city) parts.push(addr.city + (addr.state ? `/${addr.state}` : ''));
  const summary = parts.join(', ');

  return {
    summary: summary || null,
    complete: !!addr.address_line1 && !!addr.city,
    endereco: endereco || null,
    numero: numero || null,
    bairro: bairro || null,
    complemento: complemento || null,
    municipio: addr.city || null,
    uf: addr.state || null,
    cep: addr.pincode || null,
  };
}

function computeQualityFlags(doc, doctype, address) {
  const flags = [];
  const phone = doc.mobile_no || doc.phone;
  const email = doc.email_id || doc.email;
  if (!phone) flags.push('sem_telefone');
  if (!email) flags.push('sem_email');
  if (doctype === 'Lead' && !doc.utm_source && !doc.source) flags.push('sem_origem');
  if (doctype === 'Customer' && !doc.tax_id) flags.push('sem_cnpj');
  if (!address || !address.complete) flags.push('endereco_incompleto');
  return flags;
}

// ── GET: detalhe de Lead/Customer ──

async function handleGet(doctype, name) {
  // 1. Fetch documento principal
  const fields = doctype === 'Lead'
    ? ['name', 'lead_name', 'first_name', 'email_id', 'mobile_no', 'phone', 'utm_source', 'source', 'creation', 'modified']
    : ['name', 'customer_name', 'tax_id', 'customer_type', 'creation', 'modified'];

  const doc = await erpGetDoc(doctype, name, { fields });
  if (!doc) throw createHttpError(404, `${doctype} "${name}" não encontrado.`);

  const email = doctype === 'Lead' ? (doc.email_id || null) : null;
  const telefone = doc.mobile_no || doc.phone || null;
  const origem = doctype === 'Lead' ? (doc.utm_source || doc.source || null) : null;
  const taxId = normalizeCnpj(doc.tax_id) || null;
  // person_type: Customer usa customer_type (Company→pj, Individual→pf), Lead sem padrão
  const personType = doctype === 'Customer'
    ? (doc.customer_type === 'Company' ? 'pj' : doc.customer_type === 'Individual' ? 'pf' : null)
    : null;
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
    person_type: personType,
    tax_id: taxId,
    creation: doc.creation,
    modified: doc.modified,
    erp_url: buildErpUrl(doctype, name),
    address,
    latest_quotation: latestQuotation,
    deal,
    quality_flags: computeQualityFlags({ ...doc, email, mobile_no: telefone }, doctype, address),
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

  // 4.2 Tipo de pessoa + tax_id (CPF/CNPJ)
  if (payload.person_type === 'pf' || payload.person_type === 'pj') {
    const rawTaxId = (payload.tax_id || '').replace(/\D/g, '');
    // Validar CPF/CNPJ
    if (rawTaxId) {
      if (payload.person_type === 'pf' && rawTaxId.length !== 11) {
        throw createHttpError(400, 'CPF deve ter 11 dígitos.');
      }
      if (payload.person_type === 'pj' && rawTaxId.length !== 14) {
        throw createHttpError(400, 'CNPJ deve ter 14 dígitos.');
      }
      // Não sobrescrever divergente
      const current = await erpGetDoc(doctype, name, { fields: ['tax_id'] });
      const existingTaxId = normalizeCnpj(current?.tax_id || '');
      if (existingTaxId && rawTaxId && existingTaxId !== rawTaxId) {
        throw createHttpError(409, 'CPF/CNPJ diverge do cadastro atual. Edite diretamente no ERPNext.');
      }
      if (!existingTaxId) {
        updates.tax_id = rawTaxId;
      }
    }
    // Customer: atualizar customer_type baseado no person_type
    if (doctype === 'Customer') {
      updates.customer_type = payload.person_type === 'pj' ? 'Company' : 'Individual';
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

  // 4.4 Endereço: criar ou atualizar Address vinculado
  if (payload.endereco && typeof payload.endereco === 'object') {
    const addr = payload.endereco;
    const endereco = addr.endereco?.trim() || '';
    const numero = addr.numero?.trim() || '';
    const bairro = addr.bairro?.trim() || '';
    const complemento = addr.complemento?.trim() || '';
    const city = addr.municipio?.trim() || addr.cidade?.trim() || null;
    const state = addr.uf?.trim()?.toUpperCase() || null;
    const pincode = addr.cep?.replace(/\D/g, '')?.slice(0, 8) || null;

    // Compõe address_line1: "Endereço, Número"
    const line1Parts = [endereco];
    if (numero) line1Parts.push(numero);
    const addressLine1 = line1Parts.filter(Boolean).join(', ') || null;

    // Compõe address_line2: "Bairro - Complemento"
    const line2Parts = [bairro];
    if (complemento) line2Parts.push(complemento);
    const addressLine2 = line2Parts.filter(Boolean).join(' - ') || null;

    // Só cria/atualiza se tiver pelo menos endereço ou município
    if (endereco || city) {
      const addressPayload = {
        address_title: name,
        address_type: 'Billing',
        address_line1: addressLine1,
        city: city || '',
        country: 'Brazil',
        links: [{ link_doctype: doctype, link_name: name }],
      };
      if (addressLine2) addressPayload.address_line2 = addressLine2;
      if (state) addressPayload.state = state;
      if (pincode) addressPayload.pincode = pincode;

      // Verifica se já existe Address vinculado
      const existingAddrs = await erpGetList('Address', {
        filters: [['link_doctype', '=', doctype], ['link_name', '=', name]],
        fields: ['name'],
        limit: 1,
      });

      if (existingAddrs.length > 0) {
        await erpPut('Address', existingAddrs[0].name, addressPayload);
      } else {
        await erpPost('Address', addressPayload);
      }
    }
  }

  const hasAddress = payload.endereco && typeof payload.endereco === 'object';

  if (Object.keys(updates).length === 0 && !hasAddress) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Nenhum campo para atualizar.' }),
    };
  }

  // Executar update do documento principal (se houver campos)
  if (Object.keys(updates).length > 0) {
    await erpPut(doctype, name, updates);
  }

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
