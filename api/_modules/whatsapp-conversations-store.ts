import { getKvClient } from '../_infrastructure/integrations/kv/client.js';
import { isKvConfigured } from '../_infrastructure/integrations/kv/config.js';
import { createHttpError } from '../_shared/http-error.js';
import { resolveWhatsappIdentity } from './whatsapp-identity-resolver.js';

export { normalizeWhatsappPhone, normalizeWhatsappPhoneFromRemoteJid } from '../_shared/whatsapp-phone.js';

const kv = getKvClient();

export type WhatsappConversationStatus =
  | 'new'
  | 'needs_quote'
  | 'incomplete'
  | 'quote_lead_created'
  | 'quotation_created'
  | 'waiting_customer'
  | 'closed'
  | 'ignored';

export interface WhatsappAttachment {
  id: string;
  kind: 'image' | 'document' | 'audio';
  mimeType: string;
  fileName: string;
  mediaUrl: string;
  caption: string;
  origin: 'provider' | 'internal_generated';
  documentRole: 'quotation_pdf' | 'generic_document' | null;
  quotationId: string | null;
  /** Validated ORC business reference kept separate from the local UUID. */
  quotationBusinessNumber: string | null;
  leadId: string | null;
  customerId: string | null;
}

export type WhatsappMessageDirection = 'inbound' | 'outbound';
export type WhatsappMessageType = 'text' | 'image' | 'document' | 'audio' | 'unknown';

export interface WhatsappConversation {
  id: string;
  /** Internal provider conversation key. Never expose this in public payloads. */
  providerConversationId: string;
  /** Internal compatibility alias used only when fetching Evolution messages. */
  remoteJid: string;
  canonicalPhone: string;
  phone: string;
  displayLabel: string;
  displayName: string;
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
  /**
   * Internal admission fence. `admissionReservedSequence` is a monotonic
   * reservation taken before a brand-new admission writes anything;
   * `admissionSelectedSequence` is the reservation that last wrote the CRM
   * selection. They live in the conversation mutation state so a stale
   * admission that finishes later can never overwrite a newer selection.
   */
  admissionReservedSequence?: number;
  admissionSelectedSequence?: number;
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
  attachments?: WhatsappAttachment[];
  /** Legacy reads may still expose this field; new sync normalization never writes it. */
  raw?: Record<string, unknown>;
  timestamp: string;
}

type ConversationMutation<T> = (
  current: readonly WhatsappConversation[]
) => Promise<{ conversations: WhatsappConversation[]; result: T }> | {
  conversations: WhatsappConversation[];
  result: T;
};

type MessageMutation<T> = (
  current: readonly WhatsappMessage[]
) => Promise<{ messages: WhatsappMessage[]; result: T }> | {
  messages: WhatsappMessage[];
  result: T;
};

export interface WhatsappConversationStoreDeps {
  readConversations: () => Promise<WhatsappConversation[]>;
  writeConversations: (conversations: WhatsappConversation[]) => Promise<void>;
  readMessages: (conversationId: string) => Promise<WhatsappMessage[]>;
  writeMessages: (conversationId: string, messages: WhatsappMessage[]) => Promise<void>;
  now: () => string;
  id: () => string;
  /** Shared-storage CAS seams. The fallback lock is only for injected local tests. */
  atomicUpdateConversations?: <T>(mutation: ConversationMutation<T>) => Promise<T>;
  atomicUpdateMessages?: <T>(
    conversationId: string,
    mutation: MessageMutation<T>
  ) => Promise<T>;
  /** Runs against the latest CAS snapshot before each conversation write. */
  validateConversationMutation?: (
    current: readonly WhatsappConversation[],
    next: readonly WhatsappConversation[]
  ) => Promise<void>;
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
const CAS_ATTEMPTS = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORC_BUSINESS_NUMBER_PATTERN = /^ORC-[0-9]{8}$/;
const LOCAL_MEDIA_PATH_PATTERN = /^\/(?:media|api\/whatsapp-media)\/[A-Za-z0-9][A-Za-z0-9._~-]{0,127}(?:\/[A-Za-z0-9][A-Za-z0-9._~-]{0,127})*$/;
const PUBLIC_QUOTATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

/** One-key CAS. Legacy arrays migrate to revision 1; cjson.null is valid empty state. */
const KV_CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local revision = 0
if current then
  local decoded = cjson.decode(current)
  if decoded ~= cjson.null and type(decoded) == 'table' and decoded._revision ~= nil then
    revision = tonumber(decoded._revision) or 0
  end
end
if tostring(revision) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function localUuid(value: unknown): string | null {
  const normalized = cleanText(value);
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

/** Internal admission fence counter: non-negative safe integer, default 0. */
function normalizeSequence(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function storeFailure(message: string, error: unknown): never {
  const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0);
  if (statusCode >= 400 && statusCode < 500) throw error;
  if (statusCode === 503) throw error;
  console.error('[whatsapp-conversations-store]', error instanceof Error ? error.name : typeof error);
  throw createHttpError(503, message);
}

function kvConfigured(): boolean {
  return isKvConfigured();
}

interface KvState<T> {
  revision: number;
  data: T[];
}

async function readKvState<T>(key: string, message: string): Promise<KvState<T>> {
  if (!kvConfigured()) throw createHttpError(503, message);
  try {
    const value = await kv.get<unknown>(key);
    if (value === null || value === undefined || value === 'null') return { revision: 0, data: [] };
    if (Array.isArray(value)) return { revision: 0, data: value as T[] };
    if (isRecord(value) && (Array.isArray(value.data) || value.data === null || value.data === 'null')) {
      const revision = Number(value._revision);
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid KV revision');
      return { revision, data: Array.isArray(value.data) ? value.data as T[] : [] };
    }
    throw new Error('invalid KV state');
  } catch (error) {
    return storeFailure(message, error);
  }
}

async function compareAndSetKv<T>(
  key: string,
  message: string,
  mutation: (current: T[]) => Promise<{ data: T[]; result: unknown }> | { data: T[]; result: unknown }
): Promise<unknown> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    const state = await readKvState<T>(key, message);
    const changed = await mutation(state.data);
    const payload = JSON.stringify({ _revision: state.revision + 1, data: changed.data });
    try {
      const result = await (kv as unknown as {
        eval: (script: string, keys: string[], args: string[]) => Promise<unknown>;
      }).eval(KV_CAS_SCRIPT, [key], [String(state.revision), payload]);
      if (Number(result) === 1) return changed.result;
    } catch (error) {
      return storeFailure(message, error);
    }
  }
  throw createHttpError(503, 'Armazenamento do WhatsApp ocupado. Tente novamente.');
}

