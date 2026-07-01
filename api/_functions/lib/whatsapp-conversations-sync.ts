import { createHttpError } from './erpnext.js';
import {
  upsertWhatsappConversation,
  upsertWhatsappMessages,
  type WhatsappConversation,
  type WhatsappConversationStoreDeps,
} from './whatsapp-conversations-store.js';

// ponytail: .trim() guards against CRLF .env files (\r glued to the instance name corrupts the URL → fetch failed)
const EVOLUTION_BASE_URL = (process.env.EVOLUTION_BASE_URL || '').trim().replace(/\/+$/, '');
const EVOLUTION_API_KEY = (process.env.EVOLUTION_API_KEY || '').trim();
const EVOLUTION_INSTANCE = (process.env.EVOLUTION_INSTANCE || '').trim();

export interface EvolutionSyncDeps extends WhatsappConversationStoreDeps {
  fetchChats?: (limit: number) => Promise<Array<Record<string, unknown>>>;
  fetchMessages?: (remoteJid: string, limit: number) => Promise<Array<Record<string, unknown>>>;
}

export interface WhatsappSyncOptions {
  chatLimit?: number;
  messageLimit?: number;
}

function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(value: unknown): string {
  const raw = String(value || '').split('@')[0];
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  return digits;
}

function isGroupChat(chat: Record<string, unknown>): boolean {
  const values = [
    chat.remoteJid,
    chat.id,
    chat.jid,
    chat.subject,
    chat.name,
    chat.chatType,
    chat.type,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return (
    values.some((value) => value.includes('@g.us') || value.includes('status@broadcast')) ||
    chat.isGroup === true ||
    chat.group === true ||
    chat.chatType === 'group' ||
    chat.type === 'group'
  );
}

function readLastMessageText(chat: Record<string, unknown>): string {
  const last = (chat.lastMessage || chat.message || {}) as Record<string, unknown>;
  return cleanText(
    last.text ||
      last.body ||
      last.conversation ||
      (last.message as Record<string, unknown> | undefined)?.conversation ||
      chat.lastMessagePreview
  );
}

function readMessageBody(message: Record<string, unknown>): string {
  const nested = (message.message || {}) as Record<string, unknown>;
  const extended = (nested.extendedTextMessage || {}) as Record<string, unknown>;
  const image = (nested.imageMessage || {}) as Record<string, unknown>;
  const document = (nested.documentMessage || {}) as Record<string, unknown>;

  return cleanText(
    message.text ||
      message.body ||
      nested.conversation ||
      extended.text ||
      image.caption ||
      document.caption
  );
}

function readMessageType(message: Record<string, unknown>): string {
  const nested = (message.message || {}) as Record<string, unknown>;
  if (nested.imageMessage) return 'image';
  if (nested.documentMessage) return 'document';
  if (nested.audioMessage) return 'audio';
  if (nested.conversation || nested.extendedTextMessage || message.text || message.body)
    return 'text';
  return 'unknown';
}

export function unwrapEvolutionCollection(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;

  const value = payload as Record<string, unknown> | null;
  const candidates = [
    value?.data,
    value?.messages,
    value?.chats,
    value?.result,
    value?.response,
    (value?.data as Record<string, unknown> | undefined)?.messages,
    (value?.data as Record<string, unknown> | undefined)?.chats,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as Array<Record<string, unknown>>;
    if (
      candidate &&
      typeof candidate === 'object' &&
      Array.isArray((candidate as Record<string, unknown>).records)
    ) {
      return (candidate as { records: Array<Record<string, unknown>> }).records;
    }
  }

  return [];
}

export function normalizeEvolutionConversation(
  chat: Record<string, unknown>
): Record<string, unknown> | null {
  if (isGroupChat(chat)) return null;

  const remoteJid = cleanText(chat.remoteJid || chat.id || chat.jid || chat.key);
  const phone = normalizePhone(chat.phone || chat.senderPn || remoteJid);
  if (!remoteJid && !phone) return null;

  return {
    remoteJid,
    phone,
    displayName: cleanText(chat.pushName || chat.name || chat.notify || phone),
    lastMessageAt: chat.updatedAt || chat.messageTimestamp || chat.t || Date.now(),
    lastMessagePreview: readLastMessageText(chat),
  };
}

export function normalizeEvolutionMessage(
  message: Record<string, unknown>
): Record<string, unknown> | null {
  const key = (message.key || {}) as Record<string, unknown>;
  const providerMessageId = cleanText(message.id || message.messageId || key.id);
  const body = readMessageBody(message);
  const type = readMessageType(message);
  if (!providerMessageId && !body) return null;

  return {
    providerMessageId: providerMessageId || `${message.messageTimestamp || Date.now()}-${body}`,
    direction: key.fromMe === true || message.fromMe === true ? 'outbound' : 'inbound',
    type,
    body,
    mediaUrl: cleanText(message.mediaUrl || message.url),
    timestamp: message.messageTimestamp || message.timestamp || Date.now(),
    raw: message,
  };
}

async function evolutionRequest(path: string, body?: Record<string, unknown>): Promise<unknown> {
  if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    throw createHttpError(500, 'Integração WhatsApp não configurada.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${EVOLUTION_BASE_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVOLUTION_API_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw createHttpError(
      502,
      'Falha ao conectar com o WhatsApp. Verifique a instância da Evolution API.',
      `[whatsapp-conversations] fetch failed: ${(err as Error).message}`
    );
  }
  clearTimeout(timer);

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw createHttpError(
      res.status,
      'Erro ao sincronizar conversas do WhatsApp.',
      JSON.stringify(data || {})
    );
  }
  return data;
}

