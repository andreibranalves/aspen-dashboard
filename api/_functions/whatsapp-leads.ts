// GET /api/whatsapp-leads — five most recent WhatsApp conversations with contact readiness status.
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_lib/types.js';

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

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function normalizeWhatsappPhone(value: unknown): string {
  const raw = String(value || '');
  const parts = raw.split('@');
  const beforeAt = parts[0];
  const suffix = parts[1] || '';
  let digits = beforeAt.replace(/\D/g, '');
  if (!digits) return '';
  // @lid / @g.us / @newsletter JIDs are NOT phone numbers — only accept if already starts with 55
  if (suffix && suffix !== 's.whatsapp.net' && !digits.startsWith('55')) return '';
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11)
    digits = `55${digits}`;
  return digits;
}

function normalizeComparablePhone(value: unknown): string {
  let digits = normalizeWhatsappPhone(value);
  if (digits.startsWith('55')) digits = digits.slice(2);
  return digits.replace(/^0+/, '');
}

function isValidBrazilWhatsappPhone(value: unknown): boolean {
  const comparable = normalizeComparablePhone(value);
  return comparable.length === 10 || comparable.length === 11;
}

function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLeadEmail(value: unknown): string {
  return (
    String(value || '')
      .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
      ?.trim()
      .toLowerCase() || ''
  );
}

function getChatRemoteJid(chat: Record<string, any>): string {
  return firstNonEmpty(
    chat?.remoteJid,
    chat?.id,
    chat?.jid,
    chat?.key?.remoteJid,
    chat?.conversationTimestamp?.remoteJid
  );
}

