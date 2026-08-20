import { getEvolutionClient } from '../_infrastructure/integrations/evolution/client.js';
import { getEvolutionConfig } from '../_infrastructure/integrations/evolution/config.js';
import { createHttpError } from '../_shared/http-error.js';
import { resolveWhatsappIdentity } from './whatsapp-identity-resolver.js';
import {
  normalizeWhatsappConversationInput,
  normalizeWhatsappMessageInput,
  upsertWhatsappConversation,
  upsertWhatsappMessages,
  type WhatsappConversation,
  type WhatsappConversationStoreDeps,
} from './whatsapp-conversations-store.js';

const EVOLUTION_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_PROVIDER_CHATS = 1_000;
const MAX_PROVIDER_MESSAGES = 1_000;

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
  const audio = (nested.audioMessage || {}) as Record<string, unknown>;

  return cleanText(
    message.text ||
      message.body ||
      nested.conversation ||
      extended.text ||
      image.caption ||
      document.caption ||
      audio.caption
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
  const providerId = cleanText(chat.providerConversationId || chat.remoteJid || chat.id || chat.jid);
  const identity = resolveWhatsappIdentity({
    source: 'provider',
    chat: {
      remoteJid: providerId,
      phone: chat.phone,
      senderPn: chat.senderPn,
      participant: chat.participant,
      from: chat.from,
      sender: chat.sender,
      pushName: chat.pushName,
      displayName: chat.displayName,
      name: chat.name,
      notify: chat.notify,
    },
  });
  if (!identity.providerConversationId && !identity.canonicalPhone) return null;

  return {
    remoteJid: identity.providerConversationId || providerId,
    providerConversationId: identity.providerConversationId || providerId,
    phone: identity.canonicalPhone,
    canonicalPhone: identity.canonicalPhone,
    displayName: identity.displayLabel,
    displayLabel: identity.displayLabel,
    identityStatus: identity.identityStatus,
    identitySource: identity.identitySource,
    identityConfidence: identity.identityConfidence,
    lastMessageAt: chat.updatedAt || chat.messageTimestamp || chat.t || Date.now(),
    lastMessagePreview: readLastMessageText(chat),
  };
}

function getAttachmentFromMessage(
  _message: Record<string, unknown>,
  _type: string
): Record<string, unknown> | null {
  // Provider media URLs are never trusted or persisted. A later local media
  // ingestion path may add an owned attachment after validation.
  return null;
}

export function normalizeEvolutionMessage(
  message: Record<string, unknown>
): Record<string, unknown> | null {
  const key = (message.key || {}) as Record<string, unknown>;
  const providerMessageId = cleanText(message.id || message.messageId || key.id);
  const body = readMessageBody(message);
  const type = readMessageType(message);
  if (!providerMessageId && !body) return null;

  const attachment = getAttachmentFromMessage(message, type);
  return {
    providerMessageId: providerMessageId || `${message.messageTimestamp || Date.now()}-${body}`,
    direction: key.fromMe === true || message.fromMe === true ? 'outbound' : 'inbound',
    type,
    body,
    mediaUrl: '',
    attachments: attachment ? [attachment] : [],
    timestamp: message.messageTimestamp || message.timestamp || Date.now(),
  };
}

