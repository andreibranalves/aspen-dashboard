<!-- markdownlint-disable MD013 -->

# WhatsApp CRM Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MVP WhatsApp commercial inbox that lists recent conversations,
shows messages, links CRM context, extracts quote requests, and creates
`source: "whatsapp"` pre-quotes.

**Architecture:** Add a focused backend module around a new
`whatsapp-conversations` API route. Store normalized conversations/messages in
KV-compatible storage, sync on-demand from Evolution API, and reuse the current
pre-quotes and extraction flows. Add one lazy React page at `#/whatsapp-inbox`
with a three-column inbox layout and action buttons.

**Tech Stack:** React 19 + Vite 6, TypeScript, Node ESM Vercel serverless
handlers, Vercel KV, Evolution API, ERPNext/Frappe CRM, `node --test`.

## Global Constraints

- ESM only; local imports in `api/` must include `.js` extensions.
- Frontend source stays in `.ts`/`.tsx` under `src/`.
- Hash routing only; add route handling in `src/App.tsx`.
- Single catch-all API route; keep `api/[...path].ts`,
  `scripts/dev-api-server.mjs`, and `scripts/app-server.mjs` route maps in sync.
- Handler shape remains `handler(event) -> { statusCode, body }`.
- Local dev auth/rate-limit are skipped by dev servers; production route uses
  the catch-all auth/rate-limit wrapper.
- Do not expose `EVOLUTION_API_KEY` or raw provider stack traces to frontend.
- User-facing API errors must be Brazilian Portuguese.
- Do not add dependencies.
- Do not build a full WhatsApp Web/helpdesk clone in this MVP.
- MVP route is `#/whatsapp-inbox`, navigation label is `WhatsApp`.
- Sync recent conversations and up to 50 messages per conversation.

---

## File Structure

Create:

- `api/_functions/lib/whatsapp-conversations-store.ts`  
  KV-compatible storage, types, normalization, dedupe, list/get/update helpers.
- `api/_functions/lib/whatsapp-conversations-sync.ts`  
  Evolution API fetch/normalization/sync orchestration with dependency injection.
- `api/_functions/whatsapp-conversations.ts`  
  HTTP handler for list, messages, sync, patch, extract, and pre-quote creation.
- `tests/unit/whatsapp-conversations-store.test.ts`  
  Store/unit tests.
- `tests/unit/whatsapp-conversations-sync.test.ts`  
  Evolution normalization/sync tests.
- `tests/unit/whatsapp-conversations.test.ts`  
  Handler tests.
- `src/lib/whatsappInboxApi.ts`  
  Frontend API wrapper and shared frontend types.
- `src/pages/WhatsAppInboxPage.tsx`  
  Lazy-loaded inbox page.

Modify:

- `api/[...path].ts`  
  Register `whatsapp-conversations` route.
- `scripts/dev-api-server.mjs`  
  Register local dev route.
- `scripts/app-server.mjs`  
  Register combined app server route.
- `src/App.tsx`  
  Lazy-load and dispatch `#/whatsapp-inbox`.
- `src/components/layout/Layout.tsx`  
  Add breadcrumb label.
- `src/components/layout/Sidebar.tsx`  
  Add `WhatsApp` nav item.
- `docs/pre-orcamentos-inbox.md`  
  Document WhatsApp as an active source after implementation.

---

### Task 1: Conversation Store and Types

**Files:**

- Create: `api/_functions/lib/whatsapp-conversations-store.ts`
- Test: `tests/unit/whatsapp-conversations-store.test.ts`

**Interfaces:**

- Produces:
  - `type WhatsappConversationStatus`
  - `interface WhatsappConversation`
  - `interface WhatsappMessage`
  - `interface WhatsappQuoteExtraction`
  - `interface WhatsappConversationStoreDeps`
  - `normalizeWhatsappConversationInput(input, deps?)`
  - `normalizeWhatsappMessageInput(input, deps?)`
  - `upsertWhatsappConversation(input, deps?)`
  - `upsertWhatsappMessages(conversationId, messages, deps?)`
  - `listWhatsappConversations(filters, deps?)`
  - `getWhatsappConversation(id, deps?)`
  - `getWhatsappMessages(conversationId, deps?)`
  - `updateWhatsappConversation(id, patch, deps?)`

- Consumes:
  - `kv` from `@vercel/kv`
  - `createHttpError` from `api/_functions/lib/erpnext.js`

- [ ] **Step 1: Write failing store tests**

