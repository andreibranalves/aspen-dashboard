// GET /api/whatsapp-leads - recent verified WhatsApp conversation snapshots.
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_lib/types.js';
import {
  getWhatsappMessages,
  listWhatsappConversations,
  LIVE_DEPS,
  type WhatsappConversation,
  type WhatsappConversationStoreDeps,
} from './lib/whatsapp-conversations-store.js';
import {
  syncWhatsappConversations,
  type EvolutionSyncDeps,
  type WhatsappSyncOptions,
} from './lib/whatsapp-conversations-sync.js';
import {
  createPostgresWhatsappCrmRepository,
  resolveWhatsappCrmCandidateFromSnapshot,
  type LocalCrmCandidate,
  type LocalClientRecord,
  type LocalDealRecord,
  type LocalQuoteLeadRecord,
  type LocalQuotationRecord,
  type LocalWhatsappCrmRepository,
} from './lib/whatsapp-crm-match.js';

// Keep the read-side scan small: one request can still trigger one extraction/CRM read per chat.
const MAX_CHATS_TO_SCAN = 20;
const MAX_EXTRACTION_CONCURRENCY = 4;
const MAX_MESSAGES_PER_CHAT = 50;
const MAX_LEADS = 5;
const MAX_MESSAGE_TEXT = 2_000;
const MAX_CONVERSATION_TEXT = 6_000;
const MAX_SUMMARY_TEXT = 2_000;
const MAX_EMAIL_LENGTH = 254;
const MAX_EXTRACTION_RESPONSE = 256 * 1024;
const OPENROUTER_TIMEOUT_MS = 15_000;
const BODY_CANCEL_TIMEOUT_MS = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORC_BUSINESS_NUMBER_PATTERN = /^ORC-[0-9]{8}$/;
const EMAIL_PATTERN = /[A-Z0-9!#$%&'*+/?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/?^_`{|}~-]+)*@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)*\.[A-Z]{2,63}/gi;
const SNAPSHOT_PHONE_FORMAT = /^(?:\+?[0-9]|\([0-9]{2}\))[0-9 .()-]*$/;

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash';

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function cleanText(value: unknown, maxLength = MAX_MESSAGE_TEXT): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const head = Math.ceil(maxLength / 2);
  return `${normalized.slice(0, head)} … ${normalized.slice(-Math.floor(maxLength / 2))}`;
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function hasEmailControlChars(value: string, allowTextWhitespace: boolean): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (allowTextWhitespace && (code === 9 || code === 10 || code === 13)) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function normalizeEmailMatch(value: string): string {
  if (value.length > MAX_EMAIL_LENGTH || hasEmailControlChars(value, false)) return '';
  const normalized = value.trim().toLowerCase();
  EMAIL_PATTERN.lastIndex = 0;
  const match = EMAIL_PATTERN.exec(normalized)?.[0] || '';
  return match.length <= MAX_EMAIL_LENGTH ? match : '';
}

function extractEmailFromText(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_CONVERSATION_TEXT || hasEmailControlChars(value, true)) return '';
  EMAIL_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(EMAIL_PATTERN)) {
    const normalized = normalizeEmailMatch(match[0]);
    if (normalized) return normalized;
  }
  return '';
}

function isFormattedBrazilPhone(value: string): boolean {
  if (!SNAPSHOT_PHONE_FORMAT.test(value)) return false;
  const open = value.indexOf('(');
  const close = value.indexOf(')');
  if (open < 0) return close < 0;
  if (close < 0 || value.indexOf('(', open + 1) >= 0 || value.indexOf(')', close + 1) >= 0) return false;
  const prefix = value.slice(0, open).replace(/[ .-]/g, '');
  return /^(?:\+?55)?$/.test(prefix) && /^\d{2}$/.test(value.slice(open + 1, close));
}