async function readEvolutionJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_PROVIDER_RESPONSE_BYTES)) {
    throw new Error('provider response too large');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    return response.json().catch(() => null);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_PROVIDER_RESPONSE_BYTES) throw new Error('provider response too large');
      chunks.push(next.value);
    }
    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export interface EvolutionRequestOptions {
  baseUrl?: string;
  apiKey?: string;
  instance?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function evolutionRequest(
  path: string,
  body?: Record<string, unknown>,
  options: EvolutionRequestOptions = {},
): Promise<unknown> {
  const configured = getEvolutionConfig();
  const mergedConfig = {
    baseUrl: options.baseUrl ?? configured.baseUrl,
    apiKey: options.apiKey ?? configured.apiKey,
    instance: options.instance ?? configured.instance,
  };
  if (!mergedConfig.baseUrl || !mergedConfig.apiKey || !mergedConfig.instance) {
    throw createHttpError(503, 'Integração WhatsApp não configurada.');
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(options.timeoutMs ?? EVOLUTION_TIMEOUT_MS));
  const client = getEvolutionClient({
    getConfig: () => mergedConfig,
    fetchImpl: options.fetchImpl,
  });
  let timedOut = false;
  let rejectTimeout: ((reason?: unknown) => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectTimeout?.(new Error('Evolution request timeout'));
  }, timeoutMs);
  try {
    const response = await Promise.race([
      client.request(path, body, {
        externalWrite: false,
        signal: controller.signal,
      }),
      timeout,
    ]);
    const data = await Promise.race([readEvolutionJson(response), timeout]);
    if (!response.ok) {
      throw createHttpError(
        response.status,
        'Erro ao sincronizar conversas do WhatsApp.',
        `[whatsapp-conversations] ${path} HTTP ${response.status}`
      );
    }
    return data;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    if (timedOut || controller.signal.aborted) {
      throw createHttpError(
        504,
        'Tempo limite ao sincronizar conversas do WhatsApp.',
        `[whatsapp-conversations] ${path} timeout`
      );
    }
    throw createHttpError(
      502,
      'Falha ao conectar com o WhatsApp. Verifique a instância da Evolution API.',
      `[whatsapp-conversations] ${path} fetch failed`
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function liveFetchChats(limit: number): Promise<Array<Record<string, unknown>>> {
  const data = await evolutionRequest(`/chat/findChats/${getEvolutionConfig().instance}`, { limit });
  return unwrapEvolutionCollection(data);
}

async function liveFetchMessages(
  remoteJid: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  const data = await evolutionRequest(`/chat/findMessages/${getEvolutionConfig().instance}`, {
    where: { key: { remoteJid } },
    limit,
  });
  return unwrapEvolutionCollection(data);
}

function chatSortValue(chat: Record<string, unknown>): number {
  const timestamp = chat.lastMessageAt ?? chat.updatedAt ?? chat.messageTimestamp ?? chat.t ?? 0;
  const numeric = Number(timestamp);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(timestamp));
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageSortValue(message: Record<string, unknown>): number {
  const timestamp = message.messageTimestamp ?? message.timestamp ?? message.t ?? 0;
  const numeric = Number(timestamp);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(timestamp));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stableProviderKey(value: Record<string, unknown>): string {
  const key = (value.key || {}) as Record<string, unknown>;
  return cleanText(
    value.providerConversationId || value.remoteJid || value.jid || value.id || value.messageId || key.id
  );
}

function stableMessageKey(value: Record<string, unknown>): string {
  const key = (value.key || {}) as Record<string, unknown>;
  return (
    cleanText(value.id || value.messageId || key.id) ||
    [messageSortValue(value), readMessageType(value), readMessageBody(value), key.fromMe === true ? 'out' : 'in'].join('|')
  );
}

function stableChatTie(value: Record<string, unknown>): string {
  return [
    stableProviderKey(value),
    chatSortValue(value),
    readLastMessageText(value),
    cleanText(value.pushName || value.displayName || value.name),
  ].join('|');
}

function stableMessageTie(value: Record<string, unknown>): string {
  const key = (value.key || {}) as Record<string, unknown>;
  return [
    stableMessageKey(value),
    messageSortValue(value),
    readMessageType(value),
    readMessageBody(value),
    key.fromMe === true ? 'out' : 'in',
  ].join('|');
}

function prepareChats(value: Array<Record<string, unknown>>, limit: number): Array<Record<string, unknown>> {
  const bounded = Array.isArray(value) ? value.slice(0, MAX_PROVIDER_CHATS) : [];
  const unique = new Map<string, Record<string, unknown>>();
  for (const chat of bounded) {
    if (!chat || typeof chat !== 'object' || isGroupChat(chat)) continue;
    const key = stableProviderKey(chat);
    if (!key) continue;
    const previous = unique.get(key);
    if (!previous || chatSortValue(chat) > chatSortValue(previous) ||
      (chatSortValue(chat) === chatSortValue(previous) && stableChatTie(chat) > stableChatTie(previous))) {
      unique.set(key, chat);
    }
  }
  return [...unique.values()]
    .sort((a, b) => chatSortValue(b) - chatSortValue(a) || stableProviderKey(a).localeCompare(stableProviderKey(b)))
    .slice(0, limit);
}

function prepareMessages(value: Array<Record<string, unknown>>, limit: number): Array<Record<string, unknown>> {
  const bounded = Array.isArray(value) ? value.slice(0, MAX_PROVIDER_MESSAGES) : [];
  const unique = new Map<string, Record<string, unknown>>();
  for (const message of bounded) {
    if (!message || typeof message !== 'object') continue;
    const key = stableMessageKey(message);
    const previous = unique.get(key);
    if (!previous || messageSortValue(message) > messageSortValue(previous) ||
      (messageSortValue(message) === messageSortValue(previous) && stableMessageTie(message) > stableMessageTie(previous))) {
      unique.set(key, message);
    }
  }
  return [...unique.values()]
    .sort((a, b) => messageSortValue(b) - messageSortValue(a) || stableMessageKey(a).localeCompare(stableMessageKey(b)))
    .slice(0, limit)
    .sort((a, b) => messageSortValue(a) - messageSortValue(b) || stableMessageKey(a).localeCompare(stableMessageKey(b)));
}

export async function syncWhatsappConversations(
  options: WhatsappSyncOptions = {},
  deps?: EvolutionSyncDeps
): Promise<{ conversations: WhatsappConversation[]; syncedMessages: number }> {
  const chatLimit = Math.max(1, Math.min(Number(options.chatLimit || 5), 20));
  const messageLimit = Math.max(1, Math.min(Number(options.messageLimit || 100), 100));
  const fetchChats = deps?.fetchChats || liveFetchChats;
  const fetchMessages = deps?.fetchMessages || liveFetchMessages;
  const fetchedChats = await fetchChats(chatLimit);
  const rankedChats = prepareChats(fetchedChats, chatLimit);

  const withMessages = await Promise.all(
    rankedChats.map(async (chat) => {
      const remoteJid = cleanText(chat.remoteJid || chat.id || chat.jid || '');
      const fetchedMessages = remoteJid ? await fetchMessages(remoteJid, messageLimit) : [];
      const rawMessages = prepareMessages(fetchedMessages, messageLimit);
      const normalizedChat = normalizeEvolutionConversation(chat);
      if (normalizedChat && rawMessages.length > 0) {
        const enriched = resolveWhatsappIdentity({
          source: 'provider',
          chat: {
            remoteJid,
            phone: chat.phone,
            senderPn: chat.senderPn,
            participant: chat.participant,
            from: chat.from,
            sender: chat.sender,
            pushName: chat.pushName,
            displayName: chat.displayName,
            name: chat.name,
          },
          messages: rawMessages,
        });
        normalizedChat.canonicalPhone = enriched.canonicalPhone;
        normalizedChat.phone = enriched.canonicalPhone;
        normalizedChat.identityStatus = enriched.identityStatus;
        normalizedChat.identitySource = enriched.identitySource;
        normalizedChat.identityConfidence = enriched.identityConfidence;
      }
      return {
        chat: normalizedChat,
        messages: rawMessages
          .map(normalizeEvolutionMessage)
          .filter(Boolean) as Array<Record<string, unknown>>,
      };
    })
  );

  const conversations: WhatsappConversation[] = [];
  let syncedMessages = 0;
  for (const item of withMessages) {
    if (!item.chat) continue;
    const conversation = await upsertWhatsappConversation(item.chat, deps);
    conversations.push(conversation);
    await upsertWhatsappMessages(conversation.id, item.messages, deps);
    syncedMessages += item.messages.length;
  }
  return { conversations, syncedMessages };
}

export async function syncMessagesForConversation(
  conversation: WhatsappConversation,
  messageLimit = 100,
  deps?: EvolutionSyncDeps
): Promise<WhatsappConversation> {
  const limit = Math.max(1, Math.min(Number(messageLimit), 100));
  const fetchMessages = deps?.fetchMessages || liveFetchMessages;
  const fetchedMessages = await fetchMessages(conversation.remoteJid, limit);
  const rawMessages = prepareMessages(fetchedMessages, limit);
  const normalized = rawMessages
    .map(normalizeEvolutionMessage)
    .filter(Boolean) as Array<Record<string, unknown>>;
  await upsertWhatsappMessages(conversation.id, normalized, deps);

  const identity = resolveWhatsappIdentity({
    source: 'stored',
    chat: { remoteJid: conversation.remoteJid, displayName: conversation.displayName },
    messages: rawMessages,
    storedConversation: conversation as unknown as Record<string, unknown>,
  });
  if (
    identity.canonicalPhone !== conversation.canonicalPhone ||
    identity.identityStatus !== conversation.identityStatus
  ) {
    return upsertWhatsappConversation(
      {
        id: conversation.id,
        providerConversationId: conversation.providerConversationId,
        remoteJid: conversation.remoteJid,
        canonicalPhone: identity.canonicalPhone,
        phone: identity.canonicalPhone,
        displayLabel: identity.displayLabel,
        displayName: identity.displayLabel,
        identityStatus: identity.identityStatus,
        identitySource: identity.identitySource,
        identityConfidence: identity.identityConfidence,
        lastMessageAt: conversation.lastMessageAt,
        lastMessagePreview: conversation.lastMessagePreview,
        source: 'evolution',
        linkedLeadId: conversation.linkedLeadId,
        linkedDealId: conversation.linkedDealId,
        linkedQuotationId: conversation.linkedQuotationId,
        linkedCrmEntityId: conversation.linkedCrmEntityId,
        linkedCrmEntityType: conversation.linkedCrmEntityType,
        linkedCrmMatchSource: conversation.linkedCrmMatchSource,
        status: conversation.status,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      deps
    );
  }
  return conversation;
}

// Keep the import available to focused seam tests without persisting provider payloads.
export { normalizeWhatsappConversationInput, normalizeWhatsappMessageInput };