Create `tests/unit/whatsapp-conversations-store.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getWhatsappConversation,
  getWhatsappMessages,
  listWhatsappConversations,
  normalizeWhatsappConversationInput,
  normalizeWhatsappMessageInput,
  updateWhatsappConversation,
  upsertWhatsappConversation,
  upsertWhatsappMessages,
  type WhatsappConversation,
  type WhatsappConversationStoreDeps,
} from '../../api/_functions/lib/whatsapp-conversations-store.js';

function makeDeps(): WhatsappConversationStoreDeps {
  let conversations: WhatsappConversation[] = [];
  const messages = new Map<string, any[]>();
  let nextId = 1;

  return {
    now: () => '2026-07-01T12:00:00.000Z',
    id: () => `wa_${nextId++}`,
    readConversations: async () => conversations,
    writeConversations: async (value) => {
      conversations = value;
    },
    readMessages: async (conversationId) => messages.get(conversationId) || [],
    writeMessages: async (conversationId, value) => {
      messages.set(conversationId, value);
    },
  };
}

describe('whatsapp-conversations-store', () => {
  it('normalizes conversation input with safe defaults', () => {
    const deps = makeDeps();
    const conversation = normalizeWhatsappConversationInput(
      {
        remoteJid: '5511999999999@s.whatsapp.net',
        phone: '(11) 99999-9999',
        displayName: ' João  Silva ',
        lastMessagePreview: ' Quero 50 camisetas ',
      },
      deps
    );

    assert.equal(conversation.id, 'wa_1');
    assert.equal(conversation.remoteJid, '5511999999999@s.whatsapp.net');
    assert.equal(conversation.phone, '5511999999999');
    assert.equal(conversation.displayName, 'João Silva');
    assert.equal(conversation.status, 'new');
    assert.equal(conversation.source, 'evolution');
  });

  it('normalizes message input and preserves provider id', () => {
    const deps = makeDeps();
    const message = normalizeWhatsappMessageInput(
      {
        providerMessageId: 'wamid.1',
        direction: 'inbound',
        type: 'text',
        body: 'Olá, queria orçamento',
        timestamp: '2026-07-01T11:59:00.000Z',
      },
      deps
    );

    assert.equal(message.id, 'wa_1');
    assert.equal(message.providerMessageId, 'wamid.1');
    assert.equal(message.direction, 'inbound');
    assert.equal(message.type, 'text');
    assert.equal(message.body, 'Olá, queria orçamento');
  });

  it('upserts conversations by remoteJid and keeps newest preview', async () => {
    const deps = makeDeps();

    const first = await upsertWhatsappConversation(
      {
        remoteJid: '5511999999999@s.whatsapp.net',
        phone: '5511999999999',
        displayName: 'João',
        lastMessagePreview: 'primeira',
        lastMessageAt: '2026-07-01T10:00:00.000Z',
      },
      deps
    );
    const second = await upsertWhatsappConversation(
      {
        remoteJid: '5511999999999@s.whatsapp.net',
        phone: '5511999999999',
        displayName: 'João Silva',
        lastMessagePreview: 'segunda',
        lastMessageAt: '2026-07-01T11:00:00.000Z',
      },
      deps
    );

    assert.equal(first.id, second.id);
    assert.equal(second.displayName, 'João Silva');
    assert.equal(second.lastMessagePreview, 'segunda');
    assert.equal((await listWhatsappConversations({}, deps)).length, 1);
  });

  it('deduplicates messages by providerMessageId', async () => {
    const deps = makeDeps();
    const conversation = await upsertWhatsappConversation(
      { remoteJid: '5511999999999@s.whatsapp.net', phone: '5511999999999' },
      deps
    );

    await upsertWhatsappMessages(
      conversation.id,
      [
        { providerMessageId: 'm1', direction: 'inbound', body: 'Oi' },
        { providerMessageId: 'm1', direction: 'inbound', body: 'Oi duplicado' },
        { providerMessageId: 'm2', direction: 'outbound', body: 'Olá' },
      ],
      deps
    );

    const stored = await getWhatsappMessages(conversation.id, deps);
    assert.equal(stored.length, 2);
    assert.deepEqual(
      stored.map((message) => message.providerMessageId),
      ['m1', 'm2']
    );
  });

  it('filters conversations by status, query, and limit', async () => {
    const deps = makeDeps();
    await upsertWhatsappConversation(
      { remoteJid: 'a@s.whatsapp.net', phone: '5511111111111', displayName: 'Ana' },
      deps
    );
    const bruno = await upsertWhatsappConversation(
      { remoteJid: 'b@s.whatsapp.net', phone: '5522222222222', displayName: 'Bruno' },
      deps
    );
    await updateWhatsappConversation(bruno.id, { status: 'needs_quote' }, deps);

    const results = await listWhatsappConversations(
      { status: 'needs_quote', q: 'bru', limit: 1 },
      deps
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].displayName, 'Bruno');
  });

  it('throws a Portuguese 404 when conversation is missing', async () => {
    const deps = makeDeps();
    await assert.rejects(
      () => getWhatsappConversation('missing', deps),
      /Conversa do WhatsApp não encontrada/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/whatsapp-conversations-store.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND` for
`api/_functions/lib/whatsapp-conversations-store.js` or missing exports.

- [ ] **Step 3: Implement store module**

Create `api/_functions/lib/whatsapp-conversations-store.ts`:

```ts
import { kv } from '@vercel/kv';
import { createHttpError } from './erpnext.js';

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
  remoteJid: string;
  phone: string;
  displayName: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  source: 'evolution';
  linkedLeadId?: string | null;
  linkedDealId?: string | null;
  linkedQuotationId?: string | null;
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

function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(value: unknown): string {
  const raw = String(value || '');
  const beforeAt = raw.split('@')[0];
  let digits = beforeAt.replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  return digits;
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

const LIVE_DEPS: WhatsappConversationStoreDeps = {
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
  const remoteJid = cleanText(input.remoteJid || input.id || input.jid);
  const phone = normalizePhone(input.phone || input.telefone || remoteJid);
  const displayName = cleanText(input.displayName || input.name || input.nome || phone);

  return {
    id: cleanText(input.id) || deps.id(),
    remoteJid,
    phone,
    displayName,
    lastMessageAt: normalizeIso(input.lastMessageAt || input.timestamp, now),
    lastMessagePreview: cleanText(input.lastMessagePreview || input.preview || ''),
    source: 'evolution',
    linkedLeadId: cleanText(input.linkedLeadId) || null,
    linkedDealId: cleanText(input.linkedDealId) || null,
    linkedQuotationId: cleanText(input.linkedQuotationId) || null,
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
      linkedQuotationId: normalized.linkedQuotationId || current.linkedQuotationId || null,
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
      return [item.displayName, item.phone, item.lastMessagePreview].some((value) =>
        value.toLowerCase().includes(q)
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
    updatedAt: deps.now(),
  };
  await deps.writeConversations(next);
  return next[index];
}
```

- [ ] **Step 4: Run store tests**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/whatsapp-conversations-store.test.ts
```

Expected: all tests in `whatsapp-conversations-store.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add api/_functions/lib/whatsapp-conversations-store.ts \
  tests/unit/whatsapp-conversations-store.test.ts
git commit -m "feat: add whatsapp conversation store"
```

---

### Task 2: Evolution Sync Normalization

**Files:**

- Create: `api/_functions/lib/whatsapp-conversations-sync.ts`
- Test: `tests/unit/whatsapp-conversations-sync.test.ts`

**Interfaces:**

- Consumes from Task 1:
  - `upsertWhatsappConversation(input, deps)`
  - `upsertWhatsappMessages(conversationId, messages, deps)`
  - `WhatsappConversationStoreDeps`

- Produces:
  - `interface EvolutionSyncDeps`
  - `normalizeEvolutionConversation(chat)`
  - `normalizeEvolutionMessage(message)`
  - `syncWhatsappConversations(options, deps)`

- [ ] **Step 1: Write failing sync tests**

Create `tests/unit/whatsapp-conversations-sync.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeEvolutionConversation,
  normalizeEvolutionMessage,
  syncWhatsappConversations,
  type EvolutionSyncDeps,
} from '../../api/_functions/lib/whatsapp-conversations-sync.js';
import type {
  WhatsappConversation,
  WhatsappConversationStoreDeps,
} from '../../api/_functions/lib/whatsapp-conversations-store.js';

