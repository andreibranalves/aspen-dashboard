import { kv } from '@vercel/kv';
import { createHttpError } from './erpnext.js';
import { resolveWhatsappIdentity } from './whatsapp-identity-resolver.js';

export type WhatsappConversationStatus =
  | 'new'
  | 'needs_quote'
  | 'incomplete'
  | 'quote_lead_created'
  | 'quotation_created'
  | 'waiting_customer'
  | 'closed'
  | 'ignored';

export type WhatsappMessageDirection = 'inbound' | 'outbound';
export type WhatsappMessageType = 'text' | 'image' | 'document' | 'audio' | 'unknown';

export interface WhatsappConversation {
  id: string;
  providerConversationId: string;
  remoteJid: string; // compat alias
  canonicalPhone: string; // business identity
  phone: string; // compat alias
  displayLabel: string; // visual label
  displayName: string; // compat alias
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
  identitySource: string | null;
  identityConfidence: 'high' | 'medium' | 'low' | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  source: 'evolution';
  linkedLeadId?: string | null;
  linkedDealId?: string | null;
  linkedQuotationId?: string | null;
  linkedCrmEntityId?: string | null;
  linkedCrmEntityType?: 'lead' | 'cliente' | null;
  linkedCrmMatchSource?: 'phone' | 'email' | 'name' | null;
  status: WhatsappConversationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsappMessage {
  id: string;
  conversationId: string;
  providerMessageId: string;
  direction: WhatsappMessageDirection;
  type: WhatsappMessageType;
  body: string;
  mediaUrl: string;
  timestamp: string;
  raw?: Record<string, unknown>;
}

export interface WhatsappQuoteExtraction {
  id: string;
  conversationId: string;
  inputMessageIds: string[];
  extractedPayload: Record<string, unknown>;
  confidence: number;
  missingFields: string[];
  quoteLeadId?: string | null;
  quotationId?: string | null;
  createdAt: string;
}

export interface WhatsappConversationStoreDeps {
  readConversations: () => Promise<WhatsappConversation[]>;
  writeConversations: (conversations: WhatsappConversation[]) => Promise<void>;
  readMessages: (conversationId: string) => Promise<WhatsappMessage[]>;
  writeMessages: (conversationId: string, messages: WhatsappMessage[]) => Promise<void>;
  now: () => string;
  id: () => string;
}

export interface WhatsappConversationFilters {
  status?: WhatsappConversationStatus | 'all';
  q?: unknown;
  hasQuoteRequest?: unknown;
  limit?: unknown;
}

const KV_KEY_CONVERSATIONS = 'aspen:whatsapp-conversations';
const KV_KEY_MESSAGES_PREFIX = 'aspen:whatsapp-messages:';
const MAX_STORED_CONVERSATIONS = 200;
const MAX_STORED_MESSAGES_PER_CONVERSATION = 100;

export function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PHONE_JID_RE = /^\d+@(s\.whatsapp\.net|c\.us)$/i;

export function normalizeWhatsappPhone(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (raw.includes('@') && !PHONE_JID_RE.test(raw)) {
    return '';
  }

  const beforeAt = raw.split('@')[0];
  let digits = beforeAt.replace(/\D/g, '');
  if (!digits || digits.length < 10 || digits.length > 15) return '';
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  return digits;
}

export function normalizeWhatsappPhoneFromRemoteJid(value: unknown): string {
  const raw = String(value || '').trim();
  if (!PHONE_JID_RE.test(raw)) return '';
  return normalizeWhatsappPhone(raw);
}

function normalizeIso(value: unknown, fallback: string): string {
  if (!value) return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const millis = numeric < 1e12 ? numeric * 1000 : numeric;
    return new Date(millis).toISOString();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function parseLimit(value: unknown): number {
  const limit = Number(value || 50);
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 50;
}

function parseStatus(value: unknown): WhatsappConversationStatus {
  const allowed: WhatsappConversationStatus[] = [
    'new',
    'needs_quote',
    'incomplete',
    'quote_lead_created',
    'quotation_created',
    'waiting_customer',
    'closed',
    'ignored',
  ];
  return allowed.includes(value as WhatsappConversationStatus)
    ? (value as WhatsappConversationStatus)
    : 'new';
}

function liveNow(): string {
  return new Date().toISOString();
}

function liveId(): string {
  return `wa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function liveReadConversations(): Promise<WhatsappConversation[]> {
  if (!kv) return [];
  const value = await kv.get(KV_KEY_CONVERSATIONS);
  return Array.isArray(value) ? (value as WhatsappConversation[]) : [];
}

async function liveWriteConversations(conversations: WhatsappConversation[]): Promise<void> {
  if (!kv) throw createHttpError(500, 'Armazenamento de conversas não configurado.');
  await kv.set(KV_KEY_CONVERSATIONS, conversations.slice(0, MAX_STORED_CONVERSATIONS));
}

async function liveReadMessages(conversationId: string): Promise<WhatsappMessage[]> {
  if (!kv) return [];
  const value = await kv.get(`${KV_KEY_MESSAGES_PREFIX}${conversationId}`);
  return Array.isArray(value) ? (value as WhatsappMessage[]) : [];
}

async function liveWriteMessages(
  conversationId: string,
  messages: WhatsappMessage[]
): Promise<void> {
  if (!kv) throw createHttpError(500, 'Armazenamento de mensagens não configurado.');
  await kv.set(
    `${KV_KEY_MESSAGES_PREFIX}${conversationId}`,
    messages.slice(-MAX_STORED_MESSAGES_PER_CONVERSATION)
  );
}

export const LIVE_DEPS: WhatsappConversationStoreDeps = {
  readConversations: liveReadConversations,
  writeConversations: liveWriteConversations,
  readMessages: liveReadMessages,
  writeMessages: liveWriteMessages,
  now: liveNow,
  id: liveId,
};

export function normalizeWhatsappConversationInput(
  input: Record<string, unknown>,
  deps: Pick<WhatsappConversationStoreDeps, 'now' | 'id'> = LIVE_DEPS
): WhatsappConversation {
  const now = deps.now();
  const identity = resolveWhatsappIdentity({ source: 'provider', chat: input });

  return {
    id: cleanText(input.id) || deps.id(),
    providerConversationId: identity.providerConversationId,
    remoteJid: identity.providerConversationId, // compat
    canonicalPhone: identity.canonicalPhone,
    phone: identity.canonicalPhone, // compat
    displayLabel: identity.displayLabel,
    displayName: identity.displayLabel, // compat
    identityStatus: identity.identityStatus,
    identitySource: identity.identitySource,
    identityConfidence: identity.identityConfidence,
    lastMessageAt: normalizeIso(input.lastMessageAt || input.timestamp, now),
    lastMessagePreview: cleanText(input.lastMessagePreview || input.preview || ''),
    source: 'evolution',
    linkedLeadId: cleanText(input.linkedLeadId) || null,
    linkedDealId: cleanText(input.linkedDealId) || null,
    linkedQuotationId: cleanText(input.linkedQuotationId) || null,
    linkedCrmEntityId: cleanText(input.linkedCrmEntityId) || null,
    linkedCrmEntityType: (cleanText(input.linkedCrmEntityType) || null) as
      | 'lead'
      | 'cliente'
      | null,
    linkedCrmMatchSource: (cleanText(input.linkedCrmMatchSource) || null) as
      | 'phone'
      | 'email'
      | 'name'
      | null,
    status: parseStatus(input.status),
    createdAt: normalizeIso(input.createdAt, now),
    updatedAt: normalizeIso(input.updatedAt, now),
  };
}

export function normalizeWhatsappMessageInput(
  input: Record<string, unknown>,
  deps: Pick<WhatsappConversationStoreDeps, 'now' | 'id'> = LIVE_DEPS
): WhatsappMessage {
  const now = deps.now();
  const direction =
    input.direction === 'outbound' || input.fromMe === true ? 'outbound' : 'inbound';
  const type = ['text', 'image', 'document', 'audio'].includes(String(input.type))
    ? (input.type as WhatsappMessageType)
    : 'unknown';

  return {
    id: cleanText(input.id) || deps.id(),
    conversationId: cleanText(input.conversationId),
    providerMessageId:
      cleanText(input.providerMessageId || input.key || input.messageId) || deps.id(),
    direction,
    type,
    body: cleanText(input.body || input.text || input.caption || ''),
    mediaUrl: cleanText(input.mediaUrl || input.url || ''),
    timestamp: normalizeIso(input.timestamp || input.messageTimestamp, now),
    raw:
      input.raw && typeof input.raw === 'object'
        ? (input.raw as Record<string, unknown>)
        : undefined,
  };
}

export async function upsertWhatsappConversation(
  input: Record<string, unknown>,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappConversation> {
  const normalized = normalizeWhatsappConversationInput(input, deps);
  const conversations = await deps.readConversations();
  const index = conversations.findIndex(
    (item) =>
      item.remoteJid === normalized.remoteJid || (!!item.phone && item.phone === normalized.phone)
  );

  const next = [...conversations];
  if (index >= 0) {
    const current = next[index];
    next[index] = {
      ...current,
      ...normalized,
      id: current.id,
      createdAt: current.createdAt,
      status: normalized.status === 'new' ? current.status : normalized.status,
      linkedLeadId: normalized.linkedLeadId || current.linkedLeadId || null,
      linkedDealId: normalized.linkedDealId || current.linkedDealId || null,
      canonicalPhone:
        normalized.canonicalPhone ||
        (normalized.identityStatus === 'unresolved' && current.identityStatus !== 'verified'
          ? ''
          : current.canonicalPhone || ''),
      displayLabel: normalized.displayLabel || current.displayLabel || '',
      identityStatus:
        normalized.identityStatus !== 'unresolved'
          ? normalized.identityStatus
          : current.identityStatus || 'unresolved',
      identitySource: normalized.identitySource || current.identitySource || null,
      identityConfidence: normalized.identityConfidence || current.identityConfidence || null,
      phone:
        normalized.phone ||
        (normalized.identityStatus === 'unresolved' && current.identityStatus !== 'verified'
          ? ''
          : current.phone || ''),
      displayName: normalized.displayName || current.displayName || '',
      linkedQuotationId: normalized.linkedQuotationId || current.linkedQuotationId || null,
      linkedCrmEntityId: normalized.linkedCrmEntityId || current.linkedCrmEntityId || null,
      linkedCrmEntityType: normalized.linkedCrmEntityType || current.linkedCrmEntityType || null,
      linkedCrmMatchSource: normalized.linkedCrmMatchSource || current.linkedCrmMatchSource || null,
      updatedAt: deps.now(),
    };
  } else {
    next.push(normalized);
  }

  next.sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
  await deps.writeConversations(next.slice(0, MAX_STORED_CONVERSATIONS));
  return index >= 0 ? next.find((item) => item.id === conversations[index].id)! : normalized;
}

export async function upsertWhatsappMessages(
  conversationId: string,
  inputs: Array<Record<string, unknown>>,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappMessage[]> {
  const existing = await deps.readMessages(conversationId);
  const byProviderId = new Map(existing.map((message) => [message.providerMessageId, message]));

  for (const input of inputs) {
    const normalized = normalizeWhatsappMessageInput({ ...input, conversationId }, deps);
    byProviderId.set(normalized.providerMessageId, normalized);
  }

  const next = Array.from(byProviderId.values()).sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
  );
  await deps.writeMessages(conversationId, next.slice(-MAX_STORED_MESSAGES_PER_CONVERSATION));
  return next;
}

export async function listWhatsappConversations(
  filters: WhatsappConversationFilters = {},
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappConversation[]> {
  const q = cleanText(filters.q).toLowerCase();
  const status = filters.status || 'all';
  const limit = parseLimit(filters.limit);
  const hasQuoteRequest = filters.hasQuoteRequest === true || filters.hasQuoteRequest === 'true';

  return (await deps.readConversations())
    .filter((item) => status === 'all' || item.status === status)
    .filter((item) => !hasQuoteRequest || item.status === 'needs_quote')
    .filter((item) => {
      if (!q) return true;
      return [item.displayLabel, item.canonicalPhone, item.phone, item.lastMessagePreview].some(
        (value) => value.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
    .slice(0, limit);
}

export async function getWhatsappConversation(
  id: string,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappConversation> {
  const conversation = (await deps.readConversations()).find((item) => item.id === id);
  if (!conversation) throw createHttpError(404, 'Conversa do WhatsApp não encontrada.');
  return conversation;
}

export async function getWhatsappMessages(
  conversationId: string,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappMessage[]> {
  await getWhatsappConversation(conversationId, deps);
  return deps.readMessages(conversationId);
}

export async function updateWhatsappConversation(
  id: string,
  patch: Partial<WhatsappConversation>,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappConversation> {
  const conversations = await deps.readConversations();
  const index = conversations.findIndex((item) => item.id === id);
  if (index < 0) throw createHttpError(404, 'Conversa do WhatsApp não encontrada.');

  const next = [...conversations];
  next[index] = {
    ...next[index],
    status: patch.status ? parseStatus(patch.status) : next[index].status,
    linkedLeadId: patch.linkedLeadId === undefined ? next[index].linkedLeadId : patch.linkedLeadId,
    linkedDealId: patch.linkedDealId === undefined ? next[index].linkedDealId : patch.linkedDealId,
    linkedQuotationId:
      patch.linkedQuotationId === undefined
        ? next[index].linkedQuotationId
        : patch.linkedQuotationId,
    linkedCrmEntityId:
      patch.linkedCrmEntityId === undefined
        ? next[index].linkedCrmEntityId
        : patch.linkedCrmEntityId,
    linkedCrmEntityType:
      patch.linkedCrmEntityType === undefined
        ? next[index].linkedCrmEntityType
        : patch.linkedCrmEntityType,
    linkedCrmMatchSource:
      patch.linkedCrmMatchSource === undefined
        ? next[index].linkedCrmMatchSource
        : patch.linkedCrmMatchSource,
    canonicalPhone:
      patch.canonicalPhone === undefined ? next[index].canonicalPhone : patch.canonicalPhone,
    displayLabel: patch.displayLabel === undefined ? next[index].displayLabel : patch.displayLabel,
    identityStatus:
      patch.identityStatus === undefined ? next[index].identityStatus : patch.identityStatus,
    identitySource:
      patch.identitySource === undefined ? next[index].identitySource : patch.identitySource,
    identityConfidence:
      patch.identityConfidence === undefined
        ? next[index].identityConfidence
        : patch.identityConfidence,
    phone: patch.phone === undefined ? next[index].phone : patch.phone,
    displayName: patch.displayName === undefined ? next[index].displayName : patch.displayName,
    updatedAt: deps.now(),
  };
  await deps.writeConversations(next);
  return next[index];
}