async function liveFetchChats(limit: number): Promise<Array<Record<string, unknown>>> {
  const data = await evolutionRequest(`/chat/findChats/${EVOLUTION_INSTANCE}`, { limit });
  return unwrapEvolutionCollection(data);
}

async function liveFetchMessages(
  remoteJid: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  const data = await evolutionRequest(`/chat/findMessages/${EVOLUTION_INSTANCE}`, {
    where: { key: { remoteJid } },
    limit,
  });
  return unwrapEvolutionCollection(data);
}

function chatSortValue(chat: Record<string, unknown>): number {
  const ts = chat.lastMessageAt ?? chat.updatedAt ?? chat.messageTimestamp ?? chat.t ?? 0;
  const numeric = Number(ts);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(ts));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function syncWhatsappConversations(
  options: WhatsappSyncOptions = {},
  deps?: EvolutionSyncDeps
): Promise<{ conversations: WhatsappConversation[]; syncedMessages: number }> {
  const chatLimit = Math.max(1, Math.min(Number(options.chatLimit || 5), 20));
  const messageLimit = Math.max(1, Math.min(Number(options.messageLimit || 50), 50));
  const fetchChats = deps?.fetchChats || liveFetchChats;
  const fetchMessages = deps?.fetchMessages || liveFetchMessages;

  const chats = await fetchChats(chatLimit);
  // ponytail: Evolution ignores the `limit` body param and returns every chat,
  // so we slice in-memory. Sorting by recent first keeps the most relevant.
  const normalizedChats = (chats
    .map(normalizeEvolutionConversation)
    .filter(Boolean) as Array<Record<string, unknown>>)
    .sort((a, b) => chatSortValue(b) - chatSortValue(a))
    .slice(0, chatLimit);

  // Fetch messages in parallel (slow HTTP); store writes stay serial (fast KV).
  const withMessages = await Promise.all(
    normalizedChats.map(async (chat) => ({
      chat,
      messages: (await fetchMessages(String(chat.remoteJid), messageLimit))
        .map(normalizeEvolutionMessage)
        .filter(Boolean) as Array<Record<string, unknown>>,
    }))
  );

  const conversations: WhatsappConversation[] = [];
  let syncedMessages = 0;
  for (const { chat, messages } of withMessages) {
    const conversation = await upsertWhatsappConversation(chat, deps);
    conversations.push(conversation);
    const stored = await upsertWhatsappMessages(conversation.id, messages, deps);
    syncedMessages += stored.length;
  }

  return { conversations, syncedMessages };
}

export async function syncMessagesForConversation(
  conversation: WhatsappConversation,
  messageLimit = 50,
  deps?: EvolutionSyncDeps
): Promise<WhatsappConversation> {
  const limit = Math.max(1, Math.min(Number(messageLimit), 50));
  const fetchMessages = deps?.fetchMessages || liveFetchMessages;

  const rawMessages = await fetchMessages(conversation.remoteJid, limit);
  const normalized = rawMessages.map(normalizeEvolutionMessage).filter(Boolean) as Array<
    Record<string, unknown>
  >;
  await upsertWhatsappMessages(conversation.id, normalized, deps);

  return conversation;
}