function normalizeBrazilPhone(value: unknown): string {
  if (typeof value !== 'string' || hasEmailControlChars(value, false)) return '';
  const raw = value.trim();
  if (!raw || !isFormattedBrazilPhone(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.length === 12 || digits.length === 13 ? (digits.startsWith('55') ? digits : '') : '';
}

export function normalizeWhatsappPhone(value: unknown): string {
  return normalizeBrazilPhone(value);
}

function normalizeSnapshotPhone(value: unknown): string {
  return normalizeBrazilPhone(value);
}

function normalizeComparablePhone(value: unknown): string {
  const digits = normalizeSnapshotPhone(value);
  return digits.length === 12 || digits.length === 13
    ? digits.slice(2).replace(/^0+/, '')
    : '';
}

function isValidBrazilWhatsappPhone(value: unknown): boolean {
  const comparable = normalizeComparablePhone(value);
  return comparable.length === 10 || comparable.length === 11;
}

export function normalizeLeadEmail(value: unknown): string {
  return typeof value === 'string' ? normalizeEmailMatch(value) : '';
}

function isPlaceholderLeadName(value: unknown): boolean {
  const normalized = cleanText(value, 200).toLowerCase();
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

function timestampValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'string') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeInboundMessages(value: unknown): Array<{ body: string; timestamp: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message): message is Record<string, unknown> => {
      return typeof message === 'object' && message !== null && !Array.isArray(message);
    })
    .filter((message) => message.direction === 'inbound')
    .map((message) => ({
      body: cleanText(message.body, MAX_MESSAGE_TEXT),
      timestamp: timestampValue(message.timestamp),
    }))
    .filter((message) => message.body)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_MESSAGES_PER_CHAT);
}

function composeInboundText(messages: Array<{ body: string; timestamp: number }>): string {
  return messages
    .slice(-MAX_MESSAGES_PER_CHAT)
    .map((message) => `Cliente: ${message.body}`)
    .join('\n')
    .slice(-MAX_CONVERSATION_TEXT);
}

function summaryFromMessages(messages: Array<{ body: string; timestamp: number }>): string {
  return messages
    .slice(-2)
    .map((message) => message.body)
    .join(' · ')
    .slice(0, MAX_SUMMARY_TEXT);
}

function extractFallback(conversationText: string): Record<string, unknown> {
  const email = extractEmailFromText(conversationText);
  return {
    email,
    resumo: conversationText.slice(-MAX_SUMMARY_TEXT),
    produto: '',
    quantidade: '',
  };
}

function projectedExtraction(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    nome: cleanText(record.nome, 200),
    email: normalizeLeadEmail(record.email) || normalizeLeadEmail(fallback.email),
    telefone: cleanText(record.telefone, 32).replace(/\D/g, '').slice(0, 15),
    resumo: cleanText(record.resumo || record.pedidoTexto || record.pedido, MAX_SUMMARY_TEXT),
    produto: cleanText(record.produto, 200),
    quantidade: cleanText(record.quantidade || record.qtd, 80),
  };
}

async function readResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  if (signal.aborted) throw new Error('response aborted');
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(new Error('response aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function cancelWithDeadline(operation: () => unknown): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancellation = Promise.resolve()
    .then(operation)
    .catch(() => undefined);
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, BODY_CANCEL_TIMEOUT_MS);
  });
  await Promise.race([cancellation, deadline]);
  if (timer !== undefined) clearTimeout(timer);
}

async function cancelResponseReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  if (typeof reader.cancel !== 'function') return;
  await cancelWithDeadline(() => reader.cancel());
}

async function cancelResponseBody(response: Response): Promise<void> {
  const body = response.body as (ReadableStream<Uint8Array> & { cancel?: () => unknown }) | null;
  if (!body) return;
  if (typeof body.cancel === 'function') {
    await cancelWithDeadline(() => body.cancel());
    return;
  }
  if (typeof body.getReader !== 'function') return;
  try {
    await cancelResponseReader(body.getReader());
  } catch {
    // Preserve the original response failure.
  }
}

export async function readResponseJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error('response body unavailable');
  if (typeof response.body.getReader !== 'function') {
    await cancelResponseBody(response);
    throw new Error('response body unavailable');
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    await cancelResponseBody(response);
    throw new Error('response body unavailable');
  }
  const declaredLength = response.headers?.get?.('content-length') ?? null;
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/.test(normalizedLength) || Number(normalizedLength) > MAX_EXTRACTION_RESPONSE) {
      await cancelResponseReader(reader);
      throw new Error('response too large');
    }
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let parsed = false;
  try {
    while (true) {
      const next = await readResponseChunk(reader, signal);
      if (next.done) break;
      if (!next.value || !Number.isSafeInteger(next.value.byteLength)) {
        throw new Error('invalid response chunk');
      }
      total += next.value.byteLength;
      if (total > MAX_EXTRACTION_RESPONSE) throw new Error('response too large');
      chunks.push(next.value);
    }
    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    try {
      const value = JSON.parse(text);
      parsed = true;
      return value;
    } catch {
      throw new Error('invalid response JSON');
    }
  } finally {
    if (!parsed) await cancelResponseReader(reader);
  }
}