async function liveReadConversations(): Promise<WhatsappConversation[]> {
  const state = await readKvState<WhatsappConversation>(
    KV_KEY_CONVERSATIONS,
    'Armazenamento de conversas não configurado.'
  );
  return state.data
    .map((item) => normalizeStoredConversation(item, LIVE_DEPS))
    .filter((item): item is WhatsappConversation => item !== null);
}

async function liveWriteConversations(conversations: WhatsappConversation[]): Promise<void> {
  await compareAndSetKv<WhatsappConversation>(
    KV_KEY_CONVERSATIONS,
    'Armazenamento de conversas não configurado.',
    (current) => {
      const sanitizedCurrent = current
        .map((item) => normalizeStoredConversation(item, LIVE_DEPS))
        .filter((item): item is WhatsappConversation => item !== null);
      const sanitizedIncoming = conversations
        .map((item) => normalizeStoredConversation(item, LIVE_DEPS))
        .filter((item): item is WhatsappConversation => item !== null);
      const byProvider = new Map(sanitizedCurrent.map((item) => [item.providerConversationId, item]));
      for (const incoming of sanitizedIncoming) {
        const previous = byProvider.get(incoming.providerConversationId);
        byProvider.set(
          incoming.providerConversationId,
          previous ? mergeConversation(previous, incoming, incoming.updatedAt) : incoming
        );
      }
      const data = [...byProvider.values()].sort(
        (a, b) => dateValue(b.lastMessageAt) - dateValue(a.lastMessageAt) || a.id.localeCompare(b.id)
      );
      return { data: data.slice(0, MAX_STORED_CONVERSATIONS), result: undefined };
    }
  );
}

async function liveReadMessages(conversationId: string): Promise<WhatsappMessage[]> {
  const state = await readKvState<WhatsappMessage>(
    `${KV_KEY_MESSAGES_PREFIX}${conversationId}`,
    'Armazenamento de mensagens não configurado.'
  );
  return state.data
    .map((item) => normalizeStoredMessage(item, conversationId, LIVE_DEPS))
    .filter((item): item is WhatsappMessage => item !== null)
    .slice(-MAX_STORED_MESSAGES_PER_CONVERSATION);
}

async function liveWriteMessages(
  conversationId: string,
  messages: WhatsappMessage[]
): Promise<void> {
  await compareAndSetKv<WhatsappMessage>(
    `${KV_KEY_MESSAGES_PREFIX}${conversationId}`,
    'Armazenamento de mensagens não configurado.',
    (current) => {
      const sanitizedCurrent = current
        .map((item) => normalizeStoredMessage(item, conversationId, LIVE_DEPS))
        .filter((item): item is WhatsappMessage => item !== null);
      const sanitizedIncoming = messages
        .map((item) => normalizeStoredMessage(item, conversationId, LIVE_DEPS))
        .filter((item): item is WhatsappMessage => item !== null);
      const byProvider = new Map(sanitizedCurrent.map((item) => [item.providerMessageId, item]));
      for (const incoming of sanitizedIncoming) {
        const previous = byProvider.get(incoming.providerMessageId);
        byProvider.set(
          incoming.providerMessageId,
          previous ? mergeMessage(previous, incoming) : incoming
        );
      }
      const data = [...byProvider.values()].sort(
        (a, b) => dateValue(a.timestamp) - dateValue(b.timestamp) || a.providerMessageId.localeCompare(b.providerMessageId)
      );
      return { data: data.slice(-MAX_STORED_MESSAGES_PER_CONVERSATION), result: undefined };
    }
  );
}

async function liveAtomicConversations<T>(mutation: ConversationMutation<T>): Promise<T> {
  return (await compareAndSetKv<WhatsappConversation>(
    KV_KEY_CONVERSATIONS,
    'Armazenamento de conversas não configurado.',
    async (current) => {
      const sanitized = current
        .map((item) => normalizeStoredConversation(item, LIVE_DEPS))
        .filter((item): item is WhatsappConversation => item !== null);
      const changed = await mutation(sanitized);
      return {
        data: changed.conversations.slice(0, MAX_STORED_CONVERSATIONS),
        result: changed.result,
      };
    }
  )) as T;
}

async function liveAtomicMessages<T>(
  conversationId: string,
  mutation: MessageMutation<T>
): Promise<T> {
  return (await compareAndSetKv<WhatsappMessage>(
    `${KV_KEY_MESSAGES_PREFIX}${conversationId}`,
    'Armazenamento de mensagens não configurado.',
    async (current) => {
      const sanitized = current
        .map((item) => normalizeStoredMessage(item, conversationId, LIVE_DEPS))
        .filter((item): item is WhatsappMessage => item !== null);
      const changed = await mutation(sanitized);
      return {
        data: changed.messages.slice(-MAX_STORED_MESSAGES_PER_CONVERSATION),
        result: changed.result,
      };
    }
  )) as T;
}

