// GET /api/whatsapp-leads — recent WhatsApp conversations that have not become quotations.

import { erpGetList, createHttpError } from './lib/erpnext.js';

const EVOLUTION_BASE_URL = (process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim() || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash';

const MAX_CHATS_TO_SCAN = 15;
const MAX_MESSAGES_PER_CHAT = 12;
const MAX_LEADS = 5;

// ── Basic helpers ───────────────────────────────────────────────────────────

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function firstNonEmpty(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

export function normalizeWhatsappPhone(value) {
  const raw = String(value || '');
  const beforeAt = raw.split('@')[0];
  let digits = beforeAt.replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return digits;
}

function normalizeComparablePhone(value) {
  let digits = normalizeWhatsappPhone(value);
  if (digits.startsWith('55')) digits = digits.slice(2);
  return digits.replace(/^0+/, '');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getChatRemoteJid(chat) {
  return firstNonEmpty(
    chat?.remoteJid,
    chat?.id,
    chat?.jid,
    chat?.key?.remoteJid,
    chat?.conversationTimestamp?.remoteJid
  );
}

function getChatTimestamp(chat) {
  const candidates = [
    chat?.updatedAt,
    chat?.lastMessage?.messageTimestamp,
    chat?.messageTimestamp,
    chat?.conversationTimestamp,
    chat?.t,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function unwrapData(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.chats)) return payload.chats;
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.response)) return payload.response;
  if (Array.isArray(payload?.data?.messages)) return payload.data.messages;
  if (Array.isArray(payload?.data?.chats)) return payload.data.chats;
  return [];
}

function getMessageText(message) {
  const msg = message?.message || message;
  return cleanText(firstNonEmpty(
    msg?.conversation,
    msg?.extendedTextMessage?.text,
    msg?.imageMessage?.caption,
    msg?.videoMessage?.caption,
    msg?.documentMessage?.caption,
    message?.text,
    message?.body,
    message?.messageText,
    message?.content
  ));
}

function getMessageTimestamp(message) {
  const candidate = message?.messageTimestamp || message?.timestamp || message?.createdAt || message?.dateTime;
  const numeric = Number(candidate);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMessages(messages) {
  return (messages || [])
    .map(message => ({
      fromMe: Boolean(message?.key?.fromMe || message?.fromMe),
      text: getMessageText(message),
      timestamp: getMessageTimestamp(message),
    }))
    .filter(message => message.text)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function composeConversationText(messages) {
  return normalizeMessages(messages)
    .slice(-MAX_MESSAGES_PER_CHAT)
    .map(message => `${message.fromMe ? 'Aspen' : 'Cliente'}: ${message.text}`)
    .join('\n');
}

function extractFallback(conversationText) {
  const email = conversationText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const qtyMatch = conversationText.match(/(?:qtd|quantidade|pedido|quero|preciso)?\D*(\d{2,5})\s*(?:un|unid|unidades|peças|pecas|pçs|pcs)?/i);
  const productMatch = conversationText.match(/\b(canga|cangas|lenço|lenco|lenços|lencos|echarpe|echarpes|boné|bone|bonés|bones|chapéu|chapeu|toalha|toalhas|ecobag|ecobags|cachecol|bandana|gravata|viseira|bolsa|bolsas)\b/i);
  const nameMatch = conversationText.match(/(?:meu nome é|me chamo|sou a?|cliente:)\s*([^\n,.]+)/i);
  return {
    nome: cleanText(nameMatch?.[1] || ''),
    email,
    produto: cleanText(productMatch?.[1] || ''),
    quantidade: qtyMatch ? Number(qtyMatch[1]) : null,
  };
}

export function formatLeadText(lead) {
  const lines = [
    lead.nome ? `Nome: ${lead.nome}` : 'Nome:',
    lead.email ? `E-mail: ${lead.email}` : 'E-mail:',
    lead.telefone ? `Telefone: ${lead.telefone}` : 'Telefone:',
  ];
  const pedidoParts = [];
  if (lead.produto) pedidoParts.push(lead.produto);
  if (lead.quantidade) pedidoParts.push(`${lead.quantidade} un`);
  lines.push(pedidoParts.length ? `Pedido: ${pedidoParts.join(' — ')}` : 'Pedido:');
  return lines.join('\n');
}

// ── External APIs ────────────────────────────────────────────────────────────

function assertEvolutionConfig() {
  const missing = [];
  if (!EVOLUTION_BASE_URL) missing.push('EVOLUTION_BASE_URL');
  if (!EVOLUTION_API_KEY) missing.push('EVOLUTION_API_KEY');
  if (!EVOLUTION_INSTANCE) missing.push('EVOLUTION_INSTANCE');
  if (missing.length) {
    throw createHttpError(500, 'Integração WhatsApp indisponível.', `[whatsapp-leads] missing env: ${missing.join(', ')}`);
  }
}

async function evolutionFetch(path, body = {}) {
  assertEvolutionConfig();
  const res = await fetch(`${EVOLUTION_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      apikey: EVOLUTION_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw createHttpError(502, 'Falha ao consultar WhatsApp.', `[whatsapp-leads] Evolution ${res.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

async function findChats() {
  const payload = await evolutionFetch(`/chat/findChats/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {});
  return unwrapData(payload)
    .filter(chat => {
      const jid = getChatRemoteJid(chat);
      return jid && !jid.includes('@g.us') && !jid.includes('status@broadcast');
    })
    .sort((a, b) => getChatTimestamp(b) - getChatTimestamp(a))
    .slice(0, MAX_CHATS_TO_SCAN);
}

async function findMessages(remoteJid) {
  const payload = await evolutionFetch(`/chat/findMessages/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
    where: { key: { remoteJid } },
    limit: MAX_MESSAGES_PER_CHAT,
  });
  return unwrapData(payload).slice(-MAX_MESSAGES_PER_CHAT);
}

async function extractLeadWithOpenRouter(conversationText) {
  const fallback = extractFallback(conversationText);
  if (!OPENROUTER_API_KEY || !conversationText.trim()) return fallback;

  const prompt = `Extraia dados comerciais da conversa de WhatsApp da Aspen Estamparia.\n\nRetorne APENAS JSON válido no formato:\n{"nome":"","email":"","produto":"","quantidade":null}\n\nRegras:\n- Nunca invente dados ausentes.\n- produto deve ser o produto citado pelo cliente, sem SKU se o cliente não informou SKU.\n- quantidade deve ser número inteiro quando houver quantidade clara.\n- Se não houver um campo, use string vazia ou null para quantidade.\n\nConversa:\n${conversationText.slice(-6000)}`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-OpenRouter-Title': 'Aspen Orcamento WhatsApp Leads',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    });
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    return {
      nome: cleanText(parsed.nome || fallback.nome),
      email: cleanText(parsed.email || fallback.email),
      produto: cleanText(parsed.produto || fallback.produto),
      quantidade: Number.isFinite(Number(parsed.quantidade)) ? Number(parsed.quantidade) : fallback.quantidade,
    };
  } catch (err) {
    console.warn('[whatsapp-leads] OpenRouter extraction fallback:', err?.message || err);
    return fallback;
  }
}

async function getConvertedContactKeys() {
  const rows = await erpGetList('Quotation', {
    fields: ['name', 'customer_name', 'contact_email', 'contact_mobile'],
    filters: [['docstatus', '!=', 2]],
    order_by: 'creation desc',
    limit_page_length: 200,
  });
  const phones = new Set();
  const emails = new Set();
  const names = new Set();
  for (const row of rows || []) {
    const phone = normalizeComparablePhone(row.contact_mobile);
    if (phone) phones.add(phone);
    const email = String(row.contact_email || '').trim().toLowerCase();
    if (email) emails.add(email);
    const name = String(row.customer_name || '').trim().toLowerCase();
    if (name) names.add(name);
  }
  return { phones, emails, names };
}

function hasConvertedQuotation(lead, converted) {
  const phone = normalizeComparablePhone(lead.telefone);
  if (phone && converted.phones.has(phone)) return true;
  const email = String(lead.email || '').trim().toLowerCase();
  if (email && converted.emails.has(email)) return true;
  const name = String(lead.nome || '').trim().toLowerCase();
  return Boolean(name && converted.names.has(name));
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    const [chats, converted] = await Promise.all([findChats(), getConvertedContactKeys()]);
    const leads = [];

    for (const chat of chats) {
      if (leads.length >= MAX_LEADS) break;
      const remoteJid = getChatRemoteJid(chat);
      const telefone = normalizeWhatsappPhone(remoteJid);
      if (!telefone) continue;

      const messages = await findMessages(remoteJid);
      const conversationText = composeConversationText(messages);
      if (!conversationText) continue;

      const extracted = await extractLeadWithOpenRouter(conversationText);
      const nome = firstNonEmpty(extracted.nome, chat?.pushName, chat?.name, chat?.notify, telefone);
      const lead = {
        id: remoteJid,
        remoteJid,
        nome,
        telefone,
        email: extracted.email || '',
        produto: extracted.produto || '',
        quantidade: extracted.quantidade || null,
        resumo: conversationText.split('\n').slice(-2).join(' · '),
        texto: formatLeadText({ ...extracted, nome, telefone }),
        timestamp: getChatTimestamp(chat) || Math.max(...normalizeMessages(messages).map(m => m.timestamp), 0),
      };

      if (!hasConvertedQuotation(lead, converted)) leads.push(lead);
    }

    return jsonResponse(200, { success: true, data: leads });
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[whatsapp-leads]', err?.logMessage || err?.message || err);
    return jsonResponse(code, { error: err?.statusCode ? err.message : 'Erro interno ao buscar conversas do WhatsApp.' });
  }
}