export interface OpenRouterRequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function requestOpenRouter(
  payload: Record<string, unknown>,
  options: OpenRouterRequestOptions = {},
): Promise<unknown> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || '';
  if (!apiKey) return null;
  const controller = new AbortController();
  const fetchImpl = options.fetchImpl || fetch;
  const configuredTimeout = Number(options.timeoutMs ?? OPENROUTER_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(1, configuredTimeout) : OPENROUTER_TIMEOUT_MS;
  let timedOut = false;
  let completed = false;
  let rejectTimeout: ((reason?: unknown) => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectTimeout?.(new Error('OpenRouter timeout'));
  }, timeoutMs);
  try {
    const fetchPromise = Promise.resolve().then(() => fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-OpenRouter-Title': 'Aspen Orcamento WhatsApp Leads',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }));
    void fetchPromise.then(
      (response) => timedOut ? cancelResponseBody(response) : undefined,
      () => undefined,
    ).catch(() => undefined);
    const response = await Promise.race([fetchPromise, timeout]);
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error('OpenRouter request failed');
    }
    const contentType = response.headers?.get?.('content-type') || '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      await cancelResponseBody(response);
      throw new Error('OpenRouter response MIME invalid');
    }
    const data = await Promise.race([readResponseJson(response, controller.signal), timeout]);
    completed = true;
    return data;
  } finally {
    clearTimeout(timer);
    if (!completed) controller.abort();
  }
}