export const LIVE_DEPS: WhatsappConversationStoreDeps = {
  readConversations: liveReadConversations,
  writeConversations: liveWriteConversations,
  readMessages: liveReadMessages,
  writeMessages: liveWriteMessages,
  atomicUpdateConversations: liveAtomicConversations,
  atomicUpdateMessages: liveAtomicMessages,
  now: () => new Date().toISOString(),
  id: () => `wa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
};

const localLocks = new Map<string, Promise<void>>();

async function withLocalLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = localLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  localLocks.set(key, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (localLocks.get(key) === current) localLocks.delete(key);
  }
}

async function mutateConversations<T>(
  deps: WhatsappConversationStoreDeps,
  mutation: ConversationMutation<T>
): Promise<T> {
  const validatedMutation: ConversationMutation<T> = async (current) => {
    const changed = await mutation(current);
    if (deps.validateConversationMutation) {
      await deps.validateConversationMutation(current, changed.conversations);
    }
    return changed;
  };
  try {
    if (deps.atomicUpdateConversations) return await deps.atomicUpdateConversations(validatedMutation);
    return await withLocalLock('conversations', async () => {
      const current = await readConversations(deps);
      const changed = await validatedMutation(current);
      await deps.writeConversations(changed.conversations.slice(0, MAX_STORED_CONVERSATIONS));
      return changed.result;
    });
  } catch (error) {
    return storeFailure('Não foi possível salvar as conversas do WhatsApp.', error);
  }
}

async function mutateMessages<T>(
  conversationId: string,
  deps: WhatsappConversationStoreDeps,
  mutation: MessageMutation<T>
): Promise<T> {
  try {
    if (deps.atomicUpdateMessages) return await deps.atomicUpdateMessages(conversationId, mutation);
    return await withLocalLock(`messages:${conversationId}`, async () => {
      const current = await deps.readMessages(conversationId);
      const changed = await mutation(current);
      await deps.writeMessages(
        conversationId,
        changed.messages.slice(-MAX_STORED_MESSAGES_PER_CONVERSATION)
      );
      return changed.result;
    });
  } catch (error) {
    return storeFailure('Não foi possível salvar as mensagens do WhatsApp.', error);
  }
}

export function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeQuotationBusinessNumber(value: unknown): string | null {
  const normalized = cleanText(value).toUpperCase();
  return ORC_BUSINESS_NUMBER_PATTERN.test(normalized) ? normalized : null;
}

export interface WhatsappMediaValidationOptions {
  /** Absolute links are accepted only when they normalize to this origin. */
  applicationOrigin?: string;
}

function safeApplicationOrigin(value: unknown): string {
  try {
    const parsed = new URL(String(value || '').trim());
    if (
      !/^https?:$/.test(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

/**
 * Central attachment URL boundary.
 * Provider URLs and arbitrary Blob/API URLs intentionally fail closed here.
 */
export function sanitizeWhatsappMediaUrl(
  value: unknown,
  options: WhatsappMediaValidationOptions = {}
): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) return '';
  const raw = value;
  if (
    [...raw].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    }) ||
    raw.includes('\\\\') ||
    raw.startsWith('//') ||
    /^data:/i.test(raw) ||
    /^javascript:/i.test(raw)
  ) return '';

  if (LOCAL_MEDIA_PATH_PATTERN.test(raw)) return raw;

  const origin = safeApplicationOrigin(options.applicationOrigin);
  let parsed: URL;
  try {
    parsed = new URL(raw, origin || 'https://whatsapp-media.invalid');
  } catch {
    return '';
  }
  if (
    parsed.pathname !== '/api/public-quotation' ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    [...parsed.searchParams.keys()].some((key) => key !== 'token')
  ) return '';
  const token = parsed.searchParams.get('token') || '';
  if (!PUBLIC_QUOTATION_TOKEN_PATTERN.test(token)) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return `/api/public-quotation?token=${token}`;
  }
  if (!origin || parsed.origin !== origin) return '';
  return `/api/public-quotation?token=${token}`;
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

function normalizeLocalLink(value: unknown): string | null {
  const normalized = cleanText(value);
  return normalized ? localUuid(normalized) : null;
}

function normalizePatchLink(value: unknown, field: string): string | null {
  if (value === null || value === undefined || cleanText(value) === '') return null;
  const normalized = localUuid(value);
  if (!normalized) throw createHttpError(400, `${field} inválido.`);
  return normalized;
}

export function normalizeWhatsappConversationInput(
  input: Record<string, unknown>,
  deps: Pick<WhatsappConversationStoreDeps, 'now' | 'id'> = LIVE_DEPS
): WhatsappConversation {
  const now = deps.now();
  const providerId = cleanText(input.providerConversationId || input.remoteJid || input.id);
  const identity = resolveWhatsappIdentity({
    source: 'provider',
    chat: {
      remoteJid: providerId,
      phone: input.phone,
      senderPn: input.senderPn,
      participant: input.participant,
      from: input.from,
      sender: input.sender,
      pushName: input.pushName,
      displayName: input.displayName,
      displayLabel: input.displayLabel,
      name: input.name,
      nome: input.nome,
      notify: input.notify,
    },
  });
  const status = parseStatus(input.status);

  return {
    id: cleanText(input.id) || deps.id(),
    providerConversationId: identity.providerConversationId || providerId,
    remoteJid: identity.providerConversationId || providerId,
    canonicalPhone: identity.canonicalPhone,
    phone: identity.canonicalPhone,
    displayLabel: identity.displayLabel,
    displayName: identity.displayLabel,
    identityStatus: identity.identityStatus,
    identitySource: identity.identitySource,
    identityConfidence: identity.identityConfidence,
    lastMessageAt: normalizeIso(input.lastMessageAt || input.timestamp, now),
    lastMessagePreview: cleanText(input.lastMessagePreview || input.preview || ''),
    source: 'evolution',
    linkedLeadId: normalizeLocalLink(input.linkedLeadId),
    linkedDealId: normalizeLocalLink(input.linkedDealId),
    linkedQuotationId: normalizeLocalLink(input.linkedQuotationId),
    linkedCrmEntityId: normalizeLocalLink(input.linkedCrmEntityId),
    linkedCrmEntityType:
      input.linkedCrmEntityType === 'lead' || input.linkedCrmEntityType === 'cliente'
        ? input.linkedCrmEntityType
        : null,
    linkedCrmMatchSource:
      input.linkedCrmMatchSource === 'phone' ||
      input.linkedCrmMatchSource === 'email' ||
      input.linkedCrmMatchSource === 'name'
        ? input.linkedCrmMatchSource
        : null,
    admissionReservedSequence: normalizeSequence(input.admissionReservedSequence),
    admissionSelectedSequence: normalizeSequence(input.admissionSelectedSequence),
    status,
    createdAt: normalizeIso(input.createdAt, now),
    updatedAt: normalizeIso(input.updatedAt, now),
  };
}

function normalizeAttachment(
  input: unknown,
  deps: Pick<WhatsappConversationStoreDeps, 'id'>,
  direction: WhatsappMessageDirection
): WhatsappAttachment | null {
  if (!isRecord(input) || direction === 'inbound') return null;
  const kind = input.kind === 'document' || input.kind === 'audio' ? input.kind : 'image';
  const origin = input.origin === 'internal_generated' ? 'internal_generated' : 'provider';
  const mediaUrl = sanitizeWhatsappMediaUrl(input.mediaUrl || input.url, {
    applicationOrigin: typeof input.applicationOrigin === 'string' ? input.applicationOrigin : undefined,
  });
  if (!mediaUrl) return null;
  const documentRole =
    input.documentRole === 'quotation_pdf' || input.documentRole === 'generic_document'
      ? input.documentRole
      : null;
  if (origin === 'internal_generated' && (kind !== 'document' || documentRole !== 'quotation_pdf')) {
    return null;
  }
  const quotationId = normalizeLocalLink(input.quotationId);
  const quotationBusinessNumber = normalizeQuotationBusinessNumber(
    input.quotationBusinessNumber || (!quotationId ? input.quotationId : null)
  );
  if (origin === 'internal_generated' && !quotationId && !quotationBusinessNumber) return null;
  return {
    id: localUuid(input.id) || deps.id(),
    kind,
    mimeType: cleanText(input.mimeType || input.mimetype),
    fileName: cleanText(input.fileName || input.filename),
    mediaUrl,
    caption: cleanText(input.caption),
    origin,
    documentRole,
    quotationId,
    quotationBusinessNumber,
    leadId: normalizeLocalLink(input.leadId),
    customerId: normalizeLocalLink(input.customerId),
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
  const mediaUrl =
    direction === 'inbound'
      ? ''
      : sanitizeWhatsappMediaUrl(input.mediaUrl || input.url, {
          applicationOrigin: typeof input.applicationOrigin === 'string' ? input.applicationOrigin : undefined,
        });
  const providedAttachments = Array.isArray(input.attachments)
    ? input.attachments
        .map((attachment) => normalizeAttachment(attachment, deps, direction))
        .filter(Boolean)
    : [];
  const attachments = [...providedAttachments] as WhatsappAttachment[];
  if (direction === 'outbound' && attachments.length === 0 && mediaUrl) {
    attachments.push({
      id: deps.id(),
      kind: type !== 'text' && type !== 'unknown' ? type : 'image',
      mimeType: cleanText(input.mimeType || input.mimetype),
      fileName: cleanText(input.fileName || input.filename),
      mediaUrl,
      caption: cleanText(input.body || input.text || input.caption || ''),
      origin: 'provider',
      documentRole: null,
      quotationId: null,
      quotationBusinessNumber: null,
      leadId: null,
      customerId: null,
    });
  }

  return {
    id: cleanText(input.id) || deps.id(),
    conversationId: cleanText(input.conversationId),
    providerMessageId:
      cleanText(input.providerMessageId || input.key || input.messageId) || deps.id(),
    direction,
    type,
    body: cleanText(input.body || input.text || input.caption || ''),
    mediaUrl,
    attachments: attachments.length > 0 ? attachments : undefined,
    timestamp: normalizeIso(input.timestamp || input.messageTimestamp, now),
  };
}

export interface WhatsappPublicAttachment {
  id: string;
  kind: WhatsappAttachment['kind'];
  mimeType: string;
  fileName: string;
  mediaUrl: string;
  caption: string;
  origin: WhatsappAttachment['origin'];
  documentRole: WhatsappAttachment['documentRole'];
  quotationId: string | null;
  quotationBusinessNumber: string | null;
  leadId: string | null;
  customerId: string | null;
}

export interface WhatsappPublicMessage {
  id: string;
  conversationId: string;
  direction: WhatsappMessageDirection;
  type: WhatsappMessageType;
  body: string;
  mediaUrl: string;
  attachments?: WhatsappPublicAttachment[];
  timestamp: string;
}

export interface WhatsappPublicConversation {
  id: string;
  canonicalPhone: string;
  phone: string;
  displayLabel: string;
  displayName: string;
  identityStatus: WhatsappConversation['identityStatus'];
  lastMessageAt: string;
  lastMessagePreview: string;
  linkedLeadId: string | null;
  linkedDealId: string | null;
  linkedQuotationId: string | null;
  status: WhatsappConversationStatus;
  createdAt: string;
  updatedAt: string;
}

export function projectWhatsappAttachment(
  value: unknown,
  options: WhatsappMediaValidationOptions = {}
): WhatsappPublicAttachment | null {
  if (!isRecord(value)) return null;
  const mediaUrl = sanitizeWhatsappMediaUrl(value.mediaUrl, options);
  if (!mediaUrl) return null;
  const origin = value.origin === 'internal_generated' ? 'internal_generated' : 'provider';
  const kind = value.kind === 'document' || value.kind === 'audio' ? value.kind : 'image';
  const documentRole =
    value.documentRole === 'quotation_pdf' || value.documentRole === 'generic_document'
      ? value.documentRole
      : null;
  const quotationId = normalizeLocalLink(value.quotationId);
  const quotationBusinessNumber = normalizeQuotationBusinessNumber(
    value.quotationBusinessNumber || (!quotationId ? value.quotationId : null)
  );
  if (
    origin === 'internal_generated' &&
    (kind !== 'document' || documentRole !== 'quotation_pdf' || (!quotationId && !quotationBusinessNumber))
  ) return null;
  return {
    id: cleanText(value.id),
    kind,
    mimeType: cleanText(value.mimeType),
    fileName: cleanText(value.fileName),
    mediaUrl,
    caption: cleanText(value.caption),
    origin,
    documentRole,
    quotationId,
    quotationBusinessNumber,
    leadId: normalizeLocalLink(value.leadId),
    customerId: normalizeLocalLink(value.customerId),
  };
}

export function projectWhatsappMessage(
  value: unknown,
  options: WhatsappMediaValidationOptions = {}
): WhatsappPublicMessage | null {
  if (!isRecord(value)) return null;
  const direction: WhatsappMessageDirection = value.direction === 'outbound' ? 'outbound' : 'inbound';
  const attachments = direction === 'outbound' && Array.isArray(value.attachments)
    ? value.attachments
        .map((attachment) => projectWhatsappAttachment(attachment, options))
        .filter((attachment): attachment is WhatsappPublicAttachment => attachment !== null)
    : [];
  const mediaUrl = direction === 'outbound' ? sanitizeWhatsappMediaUrl(value.mediaUrl, options) : '';
  return {
    id: cleanText(value.id),
    conversationId: cleanText(value.conversationId),
    direction,
    type: ['text', 'image', 'document', 'audio'].includes(String(value.type))
      ? (value.type as WhatsappMessageType)
      : 'unknown',
    body: cleanText(value.body),
    mediaUrl,
    ...(attachments.length ? { attachments } : {}),
    timestamp: normalizeIso(value.timestamp, new Date(0).toISOString()),
  };
}

export function projectWhatsappConversation(value: unknown): WhatsappPublicConversation | null {
  if (!isRecord(value)) return null;
  return {
    id: cleanText(value.id),
    canonicalPhone: cleanText(value.canonicalPhone),
    phone: cleanText(value.phone),
    displayLabel: cleanText(value.displayLabel),
    displayName: cleanText(value.displayName),
    identityStatus:
      value.identityStatus === 'verified' || value.identityStatus === 'derived' ||
      value.identityStatus === 'conflict'
        ? value.identityStatus
        : 'unresolved',
    lastMessageAt: normalizeIso(value.lastMessageAt, new Date(0).toISOString()),
    lastMessagePreview: cleanText(value.lastMessagePreview),
    linkedLeadId: normalizeLocalLink(value.linkedLeadId),
    linkedDealId: normalizeLocalLink(value.linkedDealId),
    linkedQuotationId: normalizeLocalLink(value.linkedQuotationId),
    status: parseStatus(value.status),
    createdAt: normalizeIso(value.createdAt, new Date(0).toISOString()),
    updatedAt: normalizeIso(value.updatedAt, new Date(0).toISOString()),
  };
}

function dateValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeConversation(current: WhatsappConversation, normalized: WhatsappConversation, now: string): WhatsappConversation {
  const incomingIsNewer = dateValue(normalized.lastMessageAt) >= dateValue(current.lastMessageAt);
  const canonicalPhone =
    normalized.canonicalPhone ||
    (normalized.identityStatus === 'unresolved' && current.identityStatus !== 'verified'
      ? ''
      : current.canonicalPhone || '');
  const identityStatus =
    normalized.identityStatus !== 'unresolved' ? normalized.identityStatus : current.identityStatus;
  return {
    id: current.id,
    providerConversationId: current.providerConversationId || normalized.providerConversationId,
    remoteJid: current.remoteJid || normalized.remoteJid,
    canonicalPhone,
    phone:
      normalized.phone ||
      (normalized.identityStatus === 'unresolved' && current.identityStatus !== 'verified'
        ? ''
        : current.phone || canonicalPhone),
    displayLabel: normalized.displayLabel || current.displayLabel || '',
    displayName: normalized.displayName || current.displayName || '',
    identityStatus,
    identitySource: normalized.identitySource || current.identitySource || null,
    identityConfidence: normalized.identityConfidence || current.identityConfidence || null,
    lastMessageAt: incomingIsNewer ? normalized.lastMessageAt : current.lastMessageAt,
    lastMessagePreview: incomingIsNewer
      ? normalized.lastMessagePreview || current.lastMessagePreview
      : current.lastMessagePreview,
    source: 'evolution',
    linkedLeadId: normalized.linkedLeadId || current.linkedLeadId || null,
    linkedDealId: normalized.linkedDealId || current.linkedDealId || null,
    linkedQuotationId: normalized.linkedQuotationId || current.linkedQuotationId || null,
    linkedCrmEntityId: normalized.linkedCrmEntityId || current.linkedCrmEntityId || null,
    linkedCrmEntityType: normalized.linkedCrmEntityType || current.linkedCrmEntityType || null,
    linkedCrmMatchSource: normalized.linkedCrmMatchSource || current.linkedCrmMatchSource || null,
    // The admission fence is authoritative conversation state; a provider sync
    // must never reset it by omitting the internal counters.
    admissionReservedSequence: normalizeSequence(current.admissionReservedSequence),
    admissionSelectedSequence: normalizeSequence(current.admissionSelectedSequence),
    status: normalized.status === 'new' ? current.status : normalized.status,
    createdAt: current.createdAt,
    updatedAt: now,
  };
}

export async function upsertWhatsappConversation(
  input: Record<string, unknown>,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappConversation> {
  const normalized = normalizeWhatsappConversationInput(input, deps);
  return mutateConversations(deps, async (current) => {
    const index = current.findIndex(
      (item) => item.providerConversationId === normalized.providerConversationId
    );
    if (index < 0) {
      const next = [...current, normalized];
      next.sort((a, b) => dateValue(b.lastMessageAt) - dateValue(a.lastMessageAt) || a.id.localeCompare(b.id));
      return { conversations: next, result: normalized };
    }
    const saved = mergeConversation(current[index], normalized, deps.now());
    const next = [...current];
    next[index] = saved;
    next.sort((a, b) => dateValue(b.lastMessageAt) - dateValue(a.lastMessageAt) || a.id.localeCompare(b.id));
    return { conversations: next, result: saved };
  });
}

function stableMessageKey(message: WhatsappMessage): string {
  return [
    message.direction,
    message.type,
    message.body,
    message.mediaUrl,
    JSON.stringify(message.attachments || []),
    message.id,
  ].join('|');
}

function mergeMessage(current: WhatsappMessage, incoming: WhatsappMessage): WhatsappMessage {
  const currentTimestamp = dateValue(current.timestamp);
  const incomingTimestamp = dateValue(incoming.timestamp);
  if (incomingTimestamp > currentTimestamp) return incoming;
  if (incomingTimestamp < currentTimestamp) return current;
  return stableMessageKey(incoming).localeCompare(stableMessageKey(current)) > 0
    ? incoming
    : current;
}

export async function upsertWhatsappMessages(
  conversationId: string,
  inputs: Array<Record<string, unknown>>,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappMessage[]> {
  return mutateMessages(conversationId, deps, async (current) => {
    const byProviderId = new Map(current.map((message) => [message.providerMessageId, message]));
    for (const input of inputs) {
      const normalized = normalizeWhatsappMessageInput(
        {
          id: input.id,
          conversationId,
          providerMessageId: input.providerMessageId,
          direction: input.direction,
          fromMe: input.fromMe,
          type: input.type,
          body: input.body,
          text: input.text,
          caption: input.caption,
          mediaUrl: input.mediaUrl,
          url: input.url,
          mimeType: input.mimeType,
          mimetype: input.mimetype,
          fileName: input.fileName,
          filename: input.filename,
          attachments: input.attachments,
          timestamp: input.timestamp,
          messageTimestamp: input.messageTimestamp,
          key: input.key,
        },
        deps
      );
      const previous = byProviderId.get(normalized.providerMessageId);
      byProviderId.set(
        normalized.providerMessageId,
        previous ? mergeMessage(previous, normalized) : normalized
      );
    }
    const next = Array.from(byProviderId.values()).sort(
      (a, b) => dateValue(a.timestamp) - dateValue(b.timestamp) || a.providerMessageId.localeCompare(b.providerMessageId)
    );
    return { messages: next, result: next.slice(-MAX_STORED_MESSAGES_PER_CONVERSATION) };
  });
}

function sanitizeConversationPhone(item: WhatsappConversation): WhatsappConversation {
  const clearPhone =
    item.identityStatus === 'unresolved' &&
    item.providerConversationId.includes('@lid') &&
    item.canonicalPhone &&
    !item.canonicalPhone.startsWith('55');
  return {
    id: item.id,
    providerConversationId: item.providerConversationId,
    remoteJid: item.remoteJid,
    canonicalPhone: clearPhone ? '' : item.canonicalPhone,
    phone: clearPhone ? '' : item.phone,
    displayLabel: item.displayLabel,
    displayName: item.displayName,
    identityStatus: item.identityStatus,
    identitySource: item.identitySource,
    identityConfidence: item.identityConfidence,
    lastMessageAt: item.lastMessageAt,
    lastMessagePreview: item.lastMessagePreview,
    source: 'evolution',
    linkedLeadId: item.linkedLeadId || null,
    linkedDealId: item.linkedDealId || null,
    linkedQuotationId: item.linkedQuotationId || null,
    linkedCrmEntityId: item.linkedCrmEntityId || null,
    linkedCrmEntityType: item.linkedCrmEntityType || null,
    linkedCrmMatchSource: item.linkedCrmMatchSource || null,
    admissionReservedSequence: normalizeSequence(item.admissionReservedSequence),
    admissionSelectedSequence: normalizeSequence(item.admissionSelectedSequence),
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeStoredConversation(
  value: unknown,
  deps: Pick<WhatsappConversationStoreDeps, 'now' | 'id'>
): WhatsappConversation | null {
  if (!isRecord(value)) return null;
  const now = deps.now();
  const providerConversationId = cleanText(value.providerConversationId || value.remoteJid || value.id);
  const id = cleanText(value.id) || deps.id();
  if (!providerConversationId || !id) return null;
  const identityStatus =
    value.identityStatus === 'verified' || value.identityStatus === 'derived' ||
    value.identityStatus === 'conflict'
      ? value.identityStatus
      : 'unresolved';
  return {
    id,
    providerConversationId,
    remoteJid: providerConversationId,
    canonicalPhone: cleanText(value.canonicalPhone),
    phone: cleanText(value.phone || value.canonicalPhone),
    displayLabel: cleanText(value.displayLabel || value.displayName),
    displayName: cleanText(value.displayName || value.displayLabel),
    identityStatus,
    identitySource: cleanText(value.identitySource) || null,
    identityConfidence:
      value.identityConfidence === 'high' || value.identityConfidence === 'medium' || value.identityConfidence === 'low'
        ? value.identityConfidence
        : null,
    lastMessageAt: normalizeIso(value.lastMessageAt || value.timestamp, now),
    lastMessagePreview: cleanText(value.lastMessagePreview || value.preview),
    source: 'evolution',
    linkedLeadId: normalizeLocalLink(value.linkedLeadId),
    linkedDealId: normalizeLocalLink(value.linkedDealId),
    linkedQuotationId: normalizeLocalLink(value.linkedQuotationId),
    linkedCrmEntityId: normalizeLocalLink(value.linkedCrmEntityId),
    linkedCrmEntityType: value.linkedCrmEntityType === 'lead' || value.linkedCrmEntityType === 'cliente' ? value.linkedCrmEntityType : null,
    linkedCrmMatchSource: value.linkedCrmMatchSource === 'phone' || value.linkedCrmMatchSource === 'email' || value.linkedCrmMatchSource === 'name' ? value.linkedCrmMatchSource : null,
    admissionReservedSequence: normalizeSequence(value.admissionReservedSequence),
    admissionSelectedSequence: normalizeSequence(value.admissionSelectedSequence),
    status: parseStatus(value.status),
    createdAt: normalizeIso(value.createdAt, now),
    updatedAt: normalizeIso(value.updatedAt, now),
  };
}

function normalizeStoredMessage(
  value: unknown,
  conversationId: string,
  deps: Pick<WhatsappConversationStoreDeps, 'now' | 'id'>
): WhatsappMessage | null {
  if (!isRecord(value)) return null;
  try {
    return normalizeWhatsappMessageInput(
      {
        id: value.id,
        conversationId,
        providerMessageId: value.providerMessageId,
        direction: value.direction,
        type: value.type,
        body: value.body,
        mediaUrl: value.mediaUrl,
        attachments: value.attachments,
        timestamp: value.timestamp,
        fromMe: value.fromMe,
        messageTimestamp: value.messageTimestamp,
      },
      deps
    );
  } catch {
    return null;
  }
}

async function readConversations(deps: WhatsappConversationStoreDeps): Promise<WhatsappConversation[]> {
  try {
    const value = await deps.readConversations();
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => normalizeStoredConversation(item, deps))
      .filter((item): item is WhatsappConversation => item !== null);
  } catch (error) {
    return storeFailure('Não foi possível acessar as conversas do WhatsApp.', error);
  }
}

async function readMessages(
  conversationId: string,
  deps: WhatsappConversationStoreDeps
): Promise<WhatsappMessage[]> {
  try {
    const value = await deps.readMessages(conversationId);
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => normalizeStoredMessage(item, conversationId, deps))
      .filter((item): item is WhatsappMessage => item !== null)
      .slice(-MAX_STORED_MESSAGES_PER_CONVERSATION);
  } catch (error) {
    return storeFailure('Não foi possível acessar as mensagens do WhatsApp.', error);
  }
}

export async function listWhatsappConversations(
  filters: WhatsappConversationFilters = {},
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappConversation[]> {
  try {
    const q = cleanText(filters.q).toLowerCase();
    const status = filters.status || 'all';
    const limit = parseLimit(filters.limit);
    const hasQuoteRequest = filters.hasQuoteRequest === true || filters.hasQuoteRequest === 'true';
    return (await readConversations(deps))
      .filter((item) => status === 'all' || item.status === status)
      .filter((item) => !hasQuoteRequest || item.status === 'needs_quote')
      .filter((item) => {
        if (!q) return true;
        return [item.displayLabel, item.canonicalPhone, item.phone, item.lastMessagePreview].some(
          (value) => value.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => dateValue(b.lastMessageAt) - dateValue(a.lastMessageAt) || a.id.localeCompare(b.id))
      .map(sanitizeConversationPhone)
      .slice(0, limit);
  } catch (error) {
    return storeFailure('Não foi possível acessar as conversas do WhatsApp.', error);
  }
}

export async function getWhatsappConversation(
  id: string,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappConversation> {
  const conversation = (await readConversations(deps)).find((item) => item.id === id);
  if (!conversation) throw createHttpError(404, 'Conversa do WhatsApp não encontrada.');
  return sanitizeConversationPhone(conversation);
}

export async function getWhatsappMessages(
  conversationId: string,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappMessage[]> {
  await getWhatsappConversation(conversationId, deps);
  return readMessages(conversationId, deps);
}

export async function updateWhatsappConversation(
  id: string,
  patch: Partial<WhatsappConversation>,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappConversation> {
  return mutateConversations(deps, async (current) => {
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) throw createHttpError(404, 'Conversa do WhatsApp não encontrada.');
    const currentConversation = current[index];
    const saved: WhatsappConversation = {
      id: currentConversation.id,
      providerConversationId: currentConversation.providerConversationId,
      remoteJid: currentConversation.remoteJid,
      canonicalPhone: currentConversation.canonicalPhone,
      phone: currentConversation.phone,
      displayLabel: currentConversation.displayLabel,
      displayName: currentConversation.displayName,
      identityStatus: currentConversation.identityStatus,
      identitySource: currentConversation.identitySource,
      identityConfidence: currentConversation.identityConfidence,
      lastMessageAt: currentConversation.lastMessageAt,
      lastMessagePreview: currentConversation.lastMessagePreview,
      source: 'evolution',
      linkedLeadId: patch.linkedLeadId === undefined ? currentConversation.linkedLeadId || null : normalizePatchLink(patch.linkedLeadId, 'linkedLeadId'),
      linkedDealId: patch.linkedDealId === undefined ? currentConversation.linkedDealId || null : normalizePatchLink(patch.linkedDealId, 'linkedDealId'),
      linkedQuotationId: patch.linkedQuotationId === undefined ? currentConversation.linkedQuotationId || null : normalizePatchLink(patch.linkedQuotationId, 'linkedQuotationId'),
      linkedCrmEntityId: patch.linkedCrmEntityId === undefined ? currentConversation.linkedCrmEntityId || null : normalizePatchLink(patch.linkedCrmEntityId, 'linkedCrmEntityId'),
      linkedCrmEntityType: patch.linkedCrmEntityType === undefined ? currentConversation.linkedCrmEntityType || null : patch.linkedCrmEntityType || null,
      linkedCrmMatchSource: patch.linkedCrmMatchSource === undefined ? currentConversation.linkedCrmMatchSource || null : patch.linkedCrmMatchSource || null,
      admissionReservedSequence: normalizeSequence(currentConversation.admissionReservedSequence),
      admissionSelectedSequence: normalizeSequence(currentConversation.admissionSelectedSequence),
      status: patch.status === undefined ? currentConversation.status : parseStatus(patch.status),
      createdAt: currentConversation.createdAt,
      updatedAt: deps.now(),
    };
    const next = [...current];
    next[index] = saved;
    return { conversations: next, result: saved };
  });
}

/**
 * Reserves a monotonic admission sequence on a conversation before a new
 * admission touches anything else. The reservation is persisted in the
 * conversation mutation state, so it reflects the order in which concurrent
 * admissions started rather than the order in which they finish.
 */
export async function beginWhatsappConversationAdmission(
  id: string,
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<number> {
  return mutateConversations(deps, async (current) => {
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) throw createHttpError(404, 'Conversa do WhatsApp não encontrada.');
    const currentConversation = current[index];
    const reserved = normalizeSequence(currentConversation.admissionReservedSequence) + 1;
    const saved: WhatsappConversation = {
      ...currentConversation,
      admissionReservedSequence: reserved,
      updatedAt: deps.now(),
    };
    const next = [...current];
    next[index] = saved;
    return { conversations: next, result: reserved };
  });
}

/**
 * Writes the CRM selection of a new admission only when its reserved sequence
 * is not older than the last selection written. A newer admission that already
 * saved wins; a stale admission that completes later leaves it intact. The
 * comparison runs inside the CAS mutation, so it is decided against the latest
 * conversation state, never against a read that could be overwritten.
 */
export async function completeWhatsappConversationAdmission(
  id: string,
  sequence: number,
  links: { linkedLeadId: string; linkedDealId: string | null },
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappConversation> {
  return mutateConversations(deps, async (current) => {
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) throw createHttpError(404, 'Conversa do WhatsApp não encontrada.');
    const currentConversation = current[index];
    const normalizedSequence = normalizeSequence(sequence);
    const selected = normalizeSequence(currentConversation.admissionSelectedSequence);
    if (normalizedSequence < selected) {
      // A newer admission already saved a different selection; leave it intact.
      return { conversations: [...current], result: currentConversation };
    }
    const saved: WhatsappConversation = {
      ...currentConversation,
      linkedLeadId: normalizePatchLink(links.linkedLeadId, 'linkedLeadId'),
      linkedDealId: normalizePatchLink(links.linkedDealId, 'linkedDealId'),
      status: 'quote_lead_created',
      admissionSelectedSequence: normalizedSequence,
      updatedAt: deps.now(),
    };
    const next = [...current];
    next[index] = saved;
    return { conversations: next, result: saved };
  });
}

/**
 * Completes the CRM links of a retried admission without ever replacing a
 * newer saved selection. A later explicit demand in the same conversation may
 * already own a different lead/deal; retrying the older admission must only
 * fill links that are missing or already point at the same admission. The
 * decision is evaluated inside the CAS mutation, so a concurrent writer that
 * saves a newer selection between reads cannot be overwritten.
 */
export async function linkWhatsappConversationAdmission(
  id: string,
  links: { linkedLeadId: string; linkedDealId: string | null },
  deps: WhatsappConversationStoreDeps = LIVE_DEPS
): Promise<WhatsappConversation> {
  return mutateConversations(deps, async (current) => {
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) throw createHttpError(404, 'Conversa do WhatsApp não encontrada.');
    const currentConversation = current[index];
    const sameLead =
      !currentConversation.linkedLeadId || currentConversation.linkedLeadId === links.linkedLeadId;
    const sameDeal =
      !currentConversation.linkedDealId || currentConversation.linkedDealId === links.linkedDealId;
    if (!sameLead || !sameDeal) {
      // A newer admission already saved a different selection; leave it intact.
      return { conversations: [...current], result: currentConversation };
    }
    const saved: WhatsappConversation = {
      ...currentConversation,
      linkedLeadId: normalizePatchLink(links.linkedLeadId, 'linkedLeadId'),
      linkedDealId: normalizePatchLink(links.linkedDealId, 'linkedDealId'),
      status: 'quote_lead_created',
      updatedAt: deps.now(),
    };
    const next = [...current];
    next[index] = saved;
    return { conversations: next, result: saved };
  });
}

export type { ConversationMutation, MessageMutation };