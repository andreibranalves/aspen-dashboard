// GET /api/whatsapp-leads — five most recent WhatsApp conversations with contact readiness status.

import { erpGetList, createHttpError } from './lib/erpnext.js';

const EVOLUTION_BASE_URL = (process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim() || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash';

const MAX_CHATS_TO_SCAN = 5;
const MAX_MESSAGES_PER_CHAT = 50;
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

function isValidBrazilWhatsappPhone(value) {
  const comparable = normalizeComparablePhone(value);
  return comparable.length === 10 || comparable.length === 11;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeLeadEmail(value) {
  return String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.trim().toLowerCase() || '';
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
  if (Array.isArray(payload?.messages?.records)) return payload.messages.records;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.response)) return payload.response;
  if (Array.isArray(payload?.data?.messages)) return payload.data.messages;
  if (Array.isArray(payload?.data?.messages?.records)) return payload.data.messages.records;
  if (Array.isArray(payload?.data?.chats)) return payload.data.chats;
  if (Array.isArray(payload?.data?.chats?.records)) return payload.data.chats.records;
  return [];
}

function getMessageRemoteJidAlt(message) {
  return firstNonEmpty(
    message?.key?.remoteJidAlt,
    message?.remoteJidAlt,
    message?.message?.key?.remoteJidAlt,
    message?.lastMessage?.key?.remoteJidAlt,
    message?.lastMessage?.remoteJidAlt,
    message?.lastMessage?.message?.key?.remoteJidAlt
  );
}