function makeStoreDeps(): WhatsappConversationStoreDeps {
  let conversations: WhatsappConversation[] = [];
  const messages = new Map<string, any[]>();
  let nextId = 1;

  return {
    now: () => '2026-07-01T12:00:00.000Z',
    id: () => `wa_${nextId++}`,
    readConversations: async () => conversations,
    writeConversations: async (value) => {
      conversations = value;
    },
    readMessages: async (conversationId) => messages.get(conversationId) || [],
    writeMessages: async (conversationId, value) => {
      messages.set(conversationId, value);
    },
  };
}

describe('whatsapp-conversations-sync', () => {
  it('normalizes Evolution chat payloads', () => {
    const normalized = normalizeEvolutionConversation({
      remoteJid: '5511999999999@s.whatsapp.net',
      pushName: 'Maria Cliente',
      updatedAt: 1782916800,
      lastMessage: { text: 'Quero 100 cangas' },
    });

    assert.equal(normalized.remoteJid, '5511999999999@s.whatsapp.net');
    assert.equal(normalized.phone, '5511999999999');
    assert.equal(normalized.displayName, 'Maria Cliente');
    assert.equal(normalized.lastMessagePreview, 'Quero 100 cangas');
  });

  it('marks group chats as skipped by returning null', () => {
    assert.equal(
      normalizeEvolutionConversation({ remoteJid: '1203630@g.us', subject: 'Grupo' }),
      null
    );
  });

  it('normalizes inbound and outbound messages', () => {
    const inbound = normalizeEvolutionMessage({
      key: { id: 'm1', fromMe: false },
      messageTimestamp: 1782916800,
      message: { conversation: 'Oi' },
    });
    const outbound = normalizeEvolutionMessage({
      key: { id: 'm2', fromMe: true },
      messageTimestamp: 1782916860,
      message: { conversation: 'Olá' },
    });

    assert.equal(inbound?.providerMessageId, 'm1');
    assert.equal(inbound?.direction, 'inbound');
    assert.equal(inbound?.body, 'Oi');
    assert.equal(outbound?.direction, 'outbound');
  });

  it('syncs chats and messages through injected fetcher', async () => {
    const storeDeps = makeStoreDeps();
    const syncDeps: EvolutionSyncDeps = {
      ...storeDeps,
      fetchChats: async () => [
        {
          remoteJid: '5511999999999@s.whatsapp.net',
          pushName: 'Maria',
          updatedAt: 1782916800,
          lastMessage: { text: 'Quero 100 cangas' },
        },
      ],
      fetchMessages: async () => [
        {
          key: { id: 'm1', fromMe: false },
          messageTimestamp: 1782916800,
          message: { conversation: 'Quero 100 cangas' },
        },
      ],
    };

    const result = await syncWhatsappConversations({ chatLimit: 5, messageLimit: 50 }, syncDeps);

    assert.equal(result.conversations.length, 1);
    assert.equal(result.syncedMessages, 1);
    assert.equal((await storeDeps.readMessages(result.conversations[0].id)).length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/whatsapp-conversations-sync.test.ts
```

Expected: module or exports are missing.

- [ ] **Step 3: Implement Evolution sync module**

Create `api/_functions/lib/whatsapp-conversations-sync.ts`:

```ts
import { createHttpError } from './erpnext.js';
import {
  upsertWhatsappConversation,
  upsertWhatsappMessages,
  type WhatsappConversation,
  type WhatsappConversationStoreDeps,
} from './whatsapp-conversations-store.js';

const EVOLUTION_BASE_URL = (process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || '';

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

  const res = await fetch(`${EVOLUTION_BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      apikey: EVOLUTION_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

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
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

async function liveFetchMessages(
  remoteJid: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  const data = await evolutionRequest(`/chat/findMessages/${EVOLUTION_INSTANCE}`, {
    where: { key: { remoteJid } },
    limit,
  });
  const records = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown> | null)?.messages)
      ? ((data as Record<string, unknown>).messages as unknown[])
      : [];
  return records as Array<Record<string, unknown>>;
}

export async function syncWhatsappConversations(
  options: WhatsappSyncOptions = {},
  deps: EvolutionSyncDeps
): Promise<{ conversations: WhatsappConversation[]; syncedMessages: number }> {
  const chatLimit = Math.max(1, Math.min(Number(options.chatLimit || 5), 20));
  const messageLimit = Math.max(1, Math.min(Number(options.messageLimit || 50), 50));
  const fetchChats = deps.fetchChats || liveFetchChats;
  const fetchMessages = deps.fetchMessages || liveFetchMessages;

  const chats = await fetchChats(chatLimit);
  const conversations: WhatsappConversation[] = [];
  let syncedMessages = 0;

  for (const chat of chats) {
    const normalized = normalizeEvolutionConversation(chat);
    if (!normalized) continue;

    const conversation = await upsertWhatsappConversation(normalized, deps);
    conversations.push(conversation);

    const messages = (await fetchMessages(conversation.remoteJid, messageLimit))
      .map(normalizeEvolutionMessage)
      .filter(Boolean) as Array<Record<string, unknown>>;
    const stored = await upsertWhatsappMessages(conversation.id, messages, deps);
    syncedMessages += stored.length;
  }

  return { conversations, syncedMessages };
}
```

- [ ] **Step 4: Run sync tests**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/whatsapp-conversations-sync.test.ts
```

Expected: all tests in `whatsapp-conversations-sync.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add api/_functions/lib/whatsapp-conversations-sync.ts \
  tests/unit/whatsapp-conversations-sync.test.ts
git commit -m "feat: sync whatsapp conversations from evolution"
```

---

### Task 3: WhatsApp Conversations API Route

**Files:**

- Create: `api/_functions/whatsapp-conversations.ts`
- Modify: `api/[...path].ts`
- Modify: `scripts/dev-api-server.mjs`
- Modify: `scripts/app-server.mjs`
- Test: `tests/unit/whatsapp-conversations.test.ts`

**Interfaces:**

- Consumes from Task 1:
  - store functions and `WhatsappConversationStoreDeps`
- Consumes from Task 2:
  - `syncWhatsappConversations(options, deps)`
- Produces:
  - `createHandler(deps?)`
  - `handler`
  - HTTP endpoints:
    - `GET /api/whatsapp-conversations`
    - `GET /api/whatsapp-conversations/:id/messages`
    - `POST /api/whatsapp-conversations/sync`
    - `PATCH /api/whatsapp-conversations/:id`

- [ ] **Step 1: Write failing handler tests**

Create `tests/unit/whatsapp-conversations.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../../api/_functions/whatsapp-conversations.js';
import type {
  WhatsappConversation,
  WhatsappConversationStoreDeps,
} from '../../api/_functions/lib/whatsapp-conversations-store.js';

function parse(result: any): any {
  return JSON.parse(result.body || '{}');
}

function makeDeps(): WhatsappConversationStoreDeps & {
  fetchChats: any;
  fetchMessages: any;
} {
  let conversations: WhatsappConversation[] = [];
  const messages = new Map<string, any[]>();
  let nextId = 1;

  return {
    now: () => '2026-07-01T12:00:00.000Z',
    id: () => `wa_${nextId++}`,
    readConversations: async () => conversations,
    writeConversations: async (value) => {
      conversations = value;
    },
    readMessages: async (conversationId) => messages.get(conversationId) || [],
    writeMessages: async (conversationId, value) => {
      messages.set(conversationId, value);
    },
    fetchChats: async () => [
      {
        remoteJid: '5511999999999@s.whatsapp.net',
        pushName: 'Maria',
        updatedAt: 1782916800,
        lastMessage: { text: 'Quero orçamento' },
      },
    ],
    fetchMessages: async () => [
      {
        key: { id: 'm1', fromMe: false },
        messageTimestamp: 1782916800,
        message: { conversation: 'Quero orçamento' },
      },
    ],
  };
}

describe('whatsapp-conversations handler', () => {
  it('syncs conversations with POST /sync', async () => {
    const handler = createHandler(makeDeps());
    const result = await handler({
      httpMethod: 'POST',
      rawUrl: '/api/whatsapp-conversations/sync',
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).success, true);
    assert.equal(parse(result).data.conversations.length, 1);
  });

  it('lists conversations', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    await handler({
      httpMethod: 'POST',
      rawUrl: '/api/whatsapp-conversations/sync',
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);

    const result = await handler({
      httpMethod: 'GET',
      rawUrl: '/api/whatsapp-conversations',
      queryStringParameters: { limit: '50' },
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data[0].displayName, 'Maria');
  });

  it('returns messages for a conversation', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    const syncResult = await handler({
      httpMethod: 'POST',
      rawUrl: '/api/whatsapp-conversations/sync',
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'GET',
      rawUrl: `/api/whatsapp-conversations/${id}/messages`,
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data[0].body, 'Quero orçamento');
  });

  it('patches conversation status', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    const syncResult = await handler({
      httpMethod: 'POST',
      rawUrl: '/api/whatsapp-conversations/sync',
      body: '{}',
      queryStringParameters: {},
      headers: {},
    } as any);
    const id = parse(syncResult).data.conversations[0].id;

    const result = await handler({
      httpMethod: 'PATCH',
      rawUrl: `/api/whatsapp-conversations/${id}`,
      body: JSON.stringify({ status: 'waiting_customer' }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 200);
    assert.equal(parse(result).data.status, 'waiting_customer');
  });

  it('returns safe Portuguese errors', async () => {
    const handler = createHandler(makeDeps());
    const result = await handler({
      httpMethod: 'GET',
      rawUrl: '/api/whatsapp-conversations/missing/messages',
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 404);
    assert.match(parse(result).error, /Conversa do WhatsApp não encontrada/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/whatsapp-conversations.test.ts
```

Expected: module or handler export is missing.

- [ ] **Step 3: Implement API handler**

Create `api/_functions/whatsapp-conversations.ts`:

```ts
import type {
  FunctionEvent,
  FunctionResult,
  JsonResponseFn,
  LegacyHandler,
} from '../_lib/types.js';
import { createHttpError } from './lib/erpnext.js';
import {
  getWhatsappMessages,
  listWhatsappConversations,
  updateWhatsappConversation,
  type WhatsappConversationStatus,
  type WhatsappConversationStoreDeps,
} from './lib/whatsapp-conversations-store.js';
import {
  syncWhatsappConversations,
  type EvolutionSyncDeps,
} from './lib/whatsapp-conversations-sync.js';

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function parseJsonBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === 'object') return body as Record<string, unknown>;
  try {
    return JSON.parse(String(body));
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
}

function getSubPath(event: FunctionEvent): string[] {
  const rawUrl = event.rawUrl || '';
  const path = rawUrl.split('?')[0].replace(/^\/api\/whatsapp-conversations\/?/, '');
  return path.split('/').filter(Boolean).map(decodeURIComponent);
}

function parseStatus(value: unknown): WhatsappConversationStatus | 'all' {
  const allowed = [
    'new',
    'needs_quote',
    'incomplete',
    'quote_lead_created',
    'quotation_created',
    'waiting_customer',
    'closed',
    'ignored',
    'all',
  ];
  return allowed.includes(String(value)) ? (value as WhatsappConversationStatus | 'all') : 'all';
}

function parseLimit(value: unknown): number {
  const limit = Number(value || 50);
  return Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
}

export function createHandler(
  deps?: EvolutionSyncDeps & WhatsappConversationStoreDeps
): LegacyHandler {
  return async function whatsappConversationsHandler(
    event: FunctionEvent
  ): Promise<FunctionResult> {
    try {
      const parts = getSubPath(event);

      if (event.httpMethod === 'GET' && parts.length === 0) {
        const data = await listWhatsappConversations(
          {
            status: parseStatus(event.queryStringParameters?.status),
            q: event.queryStringParameters?.q || '',
            hasQuoteRequest: event.queryStringParameters?.hasQuoteRequest,
            limit: parseLimit(event.queryStringParameters?.limit),
          },
          deps
        );
        return jsonResponse(200, { success: true, data });
      }

      if (event.httpMethod === 'GET' && parts.length === 2 && parts[1] === 'messages') {
        const data = await getWhatsappMessages(parts[0], deps);
        return jsonResponse(200, { success: true, data });
      }

      if (event.httpMethod === 'POST' && parts.length === 1 && parts[0] === 'sync') {
        const body = parseJsonBody(event.body);
        const data = await syncWhatsappConversations(
          {
            chatLimit: parseLimit(body.chatLimit || 5),
            messageLimit: parseLimit(body.messageLimit || 50),
          },
          deps as EvolutionSyncDeps
        );
        return jsonResponse(200, { success: true, data });
      }

      if (event.httpMethod === 'PATCH' && parts.length === 1) {
        const body = parseJsonBody(event.body);
        const data = await updateWhatsappConversation(
          parts[0],
          {
            status: parseStatus(body.status) as WhatsappConversationStatus,
            linkedLeadId: body.linkedLeadId == null ? null : String(body.linkedLeadId),
            linkedDealId: body.linkedDealId == null ? null : String(body.linkedDealId),
            linkedQuotationId:
              body.linkedQuotationId == null ? null : String(body.linkedQuotationId),
          },
          deps
        );
        return jsonResponse(200, { success: true, data });
      }

      return jsonResponse(404, { error: 'Endpoint não encontrado.' });
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[whatsapp-conversations]', err?.logMessage || err?.message || err);
      return jsonResponse(code, {
        error: err?.message || 'Erro interno ao buscar conversas do WhatsApp.',
      });
    }
  };
}

export const handler: LegacyHandler = createHandler();
```

- [ ] **Step 4: Register route maps**

Modify `api/[...path].ts`:

```ts
import { handler as whatsappConversations } from './_functions/whatsapp-conversations.js';
```

Add to `ROUTES`:

```ts
'whatsapp-conversations': whatsappConversations,
```

Modify `scripts/dev-api-server.mjs`:

```js
import { handler as whatsappConversations } from '../api/_functions/whatsapp-conversations.js';
```

Add to `ROUTES`:

```js
'whatsapp-conversations': whatsappConversations,
```

Modify `scripts/app-server.mjs` with the same import and route entry.

- [ ] **Step 5: Run API tests**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/whatsapp-conversations.test.ts
```

Expected: all handler tests pass.

- [ ] **Step 6: Commit**

```bash
git add api/_functions/whatsapp-conversations.ts api/[...path].ts \
  scripts/dev-api-server.mjs scripts/app-server.mjs \
  tests/unit/whatsapp-conversations.test.ts
git commit -m "feat: add whatsapp conversations api"
```

---

### Task 4: Extract Quote and Create Pre-Quote Actions

**Files:**

- Modify: `api/_functions/whatsapp-conversations.ts`
- Test: `tests/unit/whatsapp-conversations.test.ts`

**Interfaces:**

- Consumes from Task 1:
  - `getWhatsappConversation(id, deps)`
  - `getWhatsappMessages(conversationId, deps)`
  - `updateWhatsappConversation(id, patch, deps)`
- Consumes existing:
  - `handler as extractHandler` from `api/_functions/extract.js`
  - `upsertQuoteLead` from `api/_functions/lib/quote-leads-store.js`
- Produces HTTP endpoints:
  - `POST /api/whatsapp-conversations/:id/extract-quote`
  - `POST /api/whatsapp-conversations/:id/create-quote-lead`

- [ ] **Step 1: Extend handler tests for extraction and pre-quotes**

Append to `tests/unit/whatsapp-conversations.test.ts`:

```ts
it('creates whatsapp pre-quote from conversation messages', async () => {
  const deps = makeDeps();
  const handler = createHandler({
    ...deps,
    upsertQuoteLead: async (input: any) => ({
      id: 'quote_lead_1',
      source: input.source,
      telefone: input.telefone,
      pedidoTexto: input.pedidoTexto,
      status: 'ready',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-01T12:00:00.000Z',
    }),
    extractOrders: async () => [{ produto: 'Canga', quantidade: 100 }],
  } as any);
  const syncResult = await handler({
    httpMethod: 'POST',
    rawUrl: '/api/whatsapp-conversations/sync',
    body: '{}',
    queryStringParameters: {},
    headers: {},
  } as any);
  const id = parse(syncResult).data.conversations[0].id;

  const result = await handler({
    httpMethod: 'POST',
    rawUrl: `/api/whatsapp-conversations/${id}/create-quote-lead`,
    body: JSON.stringify({ extractedPayload: { produto: 'Canga', quantidade: 100 } }),
    queryStringParameters: {},
    headers: {},
  } as any);

  assert.equal(result.statusCode, 201);
  assert.equal(parse(result).data.source, 'whatsapp');
  assert.equal(parse(result).data.id, 'quote_lead_1');
});

it('extracts quote payload from recent messages', async () => {
  const deps = makeDeps();
  const handler = createHandler({
    ...deps,
    extractOrders: async (text: string) => {
      assert.match(text, /Quero orçamento/);
      return [{ produto: 'Canga', quantidade: 100 }];
    },
    upsertQuoteLead: async () => ({ id: 'unused' }),
  } as any);
  const syncResult = await handler({
    httpMethod: 'POST',
    rawUrl: '/api/whatsapp-conversations/sync',
    body: '{}',
    queryStringParameters: {},
    headers: {},
  } as any);
  const id = parse(syncResult).data.conversations[0].id;

  const result = await handler({
    httpMethod: 'POST',
    rawUrl: `/api/whatsapp-conversations/${id}/extract-quote`,
    body: '{}',
    queryStringParameters: {},
    headers: {},
  } as any);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(parse(result).data.extractedPayload.orders, [
    { produto: 'Canga', quantidade: 100 },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/whatsapp-conversations.test.ts
```

Expected: the new tests fail with `Endpoint não encontrado.` or missing injected
functions.

- [ ] **Step 3: Add dependencies and helpers to handler**

In `api/_functions/whatsapp-conversations.ts`, add imports:

```ts
import { handler as extractHandler } from './extract.js';
import { upsertQuoteLead } from './lib/quote-leads-store.js';
import { getWhatsappConversation } from './lib/whatsapp-conversations-store.js';
```

Add types near the imports:

```ts
interface WhatsappActionDeps extends EvolutionSyncDeps, WhatsappConversationStoreDeps {
  extractOrders?: (text: string) => Promise<unknown[]>;
  upsertQuoteLead?: (input: Record<string, unknown>) => Promise<unknown>;
}
```

Replace the `createHandler` signature:

```ts
export function createHandler(deps?: WhatsappActionDeps): LegacyHandler {
```

Add helper functions before `createHandler`:

```ts
function buildConversationText(messages: Array<{ direction: string; body: string }>): string {
  return messages
    .filter((message) => message.body)
    .slice(-50)
    .map((message) => `${message.direction === 'outbound' ? 'Aspen' : 'Cliente'}: ${message.body}`)
    .join('\n');
}

async function liveExtractOrders(text: string): Promise<unknown[]> {
  const result = await extractHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ text }),
    queryStringParameters: {},
    headers: {},
  } as FunctionEvent);
  const body = JSON.parse(result.body || '{}');
  if (result.statusCode >= 400) {
    throw createHttpError(result.statusCode, body.error || 'Erro ao extrair orçamento.');
  }
  return Array.isArray(body.orders) ? body.orders : [];
}

function missingFieldsForPreQuote(input: {
  nome: string;
  telefone: string;
  pedidoTexto: string;
}): string[] {
  const missing: string[] = [];
  if (!input.nome) missing.push('nome');
  if (!input.telefone) missing.push('contato');
  if (!input.pedidoTexto) missing.push('pedido');
  return missing;
}
```

- [ ] **Step 4: Add extract and pre-quote routes**

Inside the handler, before the final 404 branch, add:

```ts
if (event.httpMethod === 'POST' && parts.length === 2 && parts[1] === 'extract-quote') {
  const conversation = await getWhatsappConversation(parts[0], deps);
  const messages = await getWhatsappMessages(parts[0], deps);
  const text = buildConversationText(messages);
  const extractOrders = deps?.extractOrders || liveExtractOrders;
  const orders = await extractOrders(text);

  const data = {
    conversationId: conversation.id,
    inputMessageIds: messages.map((message) => message.id),
    extractedPayload: { orders },
    confidence: orders.length > 0 ? 0.8 : 0.2,
    missingFields: orders.length > 0 ? [] : ['pedido'],
    createdAt: new Date().toISOString(),
  };

  return jsonResponse(200, { success: true, data });
}

if (event.httpMethod === 'POST' && parts.length === 2 && parts[1] === 'create-quote-lead') {
  const conversation = await getWhatsappConversation(parts[0], deps);
  const messages = await getWhatsappMessages(parts[0], deps);
  const body = parseJsonBody(event.body);
  const pedidoTexto = buildConversationText(messages);
  const leadInput = {
    nome: conversation.displayName,
    telefone: conversation.phone,
    pedidoTexto,
    source: 'whatsapp',
    sourceDetail: conversation.remoteJid,
    externalId: conversation.id,
    status: missingFieldsForPreQuote({
      nome: conversation.displayName,
      telefone: conversation.phone,
      pedidoTexto,
    }).length
      ? 'incomplete'
      : 'ready',
    raw: {
      conversationId: conversation.id,
      extractedPayload: body.extractedPayload || null,
    },
  };

  const createLead = deps?.upsertQuoteLead || upsertQuoteLead;
  const data = await createLead(leadInput);
  await updateWhatsappConversation(
    conversation.id,
    { status: 'quote_lead_created', linkedLeadId: (data as { id?: string }).id || null },
    deps
  );

  return jsonResponse(201, { success: true, data });
}
```

- [ ] **Step 5: Run handler tests**

Run:

```bash
npm run build:api && TZ=UTC node --test tests/unit/whatsapp-conversations.test.ts
```

Expected: all tests in `whatsapp-conversations.test.ts` pass.

- [ ] **Step 6: Commit**

```bash
git add api/_functions/whatsapp-conversations.ts tests/unit/whatsapp-conversations.test.ts
git commit -m "feat: create pre quotes from whatsapp conversations"
```

---

### Task 5: Frontend API Client and Inbox Page

**Files:**

- Create: `src/lib/whatsappInboxApi.ts`
- Create: `src/pages/WhatsAppInboxPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Layout.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**

- Consumes backend endpoints from Tasks 3 and 4.
- Produces route `#/whatsapp-inbox` and navigation item `WhatsApp`.

- [ ] **Step 1: Create frontend API wrapper**

Create `src/lib/whatsappInboxApi.ts`:

```ts
import { apiGet, apiPatch, apiPost } from '@/lib/api';

export type WhatsappConversationStatus =
  | 'new'
  | 'needs_quote'
  | 'incomplete'
  | 'quote_lead_created'
  | 'quotation_created'
  | 'waiting_customer'
  | 'closed'
  | 'ignored';

export interface WhatsappConversation {
  id: string;
  remoteJid: string;
  phone: string;
  displayName: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  linkedLeadId?: string | null;
  linkedDealId?: string | null;
  linkedQuotationId?: string | null;
  status: WhatsappConversationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsappMessage {
  id: string;
  conversationId: string;
  providerMessageId: string;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'document' | 'audio' | 'unknown';
  body: string;
  mediaUrl: string;
  timestamp: string;
}

export interface WhatsappExtractionResult {
  conversationId: string;
  inputMessageIds: string[];
  extractedPayload: { orders?: unknown[]; [key: string]: unknown };
  confidence: number;
  missingFields: string[];
  createdAt: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export async function fetchWhatsappConversations(params: {
  status?: WhatsappConversationStatus | 'all';
  q?: string;
  limit?: number;
}): Promise<WhatsappConversation[]> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.q) search.set('q', params.q);
  if (params.limit) search.set('limit', String(params.limit));
  const suffix = search.toString() ? `?${search.toString()}` : '';
  const result = await apiGet<ApiEnvelope<WhatsappConversation[]>>(
    `/whatsapp-conversations${suffix}`
  );
  return result.data;
}

export async function fetchWhatsappMessages(conversationId: string): Promise<WhatsappMessage[]> {
  const result = await apiGet<ApiEnvelope<WhatsappMessage[]>>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/messages`
  );
  return result.data;
}

export async function syncWhatsappConversations(): Promise<{
  conversations: WhatsappConversation[];
  syncedMessages: number;
}> {
  const result = await apiPost<
    ApiEnvelope<{ conversations: WhatsappConversation[]; syncedMessages: number }>
  >('/whatsapp-conversations/sync', { chatLimit: 5, messageLimit: 50 });
  return result.data;
}

export async function extractWhatsappQuote(
  conversationId: string
): Promise<WhatsappExtractionResult> {
  const result = await apiPost<ApiEnvelope<WhatsappExtractionResult>>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/extract-quote`,
    {}
  );
  return result.data;
}

export async function createWhatsappPreQuote(
  conversationId: string,
  extractedPayload?: Record<string, unknown>
): Promise<unknown> {
  const result = await apiPost<ApiEnvelope<unknown>>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}/create-quote-lead`,
    { extractedPayload }
  );
  return result.data;
}

export async function updateWhatsappConversationStatus(
  conversationId: string,
  status: WhatsappConversationStatus
): Promise<WhatsappConversation> {
  const result = await apiPatch<ApiEnvelope<WhatsappConversation>>(
    `/whatsapp-conversations/${encodeURIComponent(conversationId)}`,
    { status }
  );
  return result.data;
}
```

- [ ] **Step 2: Create inbox page**

Create `src/pages/WhatsAppInboxPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, MessageCircle, RefreshCw, Search } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtPhone, formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import {
  createWhatsappPreQuote,
  extractWhatsappQuote,
  fetchWhatsappConversations,
  fetchWhatsappMessages,
  syncWhatsappConversations,
  updateWhatsappConversationStatus,
  type WhatsappConversation,
  type WhatsappConversationStatus,
  type WhatsappExtractionResult,
  type WhatsappMessage,
} from '@/lib/whatsappInboxApi';

const STATUS_FILTERS: Array<{ value: WhatsappConversationStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'new', label: 'Novas' },
  { value: 'needs_quote', label: 'Pedido detectado' },
  { value: 'quote_lead_created', label: 'Pré-orçamento' },
  { value: 'waiting_customer', label: 'Aguardando cliente' },
  { value: 'closed', label: 'Encerradas' },
];

function statusLabel(status: WhatsappConversationStatus): string {
  if (status === 'needs_quote') return 'Pedido detectado';
  if (status === 'incomplete') return 'Incompleta';
  if (status === 'quote_lead_created') return 'Pré-orçamento';
  if (status === 'quotation_created') return 'Orçamento criado';
  if (status === 'waiting_customer') return 'Aguardando cliente';
  if (status === 'closed') return 'Encerrada';
  if (status === 'ignored') return 'Ignorada';
  return 'Nova';
}

interface WhatsAppInboxPageProps {
  navigate?: (path: string) => void;
}

export default function WhatsAppInboxPage({ navigate }: WhatsAppInboxPageProps) {
  const [status, setStatus] = useState<WhatsappConversationStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<WhatsappConversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<WhatsappMessage[]>([]);
  const [extraction, setExtraction] = useState<WhatsappExtractionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) || conversations[0] || null,
    [conversations, selectedId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWhatsappConversations({ status, q: query, limit: 50 });
      setConversations(data);
      setSelectedId((current) =>
        current && data.some((item) => item.id === current) ? current : data[0]?.id || ''
      );
    } catch (err) {
      setError((err as Error).message || 'Erro ao carregar conversas do WhatsApp.');
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected?.id) {
      setMessages([]);
      setExtraction(null);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);
    setExtraction(null);
    fetchWhatsappMessages(selected.id)
      .then((data) => {
        if (!cancelled) setMessages(data);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || 'Erro ao carregar mensagens.');
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  const sync = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await syncWhatsappConversations();
      await load();
    } catch (err) {
      setError((err as Error).message || 'Erro ao sincronizar WhatsApp.');
    } finally {
      setSaving(false);
    }
  }, [load]);

  const extract = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const data = await extractWhatsappQuote(selected.id);
      setExtraction(data);
    } catch (err) {
      setError((err as Error).message || 'Erro ao extrair orçamento da conversa.');
    } finally {
      setSaving(false);
    }
  }, [selected]);

  const createPreQuote = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await createWhatsappPreQuote(selected.id, extraction?.extractedPayload);
      const updated = await updateWhatsappConversationStatus(selected.id, 'quote_lead_created');
      setConversations((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      navigate?.('/pre-orcamentos');
    } catch (err) {
      setError((err as Error).message || 'Erro ao criar pré-orçamento.');
    } finally {
      setSaving(false);
    }
  }, [extraction?.extractedPayload, navigate, selected]);

  return (
    <div className="mx-auto max-w-[1320px] space-y-5 pb-10 animate-fade-in">
      <PageHeader title="WhatsApp" />

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setStatus(item.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                status === item.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-muted text-fg-muted hover:text-fg'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:w-80">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar nome, telefone ou mensagem…"
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading || saving}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Atualizar
            </Button>
            <Button onClick={sync} disabled={saving}>
              <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
              Sincronizar
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold text-fg">
            Conversas
          </div>
          {loading ? (
            <div className="space-y-2 p-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-20 animate-pulse rounded-lg bg-surface-muted" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-sm text-fg-muted">
              Nenhuma conversa encontrada.
            </div>
          ) : (
            <div className="max-h-[680px] overflow-y-auto p-2">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={cn(
                    'w-full rounded-lg p-3 text-left transition-colors hover:bg-surface-muted',
                    selected?.id === conversation.id && 'bg-primary/5 ring-1 ring-primary/20'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">
                        {conversation.displayName || 'Contato sem nome'}
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {fmtPhone(conversation.phone) || conversation.remoteJid}
                      </p>
                    </div>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">
                      {statusLabel(conversation.status)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-fg-muted">
                    {conversation.lastMessagePreview || 'Sem prévia de mensagem'}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-h-[560px] rounded-xl border border-line bg-surface shadow-sm">
          {!selected ? (
            <div className="flex min-h-[560px] flex-col items-center justify-center text-fg-muted">
              <MessageCircle size={36} className="mb-3 opacity-50" />
              Selecione uma conversa.
            </div>
          ) : (
            <>
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">{selected.displayName}</h2>
                <p className="text-xs text-fg-muted">{fmtPhone(selected.phone)}</p>
              </div>
              <div className="max-h-[620px] space-y-3 overflow-y-auto p-4">
                {messagesLoading ? (
                  <div className="text-sm text-fg-muted">Carregando mensagens…</div>
                ) : messages.length === 0 ? (
                  <div className="text-sm text-fg-muted">Sem mensagens sincronizadas.</div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                        message.direction === 'outbound'
                          ? 'ml-auto bg-primary text-primary-foreground'
                          : 'bg-surface-muted text-fg'
                      )}
                    >
                      <p>{message.body || `[${message.type}]`}</p>
                      <p className="mt-1 text-[10px] opacity-70">{formatDate(message.timestamp)}</p>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </section>

        <aside className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-fg">Painel comercial</h2>
          {selected ? (
            <div className="mt-4 space-y-4 text-sm">
              <div className="rounded-lg bg-surface-muted p-3 text-fg-muted">
                <p>Telefone: {fmtPhone(selected.phone) || 'Não identificado'}</p>
                <p>Status: {statusLabel(selected.status)}</p>
                <p>Atualizado: {formatDate(selected.updatedAt)}</p>
                <p>Orçamento: {selected.linkedQuotationId || 'Nenhum vínculo'}</p>
              </div>

              <Button
                className="w-full"
                onClick={extract}
                disabled={saving || messages.length === 0}
              >
                <Bot size={14} />
                Extrair orçamento
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={createPreQuote}
                disabled={saving || !selected.phone}
              >
                Criar pré-orçamento
              </Button>

              {extraction && (
                <div className="rounded-lg border border-line p-3">
                  <p className="mb-2 text-xs font-semibold uppercase text-fg-muted">Extração</p>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-fg-muted">
                    {JSON.stringify(extraction.extractedPayload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-fg-muted">Selecione uma conversa.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Register route in App**

Modify `src/App.tsx` imports:

```ts
const WhatsAppInboxPage = lazy(() => import('@/pages/WhatsAppInboxPage'));
```

Add switch case:

```tsx
case '/whatsapp-inbox':
  page = <WhatsAppInboxPage navigate={navigate} />;
  break;
```

- [ ] **Step 4: Register breadcrumb**

Modify `src/components/layout/Layout.tsx` `PAGE_LABELS`:

```ts
'/whatsapp-inbox': 'WhatsApp',
```

- [ ] **Step 5: Register sidebar item**

Modify `src/components/layout/Sidebar.tsx` under the `Operacional` items:

```ts
{ hash: '/whatsapp-inbox', label: 'WhatsApp', icon: MessageCircle },
```

Place it after `Pré-orçamentos` so the lead flow stays grouped.

- [ ] **Step 6: Run frontend/build verification**

Run:

```bash
npm run build
```

Expected: TypeScript API build and Vite build complete with exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsappInboxApi.ts src/pages/WhatsAppInboxPage.tsx \
  src/App.tsx src/components/layout/Layout.tsx src/components/layout/Sidebar.tsx
git commit -m "feat: add whatsapp inbox page"
```

---

### Task 6: Documentation and Final Verification

**Files:**

- Modify: `docs/pre-orcamentos-inbox.md`

**Interfaces:**

- Consumes completed backend/frontend feature.
- Produces operator documentation and verification evidence.

- [ ] **Step 1: Update docs**

Modify `docs/pre-orcamentos-inbox.md` source list:

```md
- `whatsapp`: conversas sincronizadas pela Inbox Comercial em `#/whatsapp-inbox`.
```

Add a short section after `## Rollout`:

```md
## WhatsApp Inbox

A Inbox Comercial de WhatsApp fica em `#/whatsapp-inbox`.

Fluxo recomendado:

1. Clique em `Sincronizar` para buscar conversas recentes da Evolution API.
2. Abra uma conversa e confira o painel comercial.
3. Clique em `Extrair orçamento` quando a conversa tiver pedido em texto livre.
4. Revise o payload extraído.
5. Clique em `Criar pré-orçamento` para enviar a conversa para `#/pre-orcamentos`.
6. Continue o fluxo existente para revisar e gerar o orçamento.

O MVP não substitui o WhatsApp Web e não responde mensagens pelo dashboard.
```

- [ ] **Step 2: Run unit tests for new modules**

Run:

```bash
TZ=UTC node --test tests/unit/whatsapp-conversations-store.test.ts \
  tests/unit/whatsapp-conversations-sync.test.ts \
  tests/unit/whatsapp-conversations.test.ts
```

Expected: all new unit tests pass.

- [ ] **Step 3: Run full unit suite**

Run:

```bash
npm run test:unit
```

Expected: all unit tests pass.

- [ ] **Step 4: Run lint and build**

Run:

```bash
npm run lint && npm run build
```

Expected: lint completes with 0 errors and build exits 0.

- [ ] **Step 5: Run final diagnostics**

Run through pi:

```text
lens_diagnostics mode=all severity=all
```

Expected: no blocking errors in edited files.

- [ ] **Step 6: Manual smoke test**

Run local servers in two terminals:

```bash
node scripts/dev-api-server.mjs
npm run dev
```

Open `http://localhost:5173/#/whatsapp-inbox` and verify:

1. Page renders with `WhatsApp` title.
2. Sidebar contains `WhatsApp`.
3. Empty state appears if no conversations are synced.
4. `Sincronizar` either loads recent conversations or shows a Portuguese
   configuration/provider error.
5. Selecting a conversation loads messages.
6. `Extrair orçamento` shows extraction JSON when OpenRouter is configured.
7. `Criar pré-orçamento` creates an item visible in `#/pre-orcamentos` with
   source `WhatsApp`.

- [ ] **Step 7: Commit docs**

```bash
git add docs/pre-orcamentos-inbox.md
git commit -m "docs: document whatsapp inbox workflow"
```

---

## Self-Review Checklist

- Spec coverage:
  - Conversation list: Task 3 backend, Task 5 frontend.
  - Open conversation and messages: Task 3 backend, Task 5 frontend.
  - CRM/commercial panel: Task 5 displays known links and contact fields.
  - Pre-quote creation: Task 4 backend, Task 5 frontend.
  - Quote extraction: Task 4 backend, Task 5 frontend.
  - On-demand Evolution sync: Task 2 backend, Task 3 route, Task 5 button.
  - Portuguese safe errors: Tasks 1, 2, 3, 4.
  - Route maps kept in sync: Task 3.
  - Docs: Task 6.
- Intentional MVP gap: full CRM lead/deal search by phone/e-mail is limited to
  stored linked fields in this plan. Add ERPNext enrichment in a follow-up task
  after validating inbox usage, so this MVP stays focused and shippable.
- Placeholder scan: no planned step depends on unspecified code or new packages.
- Type consistency: frontend and backend statuses use the same literal union.