async function extractLeadWithOpenRouter(
  conversationText: string,
  _messages: Array<{ body: string; timestamp: number }>
): Promise<Record<string, unknown>> {
  const fallback = extractFallback(conversationText);
  if (!conversationText.trim()) return fallback;
  try {
    const data = await requestOpenRouter({
      model: OPENROUTER_MODEL,
      messages: [{
        role: 'user',
        content: [
          'Extraia somente dados do cliente a partir das mensagens recebidas abaixo.',
          'Não invente dados e retorne apenas JSON válido.',
          '{"email":"","resumo":"","produto":"","quantidade":""}',
          `Mensagens recebidas:\n${conversationText}`,
        ].join('\n'),
      }],
      temperature: 0,
    });
    const content = (data as Record<string, unknown> | null)?.choices;
    const firstChoice = Array.isArray(content) ? content[0] : null;
    const message = firstChoice && typeof firstChoice === 'object'
      ? (firstChoice as Record<string, unknown>).message
      : null;
    const raw = message && typeof message === 'object'
      ? (message as Record<string, unknown>).content
      : null;
    const parsed = JSON.parse(String(raw || '{}').replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    return projectedExtraction(parsed, fallback);
  } catch {
    return fallback;
  }
}

export function isLikelyAttendantName(
  name: string,
  normalized: { fromMe: boolean; text: string }[]
): boolean {
  if (!name || name.length < 3) return false;
  const nameLower = name.toLowerCase();
  const aspenMentions = normalized
    .filter((message) => message.fromMe)
    .filter((message) => message.text.toLowerCase().includes(nameLower)).length;
  const clientMentions = normalized
    .filter((message) => !message.fromMe)
    .filter((message) => message.text.toLowerCase().includes(nameLower)).length;
  return aspenMentions > 0 && clientMentions === 0;
}

export function resolveWhatsappDisplayName(
  extracted: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  fallbackPhone: string
): string {
  const preferred = [
    cleanText(snapshot?.displayLabel, 200),
    cleanText(snapshot?.displayName, 200),
    cleanText(snapshot?.pushName, 200),
    cleanText(snapshot?.name, 200),
    cleanText(snapshot?.notify, 200),
    cleanText(extracted?.nome, 200),
  ].find((name) => name && !isPlaceholderLeadName(name));
  return preferred || firstNonEmpty(
    snapshot?.displayLabel,
    snapshot?.displayName,
    snapshot?.pushName,
    snapshot?.name,
    snapshot?.notify,
    extracted?.nome,
    fallbackPhone,
  );
}

export function formatLeadText(lead: Record<string, unknown>): string {
  const phone = String(lead.telefone || '');
  const displayPhone = phone.startsWith('55') ? phone.slice(2) : phone;
  const lines = [
    lead.nome ? `Nome: ${lead.nome}` : 'Nome:',
    lead.email ? `E-mail: ${lead.email}` : 'E-mail:',
    displayPhone ? `Telefone: ${displayPhone}` : 'Telefone:',
  ];
  const pedidoParts: string[] = [];
  if (lead.produto) pedidoParts.push(String(lead.produto));
  if (lead.quantidade) pedidoParts.push(`${lead.quantidade} un`);
  lines.push(pedidoParts.length ? `Pedido: ${pedidoParts.join(' — ')}` : 'Pedido:');
  return lines.join('\n');
}

export function getWhatsappLeadQuality(lead: Record<string, unknown>): {
  isReady: boolean;
  missingFields: string[];
  statusLabel: string;
} {
  const missingFields: string[] = [];
  if (!cleanText(lead?.nome, 200)) missingFields.push('nome');
  if (!normalizeLeadEmail(lead?.email)) missingFields.push('email');
  if (!isValidBrazilWhatsappPhone(lead?.telefone)) missingFields.push('telefone');
  if (!missingFields.length) return { isReady: true, missingFields, statusLabel: 'Pronto para gerar' };
  const readable = missingFields.map((field) => (field === 'email' ? 'e-mail' : field));
  const joined = readable.length === 1
    ? readable[0]
    : `${readable.slice(0, -1).join(', ')} e ${readable.at(-1)}`;
  return { isReady: false, missingFields, statusLabel: `Sem ${joined}` };
}

export function shouldIncludeWhatsappLead(lead: Record<string, unknown>): boolean {
  return getWhatsappLeadQuality(lead).isReady;
}

function leadIdentityKeys(value: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const phone = normalizeComparablePhone(value.telefone);
  const email = normalizeLeadEmail(value.email);
  const quotationId = safeQuotationReference(value.quotationId);
  if (phone) keys.push(`phone:${phone}`);
  if (email) keys.push(`email:${email}`);
  if (quotationId) keys.push(`quotation:${quotationId}`);
  return keys;
}

function stableLeadKey(value: Record<string, unknown>): string {
  return [
    cleanText(value.id, 200),
    cleanText(value.nome, 200),
    normalizeSnapshotPhone(value.telefone),
    normalizeLeadEmail(value.email),
    cleanText(value.resumo, MAX_SUMMARY_TEXT),
    cleanText(value.produto, 200),
    cleanText(value.quantidade, 200),
    safeQuotationReference(value.quotationId),
  ].join('|');
}

function compareLeadSnapshots(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return timestampValue(b.timestamp) - timestampValue(a.timestamp) ||
    cleanText(a.id, 200).localeCompare(cleanText(b.id, 200)) ||
    stableLeadKey(a).localeCompare(stableLeadKey(b));
}

function leadProjection(value: Record<string, unknown>): Record<string, unknown> {
  const quotationId = safeQuotationReference(value.quotationId);
  const projected: Record<string, unknown> = {
    id: cleanText(value.id, 200),
    nome: cleanText(value.nome, 200),
    telefone: normalizeSnapshotPhone(value.telefone),
    email: normalizeLeadEmail(value.email),
    resumo: cleanText(value.resumo, MAX_SUMMARY_TEXT),
    timestamp: timestampValue(value.timestamp),
    quotationId: quotationId || null,
    hasQuotation: Boolean(quotationId),
  };
  for (const field of ['produto', 'quantidade'] as const) {
    const text = cleanText(value[field], 200);
    if (text) projected[field] = text;
  }
  Object.assign(projected, getWhatsappLeadQuality(projected));
  projected.texto = formatLeadText(projected);
  return projected;
}

function mergeLeadComponent(component: Record<string, unknown>[]): Record<string, unknown> {
  const ordered = component.map(leadProjection).sort(compareLeadSnapshots);
  const merged: Record<string, unknown> = { ...(ordered[0] || {}) };
  for (const field of ['nome', 'resumo', 'produto', 'quantidade'] as const) {
    if (!merged[field]) {
      const source = ordered.find((candidate) => candidate[field]);
      if (source) merged[field] = source[field];
    }
  }
  for (const field of ['telefone', 'email', 'quotationId'] as const) {
    if (merged[field]) continue;
    const values = new Set(ordered.map((candidate) => candidate[field]).filter(Boolean));
    if (values.size === 1) merged[field] = values.values().next().value;
  }
  merged.timestamp = Math.max(...ordered.map((candidate) => timestampValue(candidate.timestamp)), 0);
  return leadProjection(merged);
}

export function prioritizeWhatsappLeads(
  leads: Record<string, unknown>[],
  limit: number = MAX_LEADS
): Record<string, unknown>[] {
  const projected = leads.map(leadProjection);
  const parents = projected.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const firstByIdentity = new Map<string, number>();
  projected.forEach((lead, index) => {
    for (const key of leadIdentityKeys(lead)) {
      const previous = firstByIdentity.get(key);
      if (previous === undefined) firstByIdentity.set(key, index);
      else union(previous, index);
    }
  });
  const components = new Map<number, Record<string, unknown>[]>();
  projected.forEach((lead, index) => {
    const root = find(index);
    const component = components.get(root);
    if (component) component.push(lead);
    else components.set(root, [lead]);
  });
  return [...components.values()]
    .map(mergeLeadComponent)
    .sort(compareLeadSnapshots)
    .slice(0, Math.max(0, Math.min(MAX_LEADS, Math.floor(limit))));
}

function safeQuotationReference(value: unknown): string {
  const normalized = cleanText(value, 120).toUpperCase();
  return UUID_PATTERN.test(normalized) || ORC_BUSINESS_NUMBER_PATTERN.test(normalized)
    ? normalized
    : '';
}

type ConvertedQuotationIndex = {
  phones: ReadonlyMap<string, unknown>;
  emails: ReadonlyMap<string, unknown>;
  names: ReadonlyMap<string, unknown>;
};

export function findConvertedQuotation(
  lead: Record<string, unknown>,
  converted: ConvertedQuotationIndex
): string {
  const phone = normalizeComparablePhone(lead.telefone);
  if (phone && converted?.phones?.has(phone)) return safeQuotationReference(converted.phones.get(phone));
  const email = normalizeLeadEmail(lead.email);
  if (email && converted?.emails?.has(email)) return safeQuotationReference(converted.emails.get(email));
  const name = cleanText(lead.nome, 200).toLowerCase();
  if (name && converted?.names?.has(name)) return safeQuotationReference(converted.names.get(name));
  return '';
}

interface SnapshotConversation {
  id: string;
  canonicalPhone: string;
  displayLabel: string;
  displayName: string;
  identityStatus: WhatsappConversation['identityStatus'];
  lastMessageAt: number;
  linkedLeadId: string | null;
  linkedDealId: string | null;
  linkedQuotationId: string | null;
  linkedCrmEntityId: string | null;
  linkedCrmEntityType: 'lead' | 'cliente' | null;
  linkedCrmMatchSource: 'phone' | 'email' | 'name' | null;
}

function snapshotLocalId(value: unknown): string | null {
  const normalized = cleanText(value, 200);
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function snapshotConversation(value: unknown): SnapshotConversation | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const identityStatus = record.identityStatus === 'verified' || record.identityStatus === 'derived'
    ? record.identityStatus
    : record.identityStatus === 'conflict' ? 'conflict' : 'unresolved';
  const phoneValue = record.canonicalPhone === undefined || record.canonicalPhone === null || record.canonicalPhone === ''
    ? record.phone
    : record.canonicalPhone;
  const canonicalPhone = normalizeSnapshotPhone(phoneValue);
  const id = cleanText(record.id, 200);
  if (!id || id.includes('@')) return null;
  const linkedCrmEntityId = snapshotLocalId(record.linkedCrmEntityId);
  const linkedCrmEntityType = linkedCrmEntityId &&
    (record.linkedCrmEntityType === 'lead' || record.linkedCrmEntityType === 'cliente')
    ? record.linkedCrmEntityType
    : null;
  return {
    id,
    canonicalPhone,
    displayLabel: cleanText(record.displayLabel, 200),
    displayName: cleanText(record.displayName, 200),
    identityStatus,
    lastMessageAt: timestampValue(record.lastMessageAt),
    linkedLeadId: snapshotLocalId(record.linkedLeadId),
    linkedDealId: snapshotLocalId(record.linkedDealId),
    linkedQuotationId: snapshotLocalId(record.linkedQuotationId),
    linkedCrmEntityId,
    linkedCrmEntityType,
    linkedCrmMatchSource:
      record.linkedCrmMatchSource === 'phone' ||
      record.linkedCrmMatchSource === 'email' ||
      record.linkedCrmMatchSource === 'name'
        ? record.linkedCrmMatchSource
        : null,
  };
}

function buildStoreDeps(deps: WhatsappLeadsDeps): WhatsappConversationStoreDeps {
  const overrides = { ...deps } as Record<string, unknown>;
  delete overrides.sync;
  delete overrides.localCrm;
  delete overrides.extractLead;
  delete overrides.usePostgresCrm;
  return { ...LIVE_DEPS, ...overrides } as WhatsappConversationStoreDeps;
}

export interface WhatsappLeadsDeps extends Partial<WhatsappConversationStoreDeps> {
  sync?: (options: WhatsappSyncOptions, deps?: EvolutionSyncDeps) => Promise<unknown>;
  localCrm?: LocalWhatsappCrmRepository | null;
  extractLead?: (
    conversationText: string,
    messages: Array<{ body: string; timestamp: number }>
  ) => Promise<Record<string, unknown>>;
  usePostgresCrm?: boolean;
  listQuoteLeads?: () => Promise<LocalQuoteLeadRecord[]>;
  listClients?: () => Promise<LocalClientRecord[]>;
  listDeals?: () => Promise<LocalDealRecord[]>;
  listQuotations?: () => Promise<LocalQuotationRecord[]>;
  getQuoteLead?: (id: string) => Promise<LocalQuoteLeadRecord | null>;
  getClient?: (id: string) => Promise<LocalClientRecord | null>;
  getDeal?: (id: string) => Promise<LocalDealRecord | null>;
  getQuotation?: (id: string) => Promise<LocalQuotationRecord | null>;
  findCandidatesByPhone?: (phone: string, limit: number) => Promise<LocalCrmCandidate[]>;
  findCandidatesByEmail?: (emails: string[], limit: number) => Promise<LocalCrmCandidate[]>;
  findCandidatesByName?: (name: string, limit: number) => Promise<LocalCrmCandidate[]>;
}

function crmRepositoryFor(
  deps: WhatsappLeadsDeps
): LocalWhatsappCrmRepository | null {
  if (deps.localCrm !== undefined) return deps.localCrm;
  const hasCandidateSeam = Boolean(
    deps.findCandidatesByPhone || deps.findCandidatesByEmail || deps.findCandidatesByName ||
    deps.listQuoteLeads || deps.listClients || deps.listDeals || deps.listQuotations
  );
  if (hasCandidateSeam) {
    return {
      getQuoteLead: deps.getQuoteLead || (async () => null),
      getClient: deps.getClient || (async () => null),
      getDeal: deps.getDeal || (async () => null),
      getQuotation: deps.getQuotation || (async () => null),
      ...(deps.listQuoteLeads ? { listQuoteLeads: deps.listQuoteLeads } : {}),
      ...(deps.listClients ? { listClients: deps.listClients } : {}),
      ...(deps.listDeals ? { listDeals: deps.listDeals } : {}),
      ...(deps.listQuotations ? { listQuotations: deps.listQuotations } : {}),
      ...(deps.findCandidatesByPhone ? { findCandidatesByPhone: deps.findCandidatesByPhone } : {}),
      ...(deps.findCandidatesByEmail ? { findCandidatesByEmail: deps.findCandidatesByEmail } : {}),
      ...(deps.findCandidatesByName ? { findCandidatesByName: deps.findCandidatesByName } : {}),
    };
  }
  if (!deps.usePostgresCrm) return null;
  return createPostgresWhatsappCrmRepository();
}

async function correlateQuotation(
  conversation: SnapshotConversation,
  _messages: Array<{ body: string; timestamp: number }>,
  storeDeps: WhatsappConversationStoreDeps,
  repository: LocalWhatsappCrmRepository | null
): Promise<string> {
  if (!repository) return '';
  const candidate = await resolveWhatsappCrmCandidateFromSnapshot({
    conversation,
    deps: {
      ...storeDeps,
      localCrm: repository,
    },
  });
  return safeQuotationReference(candidate?.candidate.quotationId) || '';
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;
  async function worker(): Promise<void> {
    while (!failed) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      try {
        results[index] = await mapper(values[index], index);
      } catch (error) {
        failed = true;
        firstError = error;
      }
    }
  }
  await Promise.allSettled(
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, () => worker()),
  );
  if (failed) {
    const statusCode = Number((firstError as { statusCode?: unknown } | null)?.statusCode || 0);
    if (Number.isInteger(statusCode) && statusCode >= 400) throw firstError;
    throw Object.assign(new Error('WhatsApp lead worker failed.'), { statusCode: 503 });
  }
  return results;
}