function getInboundPushName(messages) {
  return (messages || [])
    .slice()
    .reverse()
    .map(message => cleanText(message?.pushName))
    .find(name => name && name !== 'Você' && !/^\d+$/.test(name)) || '';
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
  const email = normalizeLeadEmail(conversationText);
  const nameMatch = conversationText.match(/(?:meu nome é|me chamo|sou a?|cliente:)\s*([^\n,.]+)/i);
  // Try to find a Brazilian phone number pattern in the text: (XX) XXXXX-XXXX or XX XXXXX-XXXX etc
  const phoneMatch = conversationText.match(/(?:telefone|whatsapp|celular|contato|tel)[^\d]*(\d[\d\s().-]{8,})/i)
    || conversationText.match(/\(?(\d{2})\)?\s*\d[\d\s.-]{7,}/);
  const telefone = cleanText(phoneMatch?.[1] || '').replace(/\D/g, '');
  return {
    nome: cleanText(nameMatch?.[1] || ''),
    email,
    telefone,
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

  const prompt = `Extraia apenas os dados de contato da pessoa nesta conversa de WhatsApp da Aspen Estamparia.\n\nRetorne APENAS JSON válido no formato:\n{"nome":"","email":"","telefone":""}\n\nRegras:\n- Nunca invente dados ausentes.\n- O objetivo é só identificar nome, e-mail e telefone. Não extraia pedido, produto ou quantidade.\n- Se a conversa tiver mais de um e-mail ou telefone, retorne apenas o primeiro citado.\n- Telefone deve ser apenas dígitos com DDD (ex: 11987654321).\n- Se não houver um campo, use string vazia.\n\nConversa:\n${conversationText.slice(-6000)}`;

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
      email: normalizeLeadEmail(parsed.email || fallback.email),
      telefone: cleanText(parsed.telefone || fallback.telefone || '').replace(/\D/g, ''),
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
  const phones = new Map();
  const emails = new Map();
  const names = new Map();
  for (const row of rows || []) {
    const quotationId = String(row.name || '').trim();
    const phone = normalizeComparablePhone(row.contact_mobile);
    if (phone && quotationId && !phones.has(phone)) phones.set(phone, quotationId);
    const email = String(row.contact_email || '').trim().toLowerCase();
    if (email && quotationId && !emails.has(email)) emails.set(email, quotationId);
    const name = String(row.customer_name || '').trim().toLowerCase();
    if (name && quotationId && !names.has(name)) names.set(name, quotationId);
  }
  return { phones, emails, names };
}

export function findConvertedQuotation(lead, converted) {
  const phone = normalizeComparablePhone(lead.telefone);
  if (phone && converted.phones.has(phone)) return converted.phones.get(phone);
  const email = String(lead.email || '').trim().toLowerCase();
  if (email && converted.emails.has(email)) return converted.emails.get(email);
  const name = String(lead.nome || '').trim().toLowerCase();
  if (name && converted.names.has(name)) return converted.names.get(name);
  return '';
}

export function resolveWhatsappDisplayName(extracted, chat, fallbackPhone) {
  return firstNonEmpty(chat?.pushName, chat?.name, chat?.notify, extracted?.nome, fallbackPhone);
}

export function prioritizeWhatsappLeads(leads, limit = MAX_LEADS) {
  const byNewest = (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0);
  return [...leads].sort(byNewest).slice(0, limit);
}

export function getWhatsappLeadQuality(lead) {
  const missingFields = [];
  if (!cleanText(lead?.nome)) missingFields.push('nome');
  if (!normalizeLeadEmail(lead?.email)) missingFields.push('email');
  if (!isValidBrazilWhatsappPhone(lead?.telefone)) missingFields.push('telefone');

  if (!missingFields.length) {
    return { isReady: true, missingFields, statusLabel: 'Pronto para gerar' };
  }

  const readable = missingFields.map(field => field === 'email' ? 'e-mail' : field);
  const joined = readable.length === 1
    ? readable[0]
    : `${readable.slice(0, -1).join(', ')} e ${readable.at(-1)}`;

  return { isReady: false, missingFields, statusLabel: `Sem ${joined}` };
}

export function shouldIncludeWhatsappLead(lead) {
  return getWhatsappLeadQuality(lead).isReady;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    const [chats, converted] = await Promise.all([findChats(), getConvertedContactKeys()]);
    const candidates = [];

    for (const chat of chats) {
      const remoteJid = getChatRemoteJid(chat);
      if (!remoteJid) continue;

      const messages = await findMessages(remoteJid);
      const conversationText = composeConversationText(messages);

      const displayJid = firstNonEmpty(
        getMessageRemoteJidAlt(chat),
        messages.map(getMessageRemoteJidAlt).find(Boolean),
        remoteJid
      );
      let telefone = normalizeWhatsappPhone(displayJid);

      const extracted = await extractLeadWithOpenRouter(conversationText);

      // Fallback: if JID-based phone is not a valid BR number, try extracted phone from conversation
      if (!isValidBrazilWhatsappPhone(telefone) && extracted.telefone) {
        const fallbackPhone = normalizeWhatsappPhone(extracted.telefone);
        if (isValidBrazilWhatsappPhone(fallbackPhone)) {
          telefone = fallbackPhone;
        }
      }
      if (!telefone) continue;
      const nome = firstNonEmpty(chat?.pushName, chat?.name, chat?.notify, getInboundPushName(messages), extracted?.nome, telefone);
      const timestamp = getChatTimestamp(chat) || Math.max(...normalizeMessages(messages).map(m => m.timestamp), 0);
      const lead = {
        id: remoteJid,
        remoteJid,
        nome,
        telefone,
        email: normalizeLeadEmail(extracted.email),
        resumo: conversationText.split('\n').slice(-2).join(' · '),
        timestamp,
      };
      lead.quotationId = findConvertedQuotation(lead, converted);
      lead.hasQuotation = Boolean(lead.quotationId);
      Object.assign(lead, getWhatsappLeadQuality(lead));
      lead.texto = formatLeadText(lead);
      candidates.push(lead);
    }

    return jsonResponse(200, { success: true, data: prioritizeWhatsappLeads(candidates) });
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[whatsapp-leads]', err?.logMessage || err?.message || err);
    return jsonResponse(code, { error: err?.statusCode ? err.message : 'Erro interno ao buscar conversas do WhatsApp.' });
  }
}