function isGroupChat(chat: Record<string, any>): boolean {
  const remoteJid = getChatRemoteJid(chat);
  const candidateStrings = [
    remoteJid,
    chat?.remoteJid,
    chat?.id,
    chat?.jid,
    chat?.owner,
    chat?.subject,
    chat?.name,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  if (candidateStrings.some((value) => value.includes('@g.us'))) return true;
  if (candidateStrings.some((value) => value.includes('status@broadcast'))) return true;

  return Boolean(
    chat?.isGroup ||
    chat?.group ||
    chat?.isGrp ||
    chat?.isCommunity ||
    chat?.conversationType === 'group' ||
    chat?.chatType === 'group' ||
    chat?.type === 'group'
  );
}

function getChatTimestamp(chat: Record<string, any>): number {
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

function unwrapData(payload: Record<string, any>): any[] {
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

function getMessageRemoteJidAlt(message: Record<string, any>): string {
  return firstNonEmpty(
    message?.key?.remoteJidAlt,
    message?.remoteJidAlt,
    message?.message?.key?.remoteJidAlt,
    message?.lastMessage?.key?.remoteJidAlt,
    message?.lastMessage?.remoteJidAlt,
    message?.lastMessage?.message?.key?.remoteJidAlt
  );
}

// senderPn is the real phone number available even for @lid JIDs (WhatsApp workaround)
function getSenderPhone(messages: Record<string, any>[]): string {
  for (const msg of messages || []) {
    const senderPn = firstNonEmpty(
      msg?.key?.senderPn,
      msg?.senderPn,
      msg?.message?.key?.senderPn,
      msg?.lastMessage?.key?.senderPn
    );
    if (senderPn) {
      const digits = String(senderPn).replace(/\D/g, '');
      if (digits.length >= 10) return digits;
    }
  }
  return '';
}

// Build a map of pushName → phone digits from saved WhatsApp contacts
// Also returns a fuzzy-match function for partial name matching
let _contactMapCache: { data: Record<string, any> | null; ts: number } = { data: null, ts: 0 };
const CONTACT_MAP_TTL = 10 * 60 * 1000; // 10 min

async function getContactPhoneMap() {
  if (_contactMapCache.data && Date.now() - _contactMapCache.ts < CONTACT_MAP_TTL) {
    return _contactMapCache.data;
  }
  try {
    assertEvolutionConfig();
    const payload = await evolutionFetch(
      `/chat/findContacts/${encodeURIComponent(EVOLUTION_INSTANCE)}`,
      {}
    );
    const contacts = unwrapData(payload);
    const exact = new Map();
    const fuzzy = []; // { name, phone } for partial matching
    for (const c of contacts || []) {
      const name = cleanText(c?.pushName || c?.name || '').toLowerCase();
      const jid = String(c?.remoteJid || '');
      if (name && jid.endsWith('@s.whatsapp.net')) {
        const phone = normalizeWhatsappPhone(jid);
        if (isValidBrazilWhatsappPhone(phone)) {
          exact.set(name, phone);
          fuzzy.push({ name, phone });
        }
      }
    }
    const result = { exact, fuzzy };
    _contactMapCache = { data: result, ts: Date.now() };
    return result;
  } catch (err: any) {
    console.warn('[whatsapp-leads] contact map fallback:', err?.message || err);
    return { exact: new Map(), fuzzy: [] };
  }
}

function lookupContactPhone(contactMap: Record<string, any> | null, leadName: string): string {
  if (!leadName || !contactMap) return '';
  // Exact match
  if (contactMap.exact.has(leadName)) return contactMap.exact.get(leadName);
  // Fuzzy: contact name contains lead name, or vice versa
  for (const { name, phone } of contactMap.fuzzy) {
    if (name.includes(leadName) || leadName.includes(name)) return phone;
  }
  return '';
}

function getInboundPushName(messages: Record<string, any>[]): string {
  return (
    (messages || [])
      .slice()
      .reverse()
      .map((message: Record<string, any>) => cleanText(message?.pushName))
      .find((name: string) => name && name !== 'Você' && !/^\d+$/.test(name)) || ''
  );
}

function isPlaceholderLeadName(value: unknown): boolean {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) return true;

  return [
    'aspen',
    'aspen estamparia',
    'contato',
    'contatos',
    'contact',
    'contacts',
    'você',
    'voce',
    'unknown',
  ].includes(normalized);
}

function resolveLeadName(
  chat: Record<string, any>,
  messages: Record<string, any>[],
  extracted: Record<string, unknown>,
  telefone: string
): string {
  const extractedName = cleanText(extracted?.nome);
  const inboundName = getInboundPushName(messages);
  const chatNames = [chat?.pushName, chat?.name, chat?.notify].map(cleanText).filter(Boolean);

  const preferred = [extractedName, inboundName, ...chatNames].find(
    (name) => name && !isPlaceholderLeadName(name)
  );

  return preferred || firstNonEmpty(extractedName, inboundName, ...chatNames, telefone);
}

function getMessageText(message: Record<string, any>): string {
  const msg = message?.message || message;
  return cleanText(
    firstNonEmpty(
      msg?.conversation,
      msg?.extendedTextMessage?.text,
      msg?.imageMessage?.caption,
      msg?.videoMessage?.caption,
      msg?.documentMessage?.caption,
      message?.text,
      message?.body,
      message?.messageText,
      message?.content
    )
  );
}

function getMessageTimestamp(message: Record<string, any>): number {
  const candidate =
    message?.messageTimestamp || message?.timestamp || message?.createdAt || message?.dateTime;
  const numeric = Number(candidate);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMessages(
  messages: Record<string, any>[] | null
): { fromMe: boolean; text: string; timestamp: number }[] {
  return (messages || [])
    .map((message) => ({
      fromMe: Boolean(message?.key?.fromMe || message?.fromMe),
      text: getMessageText(message),
      timestamp: getMessageTimestamp(message),
    }))
    .filter((message) => message.text)
    .sort((a: { timestamp: number }, b: { timestamp: number }) => a.timestamp - b.timestamp);
}

function composeConversationText(
  messages: Record<string, any>[] | null,
  preNormalized?: { fromMe: boolean; text: string; timestamp: number }[] | null
): string {
  const normalized = preNormalized || normalizeMessages(messages);
  return normalized
    .slice(-MAX_MESSAGES_PER_CHAT)
    .map((message) => `${message.fromMe ? 'Aspen' : 'Cliente'}: ${message.text}`)
    .join('\n');
}

function extractFallback(conversationText: string): Record<string, unknown> {
  // Only analyze Cliente lines to avoid picking up attendant names from Aspen's side
  const clientLines = conversationText
    .split('\n')
    .filter((line) => /^Cliente:\s*/i.test(line))
    .map((line) => line.replace(/^Cliente:\s*/i, ''))
    .join('\n');
  const searchText = clientLines || conversationText;

  const email = normalizeLeadEmail(searchText);
  const nameMatch = searchText.match(/(?:meu nome é|me chamo|sou a?)\s*([^\n,.]+)/i);
  // Try to find a Brazilian phone number pattern in the text: (XX) XXXXX-XXXX or XX XXXXX-XXXX etc
  const phoneMatch =
    searchText.match(/(?:telefone|whatsapp|celular|contato|tel)[^\d]*(\d[\d\s().-]{8,})/i) ||
    searchText.match(/\(?(\d{2})\)?\s*\d[\d\s.-]{7,}/);
  const telefone = cleanText(phoneMatch?.[1] || '').replace(/\D/g, '');
  return {
    nome: cleanText(nameMatch?.[1] || ''),
    email,
    telefone,
  };
}

export function formatLeadText(lead: Record<string, unknown>): string {
  // Strip 55 prefix for display (Brazilian formatting applies DDD separately)
  const displayPhone = String(lead.telefone || '').startsWith('55')
    ? String(lead.telefone).slice(2)
    : String(lead.telefone || '');
  const lines = [
    lead.nome ? `Nome: ${lead.nome}` : 'Nome:',
    lead.email ? `E-mail: ${lead.email}` : 'E-mail:',
    displayPhone ? `Telefone: ${displayPhone}` : 'Telefone:',
  ];
  const pedidoParts = [];
  if (lead.produto) pedidoParts.push(lead.produto);
  if (lead.quantidade) pedidoParts.push(`${lead.quantidade} un`);
  lines.push(pedidoParts.length ? `Pedido: ${pedidoParts.join(' — ')}` : 'Pedido:');
  return lines.join('\n');
}

// ── External APIs ────────────────────────────────────────────────────────────

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function assertEvolutionConfig() {
  const missing = [];
  if (!EVOLUTION_BASE_URL) missing.push('EVOLUTION_BASE_URL');
  if (!EVOLUTION_API_KEY) missing.push('EVOLUTION_API_KEY');
  if (!EVOLUTION_INSTANCE) missing.push('EVOLUTION_INSTANCE');
  if (missing.length) {
    throw createHttpError(
      500,
      'Integração WhatsApp indisponível.',
      `[whatsapp-leads] missing env: ${missing.join(', ')}`
    );
  }
}

async function evolutionFetch(
  path: string,
  body: Record<string, any> = {},
  timeoutMs: number = 10000
): Promise<any> {
  assertEvolutionConfig();
  const res = await fetchWithTimeout(
    `${EVOLUTION_BASE_URL}${path}`,
    {
      method: 'POST',
      headers: {
        apikey: EVOLUTION_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw createHttpError(
      502,
      'Falha ao consultar WhatsApp.',
      `[whatsapp-leads] Evolution ${res.status}: ${text.slice(0, 500)}`
    );
  }
  return data;
}

async function findChats() {
  const payload = await evolutionFetch(
    `/chat/findChats/${encodeURIComponent(EVOLUTION_INSTANCE)}`,
    {}
  );
  return unwrapData(payload)
    .filter((chat) => getChatRemoteJid(chat) && !isGroupChat(chat))
    .sort((a, b) => getChatTimestamp(b) - getChatTimestamp(a))
    .slice(0, MAX_CHATS_TO_SCAN);
}

async function findMessages(remoteJid: string): Promise<any[]> {
  const payload = await evolutionFetch(
    `/chat/findMessages/${encodeURIComponent(EVOLUTION_INSTANCE)}`,
    {
      where: { key: { remoteJid } },
      limit: MAX_MESSAGES_PER_CHAT,
    }
  );
  return unwrapData(payload).slice(-MAX_MESSAGES_PER_CHAT);
}

export function isLikelyAttendantName(
  name: string,
  normalized: { fromMe: boolean; text: string }[]
): boolean {
  if (!name || name.length < 3) return false;
  const nameLower = name.toLowerCase();
  const aspenMentions = normalized
    .filter((m) => m.fromMe)
    .filter((m) => m.text.toLowerCase().includes(nameLower)).length;
  const clientMentions = normalized
    .filter((m) => !m.fromMe)
    .filter((m) => m.text.toLowerCase().includes(nameLower)).length;
  // Only flag as attendant name when it appears on Aspen side but never on client side
  return aspenMentions > 0 && clientMentions === 0;
}

async function extractLeadWithOpenRouter(
  conversationText: string,
  normalized?: { fromMe: boolean; text: string; timestamp: number }[]
): Promise<Record<string, unknown>> {
  const normalizedMessages = normalized || [];
  const fallback = extractFallback(conversationText);
  if (!OPENROUTER_API_KEY || !conversationText.trim()) return fallback;

  const prompt = `Você é um assistente da Aspen Estamparia. Abaixo está uma conversa de WhatsApp entre um ATENDENTE da Aspen e um CLIENTE.\n\nAs linhas "Aspen:" são mensagens ENVIADAS pelo atendente da Aspen.\nAs linhas "Cliente:" são mensagens RECEBIDAS do cliente.\n\nExtraia APENAS os dados de contato do CLIENTE — NUNCA extraia dados do atendente.\n\nRetorne APENAS JSON válido no formato:\n{"nome":"","email":"","telefone":""}\n\nRegras:\n- Extraia nome, e-mail e telefone APENAS do CLIENTE (lado "Cliente:").\n- IGNORE completamente nomes que apareçam nas mensagens do atendente (lado "Aspen:").\n- NUNCA retorne o nome de um atendente como sendo o cliente, mesmo que ele apareça na conversa.\n- Nunca invente dados ausentes.\n- Se a conversa tiver mais de um e-mail ou telefone, retorne apenas o primeiro citado pelo CLIENTE.\n- Telefone deve ser apenas dígitos com DDD (ex: 11987654321).\n- Se não houver um campo, use string vazia.\n\nConversa:\n${conversationText.slice(-6000)}`;

  try {
    const res = await fetchWithTimeout(
      'https://openrouter.ai/api/v1/chat/completions',
      {
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
      },
      15000
    );
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(
      String(raw)
        .replace(/^```(?:json)?\s*|\s*```$/g, '')
        .trim()
    );
    const aiName = cleanText(parsed.nome || '');
    // Filter out attendant names — if the AI returned a name that only appears
    // on Aspen's (attendant) side of the conversation, it's a false positive.
    const nome =
      aiName && normalizedMessages.length && isLikelyAttendantName(aiName, normalizedMessages)
        ? ''
        : aiName || fallback.nome;
    return {
      nome: cleanText(nome),
      email: normalizeLeadEmail(parsed.email || fallback.email),
      telefone: cleanText(parsed.telefone || fallback.telefone || '').replace(/\D/g, ''),
    };
  } catch (err: any) {
    console.warn('[whatsapp-leads] OpenRouter extraction fallback:', err?.message || err);
    return fallback;
  }
}

let _convertedKeysCache: { data: Record<string, any> | null; ts: number } = { data: null, ts: 0 };
const CONVERTED_KEYS_TTL = 60 * 1000; // 60s

async function getConvertedContactKeys() {
  if (_convertedKeysCache.data && Date.now() - _convertedKeysCache.ts < CONVERTED_KEYS_TTL) {
    return _convertedKeysCache.data;
  }
  const rows = await erpGetList('Quotation', {
    fields: ['name', 'customer_name', 'contact_email', 'contact_mobile'],
    filters: [['docstatus', '!=', 2]],
    order_by: 'creation desc',
    limit: 200,
  });
  const phones = new Map();
  const emails = new Map();
  const names = new Map();
  const emailPhones = new Map(); // email → phone (for @lid fallback)
  const quotationNames = new Map(); // quotationId → full customer name
  for (const row of rows || []) {
    const quotationId = String(row.name || '').trim();
    const customerName = cleanText(row.customer_name);
    const phone = normalizeComparablePhone(row.contact_mobile);
    const email = String(row.contact_email || '')
      .trim()
      .toLowerCase();
    if (phone && quotationId && !phones.has(phone)) phones.set(phone, quotationId);
    if (email && quotationId && !emails.has(email)) emails.set(email, quotationId);
    const name = customerName.toLowerCase();
    if (name && quotationId && !names.has(name)) names.set(name, quotationId);
    if (quotationId && customerName && !quotationNames.has(quotationId))
      quotationNames.set(quotationId, customerName);
    const fullPhone = normalizeWhatsappPhone(row.contact_mobile);
    if (email && fullPhone && isValidBrazilWhatsappPhone(fullPhone) && !emailPhones.has(email)) {
      emailPhones.set(email, fullPhone);
    }
  }
  const result = { phones, emails, names, emailPhones, quotationNames };
  _convertedKeysCache = { data: result, ts: Date.now() };
  return result;
}

export function findConvertedQuotation(
  lead: Record<string, any>,
  converted: Record<string, any>
): string {
  const phone = normalizeComparablePhone(lead.telefone);
  if (phone && converted.phones.has(phone)) return converted.phones.get(phone);
  const email = String(lead.email || '')
    .trim()
    .toLowerCase();
  if (email && converted.emails.has(email)) return converted.emails.get(email);
  const name = String(lead.nome || '')
    .trim()
    .toLowerCase();
  if (name && converted.names.has(name)) return converted.names.get(name);
  return '';
}

function resolveCanonicalLeadName(
  lead: Record<string, any>,
  converted: Record<string, any>
): string {
  const quotationId = findConvertedQuotation(lead, converted);
  const quotationName = quotationId ? cleanText(converted.quotationNames?.get(quotationId)) : '';
  return quotationName || cleanText(lead.nome);
}

export function resolveWhatsappDisplayName(
  extracted: Record<string, any>,
  chat: Record<string, any>,
  fallbackPhone: string
): string {
  const preferred = [
    cleanText(extracted?.nome),
    cleanText(chat?.pushName),
    cleanText(chat?.name),
    cleanText(chat?.notify),
  ].find((name) => name && !isPlaceholderLeadName(name));
  return (
    preferred ||
    firstNonEmpty(chat?.pushName, chat?.name, chat?.notify, extracted?.nome, fallbackPhone)
  );
}

export function prioritizeWhatsappLeads(
  leads: Record<string, any>[],
  limit: number = MAX_LEADS
): Record<string, any>[] {
  const byNewest = (a: Record<string, any>, b: Record<string, any>) =>
    Number(b.timestamp || 0) - Number(a.timestamp || 0);
  return [...leads].sort(byNewest).slice(0, limit);
}

export function getWhatsappLeadQuality(lead: Record<string, any>): {
  isReady: boolean;
  missingFields: string[];
  statusLabel: string;
} {
  const missingFields = [];
  if (!cleanText(lead?.nome)) missingFields.push('nome');
  if (!normalizeLeadEmail(lead?.email)) missingFields.push('email');
  if (!isValidBrazilWhatsappPhone(lead?.telefone)) missingFields.push('telefone');

  if (!missingFields.length) {
    return { isReady: true, missingFields, statusLabel: 'Pronto para gerar' };
  }

  const readable = missingFields.map((field) => (field === 'email' ? 'e-mail' : field));
  const joined =
    readable.length === 1
      ? readable[0]
      : `${readable.slice(0, -1).join(', ')} e ${readable.at(-1)}`;

  return { isReady: false, missingFields, statusLabel: `Sem ${joined}` };
}

export function shouldIncludeWhatsappLead(lead: Record<string, any>): boolean {
  return getWhatsappLeadQuality(lead).isReady;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  try {
    const [chats, converted, contactMap] = await Promise.all([
      findChats(),
      getConvertedContactKeys(),
      getContactPhoneMap(),
    ]);

    // Process each chat independently and in parallel
    const candidatePromises = chats.map(async (chat) => {
      const remoteJid = getChatRemoteJid(chat);
      if (!remoteJid) return null;

      const messages = await findMessages(remoteJid);
      const normalized = normalizeMessages(messages);
      const conversationText = composeConversationText(null, normalized);

      const displayJid = firstNonEmpty(
        getMessageRemoteJidAlt(chat),
        messages.map(getMessageRemoteJidAlt).find(Boolean),
        remoteJid
      );
      let telefone = normalizeWhatsappPhone(displayJid);

      // Fallback 1: senderPn in messages (WhatsApp workaround for @lid JIDs)
      if (!isValidBrazilWhatsappPhone(telefone)) {
        const senderPhone = getSenderPhone(messages);
        if (senderPhone) {
          const senderPhoneFormatted = normalizeWhatsappPhone(senderPhone);
          if (isValidBrazilWhatsappPhone(senderPhoneFormatted)) {
            telefone = senderPhoneFormatted;
          }
        }
      }

      const extracted = await extractLeadWithOpenRouter(conversationText, normalized);

      // Fallback 2: try extracted phone from conversation text (regex + OpenRouter)
      if (!isValidBrazilWhatsappPhone(telefone) && extracted.telefone) {
        const fallbackPhone = normalizeWhatsappPhone(extracted.telefone);
        if (isValidBrazilWhatsappPhone(fallbackPhone)) {
          telefone = fallbackPhone;
        }
      }
      if (!telefone) {
        console.warn('[whatsapp-leads] no valid phone for chat, skipping', {
          remoteJid,
          displayPhone: normalizeWhatsappPhone(displayJid),
          extractedPhone: extracted.telefone,
        });
        return null;
      }

      const nome = resolveLeadName(chat, messages, extracted, telefone);

      // Fallback 3: match email against ERPNext (most reliable for @lid resolution)
      if (!isValidBrazilWhatsappPhone(telefone)) {
        const leadEmail = normalizeLeadEmail(extracted.email);
        if (leadEmail && converted.emailPhones?.has(leadEmail)) {
          telefone = converted.emailPhones.get(leadEmail);
        }
      }

      // Fallback 4: match resolved name against saved contacts (fuzzy match for @lid)
      if (!isValidBrazilWhatsappPhone(telefone)) {
        const leadName = cleanText(nome).toLowerCase();
        const contactPhone = lookupContactPhone(contactMap, leadName);
        if (contactPhone) telefone = contactPhone;
      }

      // Log silent failure when all 4 fallbacks couldn't resolve the phone
      if (!isValidBrazilWhatsappPhone(telefone)) {
        console.warn('[whatsapp-leads] all fallbacks failed to resolve @lid phone', {
          remoteJid,
          nome,
          email: extracted.email,
          jidPhone: normalizeWhatsappPhone(displayJid),
        });
      }

      const timestamp =
        getChatTimestamp(chat) || Math.max(...normalized.map((m) => m.timestamp), 0);
      const lead = {
        id: remoteJid,
        remoteJid,
        nome,
        telefone,
        email: normalizeLeadEmail(extracted.email),
        resumo: conversationText.split('\n').slice(-2).join(' · '),
        timestamp,
      };
      const leadExt = lead as Record<string, unknown>;
      leadExt.quotationId = findConvertedQuotation(lead, converted);
      leadExt.nome = resolveCanonicalLeadName(lead, converted) || lead.nome;
      leadExt.hasQuotation = Boolean(leadExt.quotationId);
      Object.assign(leadExt, getWhatsappLeadQuality(lead));
      leadExt.texto = formatLeadText(leadExt);
      return lead;
    });

    const candidates = (await Promise.all(candidatePromises)).filter(Boolean) as Record<
      string,
      any
    >[];

    return jsonResponse(200, { success: true, data: prioritizeWhatsappLeads(candidates) });
  } catch (err: any) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[whatsapp-leads]', err?.logMessage || err?.message || err);
    return jsonResponse(code, {
      error: err?.statusCode ? err.message : 'Erro interno ao buscar conversas do WhatsApp.',
    });
  }
}
