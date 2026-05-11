// POST /api/send-whatsapp — sends quotation messages via Evolution API.
// Keeps commercial context in the app and uses Evolution API only as the WhatsApp transport.

import { erpGetList, erpGetDoc, erpPut, createHttpError } from './lib/erpnext.js';

const EVOLUTION_BASE_URL = (process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || '';
const DEFAULT_TEMPLATE = '(Saudacao), (primeiro_nome)! Tudo bem?\n\nSegue o orçamento (numero_pedido):\n(link_orcamento)\n\nQualquer dúvida estamos à disposição.\nAspen Estamparia';

// ── Basic helpers ───────────────────────────────────────────────────────────

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  digits = digits.replace(/^55(\d{10,11})$/, '$1').replace(/^0(\d{10,11})$/, '$1');
  if (!/^\d{10,11}$/.test(digits)) return '';
  return `55${digits}`;
}

function firstNonEmpty(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function publicBaseUrl(event) {
  const host = event.headers?.host || 'aspen-orcamento.netlify.app';
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);
  const protocol = isLocalHost
    ? 'http'
    : (event.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${protocol}://${host}`;
}

function renderTemplate(template, { nome, quotationId, link }) {
  const h = new Date().getHours();
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const primeiroNome = (nome || '').trim().split(/\s+/)[0] || nome || '';
  return (template || DEFAULT_TEMPLATE)
    .replace(/\(Saudacao\)/g, saudacao)
    .replace(/\(nome\)/g, nome || '')
    .replace(/\(primeiro_nome\)/g, primeiroNome)
    .replace(/\(numero_pedido\)/g, quotationId || '')
    .replace(/\(empresa\)/g, 'Aspen Estamparia')
    .replace(/\(link_orcamento\)/g, link || '');
}

function parseContactFromRemarks(remarks = '') {
  const match = String(remarks).match(/Contato:\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)/i);
  if (!match) return {};
  return {
    nome: match[1]?.trim() || '',
    email: match[2]?.trim() || '',
    telefone: match[3]?.trim() || '',
  };
}

// ── Quotation context resolution ────────────────────────────────────────────

async function resolveContactFromQuotation(quotationId) {
  if (!quotationId) return {};

  const quotation = await erpGetDoc('Quotation', quotationId).catch(err => {
    throw createHttpError(
      err?.statusCode === 404 ? 404 : 502,
      'Orçamento não encontrado.',
      `[send-whatsapp] erpGetDoc(Quotation, ${quotationId}) failed: ${err?.logMessage || err?.message || err}`
    );
  });

  if (!quotation) {
    throw createHttpError(404, 'Orçamento não encontrado.', `[send-whatsapp] null quotation ${quotationId}`);
  }

  const remarksContact = parseContactFromRemarks(quotation.remarks);
  let nome = firstNonEmpty(quotation.customer_name, remarksContact.nome, quotation.party_name);
  let email = firstNonEmpty(quotation.contact_email, remarksContact.email);
  let telefone = firstNonEmpty(quotation.contact_mobile, quotation.contact_phone, remarksContact.telefone);

  // Party fallback: Lead/Customer data.
  if ((!telefone || !email || !nome) && quotation.quotation_to && quotation.party_name) {
    try {
      const party = await erpGetDoc(quotation.quotation_to, quotation.party_name);
      telefone = firstNonEmpty(telefone, party?.mobile_no, party?.phone, party?.phone_no);
      email = firstNonEmpty(email, party?.email_id, party?.email);
      nome = firstNonEmpty(nome, party?.first_name, party?.lead_name, party?.customer_name, party?.name);
    } catch (err) {
      console.warn('[send-whatsapp] party lookup failed:', err?.logMessage || err?.message || err);
    }
  }

  // Contact fallback by contact_person or email.
  if ((!telefone || !email) && quotation.contact_person) {
    try {
      const contact = await erpGetDoc('Contact', quotation.contact_person);
      telefone = firstNonEmpty(
        telefone,
        contact?.mobile_no,
        contact?.phone,
        contact?.phone_nos?.find(p => p.is_primary_mobile_no)?.phone,
        contact?.phone_nos?.[0]?.phone
      );
      email = firstNonEmpty(
        email,
        contact?.email_id,
        contact?.email_ids?.find(e => e.is_primary)?.email_id,
        contact?.email_ids?.[0]?.email_id
      );
    } catch (err) {
      console.warn('[send-whatsapp] contact_person lookup failed:', err?.logMessage || err?.message || err);
    }
  }

  // CRM Deal fallback — orcamento.js stores mobile_no and custom_quotation there.
  let dealId = null;
  try {
    const deals = await erpGetList('CRM Deal', {
      filters: [['custom_quotation', '=', quotationId]],
      fields: ['name', 'lead_name', 'email', 'mobile_no'],
      limit: 1,
    });
    if (deals.length > 0) {
      const deal = deals[0];
      dealId = deal.name;
      telefone = firstNonEmpty(telefone, deal.mobile_no);
      email = firstNonEmpty(email, deal.email);
      nome = firstNonEmpty(nome, deal.lead_name);
    }
  } catch (err) {
    console.warn('[send-whatsapp] deal lookup failed:', err?.logMessage || err?.message || err);
  }

  return {
    quotation,
    dealId,
    nome,
    email,
    telefone,
  };
}