export function createHandler(deps: WhatsappLeadsDeps = {}): (event: FunctionEvent) => Promise<FunctionResult> {
  const storeDeps = buildStoreDeps(deps);
  return async function whatsappLeadsHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (String(event.httpMethod || '').toUpperCase() !== 'GET') {
      return jsonResponse(405, { error: 'Método não permitido.' });
    }
    try {
      const repository = crmRepositoryFor(deps);
      if (deps.sync) {
        await deps.sync({ chatLimit: MAX_LEADS, messageLimit: MAX_MESSAGES_PER_CHAT }, storeDeps);
      }
      const conversations = await listWhatsappConversations(
        { status: 'all', limit: MAX_CHATS_TO_SCAN },
        storeDeps
      );
      const candidates = (await mapWithConcurrency(
        conversations,
        MAX_EXTRACTION_CONCURRENCY,
        async (item): Promise<Record<string, unknown> | null> => {
          const conversation = snapshotConversation(item);
          if (!conversation || !isValidBrazilWhatsappPhone(conversation.canonicalPhone)) return null;
          if (conversation.identityStatus !== 'verified' && conversation.identityStatus !== 'derived') return null;
          const messages = normalizeInboundMessages(await getWhatsappMessages(conversation.id, storeDeps));
          const conversationText = composeInboundText(messages);
          let extracted: Record<string, unknown>;
          try {
            extracted = await (deps.extractLead || extractLeadWithOpenRouter)(conversationText, messages);
          } catch {
            extracted = extractFallback(conversationText);
          }
          const extractedProjection = projectedExtraction(extracted, extractFallback(conversationText));
          const nome = firstNonEmpty(conversation.displayLabel, conversation.displayName);
          const email = normalizeLeadEmail(extractedProjection.email) || extractEmailFromText(conversationText);
          const resumo = cleanText(extractedProjection.resumo, MAX_SUMMARY_TEXT) || summaryFromMessages(messages);
          const quotationId = await correlateQuotation(conversation, messages, storeDeps, repository);
          return leadProjection({
            id: conversation.id,
            nome: isPlaceholderLeadName(nome) ? '' : nome,
            telefone: conversation.canonicalPhone,
            email,
            resumo,
            timestamp: conversation.lastMessageAt,
            quotationId,
            produto: extractedProjection.produto,
            quantidade: extractedProjection.quantidade,
          });
        },
      )).filter((candidate): candidate is Record<string, unknown> => candidate !== null);
      return jsonResponse(200, { success: true, data: prioritizeWhatsappLeads(candidates) });
    } catch (error: unknown) {
      const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
      const statusCode = Number.isInteger(record.statusCode) ? Number(record.statusCode) : 500;
      console.error('[whatsapp-leads]', error instanceof Error ? error.name : typeof error, statusCode);
      const message = typeof record.message === 'string' ? record.message : '';
      const safeMessage = message.length <= 200 && /^(Não |Armazenamento|Sincronização|Tempo limite|Falha ao conectar|Integração WhatsApp|Método |JSON |Conversa )/.test(message)
        ? message
        : 'Erro interno ao buscar conversas do WhatsApp.';
      return jsonResponse(statusCode, { error: safeMessage });
    }
  };
}

export const handler = createHandler({
  sync: process.env.EVOLUTION_BASE_URL ? syncWhatsappConversations : undefined,
  usePostgresCrm: Boolean(process.env.DATABASE_URL),
});