// ── Evolution API ───────────────────────────────────────────────────────────

function assertEvolutionConfig() {
  const missing = [];
  if (!EVOLUTION_BASE_URL) missing.push('EVOLUTION_BASE_URL');
  if (!EVOLUTION_API_KEY) missing.push('EVOLUTION_API_KEY');
  if (!EVOLUTION_INSTANCE) missing.push('EVOLUTION_INSTANCE');
  if (missing.length > 0) {
    throw createHttpError(
      500,
      'Integração do WhatsApp não configurada. Verifique as variáveis da Evolution API.',
      `[send-whatsapp] missing env: ${missing.join(', ')}`
    );
  }
}

async function sendText(number, text) {
  const url = `${EVOLUTION_BASE_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`;
  let res;
  let body;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify({ number, text }),
    });
    body = await res.json().catch(() => null);
  } catch (err) {
    throw createHttpError(
      502,
      'Falha ao conectar com o WhatsApp. Tente novamente.',
      `[send-whatsapp] Evolution fetch failed: ${err.message}`
    );
  }

  if (!res.ok) {
    const detail = body?.message || body?.error || body?.response?.message || JSON.stringify(body || {});
    throw createHttpError(
      res.status === 401 || res.status === 403 ? 502 : 400,
      'Não foi possível enviar a mensagem pelo WhatsApp. Verifique se a instância está conectada.',
      `[send-whatsapp] Evolution ${res.status}: ${detail}`
    );
  }

  return body;
}

async function markDealAsSent(dealId, quotationId) {
  if (!dealId) return;
  try {
    await erpPut('CRM Deal', dealId, {
      status: 'Orcamento Enviado',
      custom_quotation: quotationId,
      custom_quotation_sent_date: new Date().toISOString().slice(0, 10),
      custom_follow_up_stage: 0,
    });
  } catch (err) {
    console.warn('[send-whatsapp] deal update failed:', err?.logMessage || err?.message || err);
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'JSON inválido' });
  }

  try {
    assertEvolutionConfig();

    const quotationId = String(payload.quotation_id || payload.quotationId || '').trim();
    const resolved = quotationId ? await resolveContactFromQuotation(quotationId) : {};

    const nome = firstNonEmpty(payload.nome, resolved.nome);
    const rawPhone = firstNonEmpty(payload.telefone, payload.phone, resolved.telefone);
    const number = normalizePhone(rawPhone);
    if (!number) {
      throw createHttpError(400, 'Telefone inválido ou ausente para envio via WhatsApp.');
    }

    const link = firstNonEmpty(
      payload.link_orcamento,
      payload.short_url,
      quotationId ? `${publicBaseUrl(event)}/api/view?q=${encodeURIComponent(quotationId)}` : ''
    );
    const text = firstNonEmpty(payload.mensagem, payload.message) || renderTemplate(payload.template, { nome, quotationId, link });

    if (!text.trim()) {
      throw createHttpError(400, 'Mensagem vazia.');
    }

    const evolution = await sendText(number, text);
    await markDealAsSent(payload.deal_id || resolved.dealId, quotationId);

    return jsonResponse(200, {
      success: true,
      quotation_id: quotationId || null,
      deal_id: payload.deal_id || resolved.dealId || null,
      number,
      message: text,
      evolution,
    });
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[send-whatsapp]', err?.logMessage || err?.message || err);
    return jsonResponse(code, { error: err?.message || 'Erro interno.' });
  }
}
