# WhatsApp Identity Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate WhatsApp conversation identity into three distinct layers—provider conversation id, canonical business phone, and display label—with a central resolver, provenance tracking, and complete historical backfill.

**Architecture:** A single `resolveWhatsappIdentity(...)` function becomes the sole source of truth for identity decisions. Every flow (sync, store, CRM match, pre-quote, lead creation, send, UI) reads identity from its output. Old `phone`/`displayName` fields are preserved for backward compatibility while new canonical fields take over as primary sources of business truth.

**Tech Stack:** TypeScript ESM Vercel functions, React 19 + Vite 6, Node `node:test`, Playwright, Evolution API WhatsApp provider.

## Global Constraints

- ESM only — `.js` imports require explicit extension; standalone scripts use `.mjs`.
- Frontend source lives in `src/` as `.ts`/`.tsx` and uses the `@/*` alias.
- No new dependencies without explicit approval.
- User-facing API errors must stay in Brazilian Portuguese.
- Do not reuse `linkedLeadId` for CRM lead/customer matching; keep pre-orçamento links intact.
- Do not expose raw ERPNext stack traces or error bodies to the UI.
- `remoteJid` stays persisted for backward compatibility; `canonicalPhone` becomes the truth.
- Old fields `phone` and `displayName` coexist with new `canonicalPhone` and `displayLabel` during transition.
- Never derive business identity from `@lid` or opaque ids.
- Evidence with higher confidence must not be overwritten by weaker evidence.
- Conflict in identity → fail closed (block automations, keep inbox operational).

## File Structure

- Create: `api/_functions/lib/whatsapp-identity-resolver.ts` — central identity resolver (new file)
- Modify: `api/_functions/lib/whatsapp-conversations-store.ts` — add canonical fields, keep compat
- Modify: `api/_functions/lib/whatsapp-conversations-sync.ts` — delegate to resolver, remove inline phone logic
- Modify: `api/_functions/whatsapp-conversations.ts` — use canonicalPhone/displayLabel in all actions
- Modify: `api/_functions/lib/whatsapp-crm-match.ts` — use canonicalPhone, respect identityStatus
- Modify: `src/lib/formatters.ts` — fix fmtPhone for DDI, add normalizePhoneDigitsE164
- Modify: `src/lib/whatsappInboxApi.ts` — add canonicalPhone/displayLabel/identityStatus to types
- Modify: `src/pages/WhatsAppInboxPage.tsx` — use displayLabel/canonicalPhone, never show providerConversationId as phone
- Create: `api/_functions/lib/whatsapp-identity-backfill.ts` — backfill logic
- Test: `tests/unit/whatsapp-identity-resolver.test.ts`
- Test: `tests/unit/whatsapp-conversations-store.test.ts` (extend)
- Test: `tests/unit/whatsapp-conversations-sync.test.ts` (extend)
- Test: `tests/unit/whatsapp-conversations.test.ts` (extend)
- Test: `tests/unit/whatsapp-crm-match.test.ts` (extend)
- Test: `tests/unit/formatters.test.ts` (extend)
- Test: `tests/whatsapp-inbox.spec.js` (extend)

---

### Task 1: Central identity resolver

**Files:**

- Create: `api/_functions/lib/whatsapp-identity-resolver.ts`
- Test: `tests/unit/whatsapp-identity-resolver.test.ts`

**Interfaces:**

- Produces: `ResolvedWhatsappIdentity`, `resolveWhatsappIdentity(...)` — the single identity decision point for all flows.
- Uses: `normalizeWhatsappPhone`, `normalizeWhatsappPhoneFromRemoteJid` from store (existing).

- [ ] **Step 1: Write failing tests for the resolver**

Create `tests/unit/whatsapp-identity-resolver.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhatsappIdentity } from '../../api/_functions/lib/whatsapp-identity-resolver.js';

describe('whatsapp-identity-resolver', () => {
  it('derives canonicalPhone from chat.phone with high confidence', () => {
    const result = resolveWhatsappIdentity({
      chat: { phone: '5521981858541', pushName: 'Maria Souza' },
    });
    assert.equal(result.providerConversationId, '');
    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.displayLabel, 'Maria Souza');
    assert.equal(result.identityStatus, 'verified');
    assert.equal(result.identityConfidence, 'high');
    assert.equal(result.identitySource, 'chat.phone');
  });

  it('prefers senderPn over lid remoteJid', () => {
    const result = resolveWhatsappIdentity({
      chat: {
        remoteJid: '183792384719283741@lid',
        senderPn: '5521981858541',
        pushName: 'Maria',
      },
    });
    assert.equal(result.providerConversationId, '183792384719283741@lid');
    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.identityConfidence, 'high');
    assert.equal(result.identitySource, 'chat.senderPn');
  });

  it('rejects lid as canonicalPhone when no explicit phone exists', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '183792384719283741@lid', pushName: 'Cliente' },
    });
    assert.equal(result.providerConversationId, '183792384719283741@lid');
    assert.equal(result.canonicalPhone, '');
    assert.equal(result.identityStatus, 'unresolved');
    assert.equal(result.identityConfidence, null);
  });

  it('accepts remoteJid as canonicalPhone only when numeric JID', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '5521981858541@s.whatsapp.net', pushName: 'João' },
    });
    assert.equal(result.providerConversationId, '5521981858541@s.whatsapp.net');
    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.identityStatus, 'derived');
    assert.equal(result.identityConfidence, 'medium');
    assert.equal(result.identitySource, 'providerConversationId');
  });

  it('uses message participant as high-confidence source', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '183792384719283741@lid', pushName: 'Cliente' },
      messages: [
        {
          key: { participant: '5521981858541@s.whatsapp.net', fromMe: false },
          message: { conversation: 'Oi' },
        },
      ],
    });
    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.identityStatus, 'verified');
    assert.equal(result.identityConfidence, 'high');
    assert.equal(result.identitySource, 'message.key.participant');
  });

  it('preserves existing canonicalPhone when new evidence is weaker', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '183792384719283741@lid', pushName: 'Cliente' },
      storedConversation: {
        canonicalPhone: '5521981858541',
        identityStatus: 'verified',
        identityConfidence: 'high',
      },
    });
    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.identityStatus, 'verified');
    assert.equal(result.identityConfidence, 'high');
  });

  it('upgrades identity when new evidence is stronger', () => {
    const result = resolveWhatsappIdentity({
      chat: { phone: '5521981858541', pushName: 'Maria' },
      storedConversation: {
        canonicalPhone: '5521981858541',
        identityStatus: 'derived',
        identityConfidence: 'medium',
        identitySource: 'providerConversationId',
      },
    });
    assert.equal(result.identityStatus, 'verified');
    assert.equal(result.identityConfidence, 'high');
    assert.equal(result.identitySource, 'chat.phone');
  });

  it('sets displayLabel to name when available', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '5521981858541@s.whatsapp.net', pushName: 'João Silva' },
    });
    assert.equal(result.displayLabel, 'João Silva');
  });

  it('sets displayLabel to canonicalPhone when no name exists', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '5521981858541@s.whatsapp.net' },
    });
    assert.equal(result.displayLabel, '5521981858541');
  });

  it('marks conflict when two strong sources disagree', () => {
    const result = resolveWhatsappIdentity({
      chat: { phone: '5511999999999', senderPn: '5521888888888', pushName: 'Cliente' },
    });
    assert.equal(result.identityStatus, 'conflict');
    assert.equal(result.canonicalPhone, '');
  });

  it('ignores message content (text body) as phone source', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '183792384719283741@lid', pushName: 'Cliente' },
      messages: [
        {
          key: { fromMe: false },
          message: { conversation: 'meu numero é 5521981858541' },
        },
      ],
    });
    assert.equal(result.canonicalPhone, '');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TZ=UTC node --test tests/unit/whatsapp-identity-resolver.test.ts`
Expected: FAIL — `resolveWhatsappIdentity` not exported.

- [ ] **Step 3: Implement the resolver**

Create `api/_functions/lib/whatsapp-identity-resolver.ts`:

```ts
// whatsapp-identity-resolver.ts
// Single source of truth for WhatsApp contact identity.
// Separates: provider conversation id, canonical business phone, display label.

import {
  cleanText,
  normalizeWhatsappPhone,
  normalizeWhatsappPhoneFromRemoteJid,
} from './whatsapp-conversations-store.js';

export type IdentityStatus = 'verified' | 'derived' | 'unresolved' | 'conflict';
export type IdentityConfidence = 'high' | 'medium' | 'low';
export type IdentitySource =
  | 'chat.phone'
  | 'chat.senderPn'
  | 'message.key.participant'
  | 'message.from'
  | 'message.sender'
  | 'providerConversationId'
  | 'chat.participant'
  | 'chat.from'
  | 'chat.sender'
  | null;

export interface ResolvedWhatsappIdentity {
  providerConversationId: string;
  canonicalPhone: string;
  displayLabel: string;
  identityStatus: IdentityStatus;
  identitySource: IdentitySource;
  identityConfidence: IdentityConfidence | null;
}

interface SourceResult {
  phone: string;
  source: IdentitySource;
  confidence: IdentityConfidence;
}

function readRemoteJid(chat: Record<string, unknown>): string {
  return cleanText(chat.remoteJid || chat.id || chat.jid || chat.key);
}

function readHighConfidenceSources(
  chat: Record<string, unknown>,
  messages: Array<Record<string, unknown>>
): SourceResult[] {
  const results: SourceResult[] = [];

  // chat.phone
  const chatPhone = normalizeWhatsappPhone(chat.phone);
  if (chatPhone) results.push({ phone: chatPhone, source: 'chat.phone', confidence: 'high' });

  // chat.senderPn
  const senderPn = normalizeWhatsappPhone(chat.senderPn);
  if (senderPn) results.push({ phone: senderPn, source: 'chat.senderPn', confidence: 'high' });

  // chat.participant
  const chatParticipant = normalizeWhatsappPhone(chat.participant);
  if (chatParticipant) results.push({ phone: chatParticipant, source: 'chat.participant', confidence: 'high' });

  // chat.from
  const chatFrom = normalizeWhatsappPhone(chat.from);
  if (chatFrom) results.push({ phone: chatFrom, source: 'chat.from', confidence: 'high' });

  // chat.sender
  const chatSender = normalizeWhatsappPhone(chat.sender);
  if (chatSender) results.push({ phone: chatSender, source: 'chat.sender', confidence: 'high' });

  // message.key.participant (inbound)
  for (const msg of messages) {
    const key = (msg.key || {}) as Record<string, unknown>;
    if (key.fromMe === true) continue;
    const participant = normalizeWhatsappPhone(key.participant);
    if (participant) {
      results.push({ phone: participant, source: 'message.key.participant', confidence: 'high' });
    }
  }

  // message.from (inbound)
  for (const msg of messages) {
    if ((msg as Record<string, unknown>).fromMe === true) continue;
    const from = normalizeWhatsappPhone((msg as Record<string, unknown>).from);
    if (from) results.push({ phone: from, source: 'message.from', confidence: 'high' });
  }

  // message.sender (inbound)
  for (const msg of messages) {
    if ((msg as Record<string, unknown>).fromMe === true) continue;
    const sender = normalizeWhatsappPhone((msg as Record<string, unknown>).sender);
    if (sender) results.push({ phone: sender, source: 'message.sender', confidence: 'high' });
  }

  return results;
}

function readMediumConfidenceSource(chat: Record<string, unknown>): SourceResult | null {
  const remoteJid = readRemoteJid(chat);
  const phone = normalizeWhatsappPhoneFromRemoteJid(remoteJid);
  if (phone) return { phone, source: 'providerConversationId', confidence: 'medium' };
  return null;
}

function bestSource(
  highSources: SourceResult[],
  mediumSource: SourceResult | null,
  stored: Record<string, unknown> | null
): {
  canonicalPhone: string;
  identityStatus: IdentityStatus;
  identitySource: IdentitySource;
  identityConfidence: IdentityConfidence | null;
} {
  const storedPhone = cleanText(stored?.canonicalPhone);
  const storedStatus = cleanText(stored?.identityStatus) as IdentityStatus;
  const storedConfidence = cleanText(stored?.identityConfidence) as IdentityConfidence;

  // Resolve from fresh evidence first
  const uniqueHigh = [...new Map(highSources.map((s) => [s.phone, s])).values()];

  if (uniqueHigh.length === 1) {
    const s = uniqueHigh[0];
    return {
      canonicalPhone: s.phone,
      identityStatus: 'verified',
      identitySource: s.source,
      identityConfidence: 'high',
    };
  }

  if (uniqueHigh.length > 1) {
    // Conflict: multiple different high-confidence phones
    return {
      canonicalPhone: '',
      identityStatus: 'conflict',
      identitySource: null,
      identityConfidence: null,
    };
  }

  // No high-confidence source — try medium
  if (mediumSource) {
    const s = mediumSource;
    return {
      canonicalPhone: s.phone,
      identityStatus: 'derived',
      identitySource: s.source,
      identityConfidence: 'medium',
    };
  }

  // No evidence at all
  return {
    canonicalPhone: '',
    identityStatus: 'unresolved',
    identitySource: null,
    identityConfidence: null,
  };
}

function resolveDisplayLabel(chat: Record<string, unknown>, canonicalPhone: string): string {
  const name = cleanText(chat.pushName || chat.name || chat.notify);
  if (name) return name;
  if (canonicalPhone) return canonicalPhone;
  return cleanText(chat.pushName || chat.name || chat.notify || 'Contato sem nome');
}

function shouldKeepStored(
  freshCanonicalPhone: string,
  freshStatus: IdentityStatus,
  freshConfidence: IdentityConfidence | null,
  stored: Record<string, unknown> | null
): boolean {
  if (!stored) return false;
  const storedPhone = cleanText(stored.canonicalPhone);
  const storedConfidence = cleanText(stored.identityConfidence) as IdentityConfidence | '';

  if (!storedPhone) return false;

  // Stored is high, fresh is medium or worse → keep stored
  if (storedConfidence === 'high' && freshConfidence !== 'high') return true;

  // Stored exists, fresh is unresolved → keep stored
  if (freshStatus === 'unresolved' && storedPhone) return true;

  // Stored is medium, fresh is unresolved → keep stored
  if (freshStatus === 'unresolved' && storedConfidence === 'medium') return true;

  return false;
}

export function resolveWhatsappIdentity(input: {
  chat: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
  storedConversation?: Record<string, unknown> | null;
}): ResolvedWhatsappIdentity {
  const { chat, messages = [], storedConversation = null } = input;
  const providerConversationId = readRemoteJid(chat);

  const highSources = readHighConfidenceSources(chat, messages);
  const mediumSource = readMediumConfidenceSource(chat);

  const fresh = bestSource(highSources, mediumSource, null);

  if (shouldKeepStored(fresh.canonicalPhone, fresh.identityStatus, fresh.identityConfidence, storedConversation)) {
    const stored = storedConversation!;
    return {
      providerConversationId,
      canonicalPhone: cleanText(stored.canonicalPhone),
      displayLabel: resolveDisplayLabel(chat, cleanText(stored.canonicalPhone)),
      identityStatus: (cleanText(stored.identityStatus) as IdentityStatus) || 'derived',
      identitySource: (cleanText(stored.identitySource) as IdentitySource) || null,
      identityConfidence: (cleanText(stored.identityConfidence) as IdentityConfidence) || null,
    };
  }

  // Upgrade: stored was derived/medium, fresh is verified/high for the same phone
  if (
    storedConversation &&
    cleanText(storedConversation.canonicalPhone) === fresh.canonicalPhone &&
    fresh.identityConfidence === 'high' &&
    cleanText(storedConversation.identityConfidence) === 'medium'
  ) {
    return {
      providerConversationId,
      ...fresh,
      displayLabel: resolveDisplayLabel(chat, fresh.canonicalPhone),
    };
  }

  return {
    providerConversationId,
    ...fresh,
    displayLabel: resolveDisplayLabel(chat, fresh.canonicalPhone),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TZ=UTC node --test tests/unit/whatsapp-identity-resolver.test.ts`
Expected: PASS — all 12 tests.

- [ ] **Step 5: Commit**

```bash
git add api/_functions/lib/whatsapp-identity-resolver.ts tests/unit/whatsapp-identity-resolver.test.ts
git commit -m "feat: add central whatsapp identity resolver"
```

---

### Task 2: Store model — canonical fields + backward compatibility

**Files:**

- Modify: `api/_functions/lib/whatsapp-conversations-store.ts`
- Test: `tests/unit/whatsapp-conversations-store.test.ts`

**Interfaces:**

- Extends: `WhatsappConversation` with `providerConversationId`, `canonicalPhone`, `displayLabel`, `identityStatus`, `identitySource`, `identityConfidence`.
- Keeps: `remoteJid`, `phone`, `displayName` as compatibility aliases (set during normalization).
- Upgrades: `normalizeWhatsappConversationInput` and `upsertWhatsappConversation` to populate new fields.
- Adds: `updateWhatsappConversation` patch support for `canonicalPhone`, `displayLabel`, `identityStatus`, `identitySource`, `identityConfidence`.

- [ ] **Step 1: Write failing tests for new store fields**

Extend `tests/unit/whatsapp-conversations-store.test.ts` — add these tests after existing ones:

```ts
  it('populates canonicalPhone and providerConversationId during normalization', () => {
    const deps = makeDeps();
    const conversation = normalizeWhatsappConversationInput(
      {
        remoteJid: '5521981858541@s.whatsapp.net',
        phone: '5521981858541',
        displayName: 'Maria',
      },
      deps
    );

    assert.equal(conversation.providerConversationId, '5521981858541@s.whatsapp.net');
    assert.equal(conversation.canonicalPhone, '5521981858541');
    assert.equal(conversation.phone, '5521981858541'); // compat
    assert.equal(conversation.displayLabel, 'Maria');
    assert.equal(conversation.displayName, 'Maria'); // compat
    assert.equal(conversation.identityStatus, 'verified');
    assert.equal(conversation.identityConfidence, 'high');
  });

  it('preserves old remoteJid and phone for backward compatibility', () => {
    const deps = makeDeps();
    const conversation = normalizeWhatsappConversationInput(
      {
        remoteJid: '183792384719283741@lid',
        senderPn: '5521981858541',
        pushName: 'Maria',
      },
      deps
    );

    assert.equal(conversation.remoteJid, '183792384719283741@lid'); // compat stays
    assert.equal(conversation.providerConversationId, '183792384719283741@lid');
    assert.equal(conversation.canonicalPhone, '5521981858541');
    assert.equal(conversation.phone, '5521981858541'); // compat populated
    assert.equal(conversation.displayName, 'Maria'); // compat populated
    assert.equal(conversation.displayLabel, 'Maria');
  });

  it('sets identityStatus unresolved when no phone can be derived', () => {
    const deps = makeDeps();
    const conversation = normalizeWhatsappConversationInput(
      {
        remoteJid: '183792384719283741@lid',
        displayName: 'Cliente LID',
      },
      deps
    );

    assert.equal(conversation.canonicalPhone, '');
    assert.equal(conversation.phone, ''); // compat
    assert.equal(conversation.identityStatus, 'unresolved');
    assert.equal(conversation.identityConfidence, null);
  });

  it('preserves canonicalPhone on upsert when new payload has weaker evidence', async () => {
    const deps = makeDeps();

    const first = await upsertWhatsappConversation(
      {
        remoteJid: '183792384719283741@lid',
        senderPn: '5521981858541',
        displayName: 'Maria',
        lastMessagePreview: 'primeira',
        lastMessageAt: '2026-07-01T10:00:00.000Z',
      },
      deps
    );
    assert.equal(first.canonicalPhone, '5521981858541');
    assert.equal(first.identityConfidence, 'high');

    const second = await upsertWhatsappConversation(
      {
        remoteJid: '183792384719283741@lid',
        displayName: 'Maria Atualizada',
        lastMessagePreview: 'segunda',
        lastMessageAt: '2026-07-01T11:00:00.000Z',
      },
      deps
    );

    assert.equal(second.canonicalPhone, '5521981858541'); // preserved
    assert.equal(second.identityConfidence, 'high'); // preserved
    assert.equal(second.displayLabel, 'Maria Atualizada'); // updated
  });

  it('filters conversations by canonicalPhone in search', async () => {
    const deps = makeDeps();
    await upsertWhatsappConversation(
      { remoteJid: 'a@s.whatsapp.net', phone: '5521981858541', displayName: 'Maria' },
      deps
    );

    const results = await listWhatsappConversations({ q: '5521981858541' }, deps);
    assert.equal(results.length, 1);
  });
```

- [ ] **Step 2: Run store tests to verify they fail**

Run: `TZ=UTC node --test tests/unit/whatsapp-conversations-store.test.ts`
Expected: FAIL — new fields not present / wrong values.

- [ ] **Step 3: Update store interface and normalization**

In `api/_functions/lib/whatsapp-conversations-store.ts`:

**3a. Extend the `WhatsappConversation` interface:**

```ts
export interface WhatsappConversation {
  id: string;
  providerConversationId: string;       // NEW
  remoteJid: string;                     // compat alias
  canonicalPhone: string;                // NEW — business identity
  phone: string;                         // compat alias
  displayLabel: string;                  // NEW — visual label
  displayName: string;                   // compat alias
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict'; // NEW
  identitySource: string | null;         // NEW
  identityConfidence: 'high' | 'medium' | 'low' | null; // NEW
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
```

**3b. Import the resolver:**

Add at top:

```ts
import { resolveWhatsappIdentity } from './whatsapp-identity-resolver.js';
```

**3c. Rewrite `normalizeWhatsappConversationInput`:**

```ts
export function normalizeWhatsappConversationInput(
  input: Record<string, unknown>,
  deps: Pick<WhatsappConversationStoreDeps, 'now' | 'id'> = LIVE_DEPS
): WhatsappConversation {
  const now = deps.now();
  const identity = resolveWhatsappIdentity({ chat: input });

  return {
    id: cleanText(input.id) || deps.id(),
    providerConversationId: identity.providerConversationId,
    remoteJid: identity.providerConversationId,          // compat
    canonicalPhone: identity.canonicalPhone,
    phone: identity.canonicalPhone,                      // compat
    displayLabel: identity.displayLabel,
    displayName: identity.displayLabel,                  // compat
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
```

**3d. Update `upsertWhatsappConversation` to preserve identity fields:**

Add identity preservation in the update branch:

```ts
// Inside the if (index >= 0) block, add:
canonicalPhone: normalized.canonicalPhone || current.canonicalPhone || '',
displayLabel: normalized.displayLabel || current.displayLabel || '',
identityStatus: normalized.identityStatus !== 'unresolved'
  ? normalized.identityStatus
  : current.identityStatus || 'unresolved',
identitySource: normalized.identitySource || current.identitySource || null,
identityConfidence: normalized.identityConfidence || current.identityConfidence || null,
phone: normalized.phone || current.phone || '',       // compat
displayName: normalized.displayName || current.displayName || '', // compat
```

**3e. Update `listWhatsappConversations` filter:**

```ts
// Change filter line from:
return [item.displayName, item.phone, item.lastMessagePreview].some((value) =>
// To:
return [item.displayLabel, item.canonicalPhone, item.phone, item.lastMessagePreview].some((value) =>
```

**3f. Update `updateWhatsappConversation` to accept identity patch fields:**

Add these to the patch spread:

```ts
canonicalPhone:
  patch.canonicalPhone === undefined ? next[index].canonicalPhone : patch.canonicalPhone,
displayLabel:
  patch.displayLabel === undefined ? next[index].displayLabel : patch.displayLabel,
identityStatus:
  patch.identityStatus === undefined ? next[index].identityStatus : patch.identityStatus,
identitySource:
  patch.identitySource === undefined ? next[index].identitySource : patch.identitySource,
identityConfidence:
  patch.identityConfidence === undefined ? next[index].identityConfidence : patch.identityConfidence,
phone:
  patch.phone === undefined ? next[index].phone : patch.phone,
displayName:
  patch.displayName === undefined ? next[index].displayName : patch.displayName,
```

- [ ] **Step 4: Run store tests to verify they pass**

Run: `TZ=UTC node --test tests/unit/whatsapp-conversations-store.test.ts`
Expected: PASS — all tests including new ones.

- [ ] **Step 5: Commit**

```bash
git add api/_functions/lib/whatsapp-conversations-store.ts tests/unit/whatsapp-conversations-store.test.ts
git commit -m "feat: add canonical identity fields to whatsapp conversation store"
```

---

### Task 3: Sync delegates to identity resolver

**Files:**

- Modify: `api/_functions/lib/whatsapp-conversations-sync.ts`
- Test: `tests/unit/whatsapp-conversations-sync.test.ts`

**Interfaces:**

- Removes: inline `resolveConversationPhone`, `readMessagePhoneCandidates`, `firstNormalizedPhone`, `readRemoteJid` (replaced by resolver).
- Keeps: `normalizeEvolutionConversation` but delegates identity to resolver.
- Updates: `syncMessagesForConversation` to re-resolve identity with messages.

- [ ] **Step 1: Add failing sync tests with resolver integration**

Extend `tests/unit/whatsapp-conversations-sync.test.ts` — add after existing tests:

```ts
  it('populates identity fields via resolver during sync', async () => {
    const storeDeps = makeStoreDeps();
    const syncDeps = {
      ...storeDeps,
      fetchChats: async () => [
        {
          remoteJid: '5521981858541@s.whatsapp.net',
          phone: '5521981858541',
          pushName: 'Maria',
          updatedAt: 1782916800,
          lastMessage: { text: 'Oi' },
        },
      ],
      fetchMessages: async () => [],
    };

    const result = await syncWhatsappConversations({ chatLimit: 1, messageLimit: 10 }, syncDeps);
    const conv = result.conversations[0];

    assert.equal(conv.providerConversationId, '5521981858541@s.whatsapp.net');
    assert.equal(conv.canonicalPhone, '5521981858541');
    assert.equal(conv.displayLabel, 'Maria');
    assert.equal(conv.identityStatus, 'verified');
    assert.equal(conv.identityConfidence, 'high');
  });

  it('backsills canonicalPhone via resolver after message sync', async () => {
    const storeDeps = makeStoreDeps();
    const conversation = {
      id: 'wa_1',
      providerConversationId: '183792384719283741@lid',
      remoteJid: '183792384719283741@lid',
      canonicalPhone: '',
      phone: '',
      displayLabel: 'Cliente',
      displayName: 'Cliente',
      identityStatus: 'unresolved' as const,
      identitySource: null,
      identityConfidence: null,
      source: 'evolution' as const,
      status: 'new' as const,
      lastMessageAt: '2026-07-01T12:00:00.000Z',
      lastMessagePreview: 'Mensagem 1',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-01T12:00:00.000Z',
    };
    await storeDeps.writeConversations([conversation]);

    const syncDeps = {
      ...storeDeps,
      fetchMessages: async () => [
        {
          key: { id: 'm1', fromMe: false, participant: '5521981858541@s.whatsapp.net' },
          messageTimestamp: 1782916800,
          message: { conversation: 'Mensagem 1' },
        },
      ],
    };

    const updated = await syncMessagesForConversation(conversation as any, 100, syncDeps);
    assert.equal(updated.canonicalPhone, '5521981858541');
    assert.equal(updated.identityStatus, 'verified');
    assert.equal(updated.identityConfidence, 'high');
  });
```

- [ ] **Step 2: Run sync tests to verify they fail**

Run: `TZ=UTC node --test tests/unit/whatsapp-conversations-sync.test.ts`
Expected: FAIL — identity fields not on sync output.

- [ ] **Step 3: Rewrite sync to use resolver**

In `api/_functions/lib/whatsapp-conversations-sync.ts`:

**3a. Remove inline phone functions:**

Remove these functions (now in resolver):

- `readRemoteJid`
- `readMessagePhoneCandidates`
- `firstNormalizedPhone`
- `resolveConversationPhone`

**3b. Import resolver:**

```ts
import { resolveWhatsappIdentity } from './whatsapp-identity-resolver.js';
```

Keep `normalizeWhatsappPhone` and `normalizeWhatsappPhoneFromRemoteJid` imports (still used by normalizer).

**3c. Rewrite `normalizeEvolutionConversation`:**

```ts
export function normalizeEvolutionConversation(
  chat: Record<string, unknown>
): Record<string, unknown> | null {
  if (isGroupChat(chat)) return null;

  const identity = resolveWhatsappIdentity({ chat });

  if (!identity.providerConversationId && !identity.canonicalPhone) return null;

  return {
    remoteJid: identity.providerConversationId,
    phone: identity.canonicalPhone,
    displayName: identity.displayLabel,
    providerConversationId: identity.providerConversationId,
    canonicalPhone: identity.canonicalPhone,
    displayLabel: identity.displayLabel,
    identityStatus: identity.identityStatus,
    identitySource: identity.identitySource,
    identityConfidence: identity.identityConfidence,
    lastMessageAt: chat.updatedAt || chat.messageTimestamp || chat.t || Date.now(),
    lastMessagePreview: readLastMessageText(chat),
  };
}
```

**3d. Rewrite `syncWhatsappConversations`:**

Replace the phone-enrichment logic:

```ts
// Replace:
const normalizedChat = normalizeEvolutionConversation({
  ...chat,
  phone: resolveConversationPhone(chat, rawMessages),
});

// With:
const normalizedChat = normalizeEvolutionConversation(chat);
// Enrich with messages for better identity
if (rawMessages.length > 0) {
  const enriched = resolveWhatsappIdentity({ chat, messages: rawMessages });
  if (normalizedChat) {
    normalizedChat.canonicalPhone = enriched.canonicalPhone;
    normalizedChat.phone = enriched.canonicalPhone; // compat
    normalizedChat.identityStatus = enriched.identityStatus;
    normalizedChat.identitySource = enriched.identitySource;
    normalizedChat.identityConfidence = enriched.identityConfidence;
  }
}
```

**3e. Rewrite `syncMessagesForConversation`:**

```ts
export async function syncMessagesForConversation(
  conversation: WhatsappConversation,
  messageLimit = 100,
  deps?: EvolutionSyncDeps
): Promise<WhatsappConversation> {
  const limit = Math.max(1, Math.min(Number(messageLimit), 100));
  const fetchMessages = deps?.fetchMessages || liveFetchMessages;

  const rawMessages = await fetchMessages(conversation.remoteJid, limit);
  const normalized = rawMessages.map(normalizeEvolutionMessage).filter(Boolean) as Array<
    Record<string, unknown>
  >;
  await upsertWhatsappMessages(conversation.id, normalized, deps);

  // Re-resolve identity with fresh messages
  const identity = resolveWhatsappIdentity({
    chat: { remoteJid: conversation.remoteJid, pushName: conversation.displayLabel },
    messages: rawMessages,
    storedConversation: conversation,
  });

  if (
    identity.canonicalPhone !== conversation.canonicalPhone ||
    identity.identityStatus !== conversation.identityStatus
  ) {
    return upsertWhatsappConversation(
      {
        ...conversation,
        canonicalPhone: identity.canonicalPhone,
        phone: identity.canonicalPhone,             // compat
        displayLabel: identity.displayLabel,
        displayName: identity.displayLabel,          // compat
        identityStatus: identity.identityStatus,
        identitySource: identity.identitySource,
        identityConfidence: identity.identityConfidence,
      },
      deps
    );
  }

  return conversation;
}
```

- [ ] **Step 4: Run sync tests to verify they pass**

Run: `TZ=UTC node --test tests/unit/whatsapp-conversations-sync.test.ts`
Expected: PASS — all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add api/_functions/lib/whatsapp-conversations-sync.ts tests/unit/whatsapp-conversations-sync.test.ts
git commit -m "refactor: delegate whatsapp identity to central resolver in sync"
```

---

### Task 4: Handler switches to canonicalPhone for all actions

**Files:**

- Modify: `api/_functions/whatsapp-conversations.ts`
- Test: `tests/unit/whatsapp-conversations.test.ts`

**Interfaces:**

- All action handlers now read `conversation.canonicalPhone` instead of `conversation.phone`.
- All action handlers now read `conversation.displayLabel` instead of `conversation.displayName`.
- `create-quote-lead` blocks when `identityStatus` is `unresolved` or `conflict`.
- `send-message` blocks when `identityStatus` is `conflict` (but `unresolved` is OK for sending — provider has the thread).

- [ ] **Step 1: Add failing handler tests**

Extend `tests/unit/whatsapp-conversations.test.ts` — add after existing tests:

```ts
  it('blocks pre-quote creation when identityStatus is unresolved', async () => {
    const deps = makeActionDeps();
    deps.readConversations = async () => [
      {
        id: 'wa_1',
        providerConversationId: '183792384719283741@lid',
        remoteJid: '183792384719283741@lid',
        canonicalPhone: '',
        phone: '',
        displayLabel: 'Cliente LID',
        displayName: 'Cliente LID',
        identityStatus: 'unresolved',
        identitySource: null,
        identityConfidence: null,
        source: 'evolution',
        status: 'new',
        lastMessageAt: '2026-07-01T12:00:00.000Z',
        lastMessagePreview: 'Oi',
        createdAt: '2026-07-01T12:00:00.000Z',
        updatedAt: '2026-07-01T12:00:00.000Z',
      },
    ];
    deps.readMessages = async () => [
      {
        id: 'msg1',
        conversationId: 'wa_1',
        providerMessageId: 'm1',
        direction: 'inbound',
        type: 'text',
        body: 'Quero um orçamento',
        mediaUrl: '',
        timestamp: '2026-07-01T12:00:00.000Z',
      },
    ];

    const handler = createHandler(deps);
    const result = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'create-quote-lead', id: 'wa_1' }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 400);
    const body = JSON.parse(result.body);
    assert.ok(body.error?.includes('telefone') || body.error?.includes('identidade'));
  });

  it('uses canonicalPhone and displayLabel in pre-quote creation', async () => {
    const deps = makeActionDeps();
    let leadInput: any = null;
    deps.upsertQuoteLead = async (input) => {
      leadInput = input;
      return { id: 'QL-001' };
    };
    deps.readConversations = async () => [
      {
        id: 'wa_1',
        providerConversationId: '5521981858541@s.whatsapp.net',
        remoteJid: '5521981858541@s.whatsapp.net',
        canonicalPhone: '5521981858541',
        phone: '5521981858541',
        displayLabel: 'Maria Souza',
        displayName: 'Maria Souza',
        identityStatus: 'verified',
        identitySource: 'chat.phone',
        identityConfidence: 'high',
        source: 'evolution',
        status: 'new',
        lastMessageAt: '2026-07-01T12:00:00.000Z',
        lastMessagePreview: 'Oi',
        createdAt: '2026-07-01T12:00:00.000Z',
        updatedAt: '2026-07-01T12:00:00.000Z',
      },
    ];
    deps.readMessages = async () => [
      {
        id: 'msg1',
        conversationId: 'wa_1',
        providerMessageId: 'm1',
        direction: 'inbound',
        type: 'text',
        body: 'Orçamento',
        mediaUrl: '',
        timestamp: '2026-07-01T12:00:00.000Z',
      },
    ];

    const handler = createHandler(deps);
    const result = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'create-quote-lead', id: 'wa_1' }),
      queryStringParameters: {},
      headers: {},
    } as any);

    assert.equal(result.statusCode, 201);
    assert.equal(leadInput.nome, 'Maria Souza');
    assert.equal(leadInput.telefone, '5521981858541');
  });
```

- [ ] **Step 2: Run handler tests to verify fail**

Run: `TZ=UTC node --test tests/unit/whatsapp-conversations.test.ts`
Expected: FAIL — new test assertions.

- [ ] **Step 3: Update handler to use canonicalPhone**

In `api/_functions/whatsapp-conversations.ts`:

**3a. Update `create-quote-lead` action:**

Replace:

```ts
const leadInput = {
  nome: conversation.displayName,
  telefone: conversation.phone,
```

With:

```ts
if (conversation.identityStatus === 'unresolved' || conversation.identityStatus === 'conflict') {
  return jsonResponse(400, {
    error: 'Não é possível criar pré-orçamento com identidade do contato não confirmada.',
  });
}

const leadInput = {
  nome: conversation.displayLabel,
  telefone: conversation.canonicalPhone,
```

**3b. Update `send-message` action:**

Replace:

```ts
if (!conversation.phone) {
  return jsonResponse(400, { error: 'Conversa sem telefone para envio.' });
}
```

With:

```ts
if (conversation.identityStatus === 'conflict') {
  return jsonResponse(400, {
    error: 'Não é possível enviar mensagem com identidade do contato em conflito.',
  });
}
if (!conversation.canonicalPhone && conversation.identityStatus === 'unresolved') {
  // Allow send — provider has the thread even if phone is not canonical
}
```

**3c. Update `GET /api/whatsapp-conversations?id=...` response:**

No change needed — the response already spreads `conversation` which now includes new fields.

- [ ] **Step 4: Run handler tests to verify pass**

Run: `TZ=UTC node --test tests/unit/whatsapp-conversations.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add api/_functions/whatsapp-conversations.ts tests/unit/whatsapp-conversations.test.ts
git commit -m "refactor: use canonicalPhone and displayLabel in whatsapp handler actions"
```

---

### Task 5: CRM match uses canonicalPhone

**Files:**

- Modify: `api/_functions/lib/whatsapp-crm-match.ts`
- Test: `tests/unit/whatsapp-crm-match.test.ts`

**Interfaces:**

- `resolveWhatsappCrmMatch` now reads `conversation.canonicalPhone` instead of `conversation.phone`.
- Blocks auto-match when `identityStatus` is `unresolved` or `conflict`.

- [ ] **Step 1: Add failing CRM match tests**

Extend `tests/unit/whatsapp-crm-match.test.ts` — add after existing tests:

```ts
  it('uses canonicalPhone for phone matching', async () => {
    const deps = makeFakeDeps();
    deps.listLeads = async () => [
      { name: 'LEAD-001', first_name: 'Maria', mobile_no: '5521981858541', email_id: null },
    ];

    const conv = makeConversation({
      canonicalPhone: '5521981858541',
      phone: '',
      displayLabel: 'Maria',
    } as any);

    const result = await resolveWhatsappCrmMatch({ conversation: conv, deps });
    assert.equal(result?.id, 'LEAD-001');
    assert.equal(result?.matchSource, 'phone');
  });

  it('blocks CRM match when identityStatus is unresolved', async () => {
    const deps = makeFakeDeps();
    deps.listLeads = async () => [
      { name: 'LEAD-001', first_name: 'Maria', mobile_no: '5521981858541', email_id: null },
    ];

    const conv = makeConversation({
      canonicalPhone: '5521981858541',
      identityStatus: 'unresolved',
      identityConfidence: null,
    } as any);

    const result = await resolveWhatsappCrmMatch({ conversation: conv, deps });
    assert.equal(result, null);
  });
```

- [ ] **Step 2: Run CRM match tests to verify fail**

Run: `TZ=UTC node --test tests/unit/whatsapp-crm-match.test.ts`
Expected: FAIL — new assertions.

- [ ] **Step 3: Update CRM match to use canonicalPhone**

In `api/_functions/lib/whatsapp-crm-match.ts`:

**3a. Use `canonicalPhone` instead of `phone`:**

Replace all `conversation.phone` with `conversation.canonicalPhone`.

**3b. Add identityStatus gate:**

At the top of `resolveWhatsappCrmMatch`, after the saved-link check:

```ts
  // If identity is too weak, don't auto-match
  if (
    conversation.identityStatus === 'unresolved' ||
    conversation.identityStatus === 'conflict'
  ) {
    return null;
  }
```

- [ ] **Step 4: Run CRM match tests to verify pass**

Run: `TZ=UTC node --test tests/unit/whatsapp-crm-match.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
git add api/_functions/lib/whatsapp-crm-match.ts tests/unit/whatsapp-crm-match.test.ts
git commit -m "refactor: use canonicalPhone in crm match, respect identityStatus"
```

---

### Task 6: Phone formatter supports DDI

**Files:**

- Modify: `src/lib/formatters.ts`
- Test: `tests/unit/formatters.test.ts`

**Interfaces:**

- `fmtPhone` now handles full E.164 numbers with `55` prefix without truncation.
- New `normalizePhoneDigitsE164` that does NOT cap at 11 digits.

- [ ] **Step 1: Add failing formatter tests**

Extend `tests/unit/formatters.test.ts` — add after existing tests:

```ts
  it('formats complete E164 phone without truncating DDI', () => {
    assert.equal(fmtPhone('5521981858541'), '(55) 21 98185-8541');
    assert.equal(fmtPhone('55219999102299'), '(55) 21 99991-0229');
  });

  it('still formats local 11-digit numbers correctly', () => {
    assert.equal(fmtPhone('11999998888'), '(11) 99999-8888');
    assert.equal(fmtPhone('21981858541'), '(21) 98185-8541');
  });

  it('formats 10-digit local numbers', () => {
    assert.equal(fmtPhone('1199998888'), '(11) 9999-8888');
  });
```

- [ ] **Step 2: Run formatter tests to verify fail**

Run: `TZ=UTC node --test tests/unit/formatters.test.ts`
Expected: FAIL — DDI numbers are truncated.

- [ ] **Step 3: Rewrite fmtPhone and normalizePhoneDigits**

In `src/lib/formatters.ts`:

```ts
export function normalizePhoneDigits(phone: unknown, maxDigits = 15): string {
  return String(phone ?? '').replace(/\D/g, '').slice(0, maxDigits);
}

/** Formats Brazilian phone to (XX) XXXXX-XXXX or (55) XX XXXXX-XXXX for DDI */
export function fmtPhone(phone: unknown): string {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return '';

  // International with 55 prefix
  if (digits.startsWith('55') && digits.length >= 13) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) {
      return `(55) ${ddd} ${rest.slice(0, 5)}-${rest.slice(5)}`;
    }
    if (rest.length >= 8) {
      return `(55) ${ddd} ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
    }
  }

  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}
```

- [ ] **Step 4: Run formatter tests to verify pass**

Run: `TZ=UTC node --test tests/unit/formatters.test.ts`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/formatters.ts tests/unit/formatters.test.ts
git commit -m "fix: support full E164 numbers in phone formatter"
```

---

### Task 7: UI uses displayLabel / canonicalPhone

**Files:**

- Modify: `src/lib/whatsappInboxApi.ts`
- Modify: `src/pages/WhatsAppInboxPage.tsx`
- Test: `tests/whatsapp-inbox.spec.js`

**Interfaces:**

- Frontend types now include `displayLabel`, `canonicalPhone`, `identityStatus`.
- UI reads `displayLabel` for top line, `canonicalPhone` for bottom line.
- Never falls back to `remoteJid` for phone display.
- Shows `Telefone não identificado` when `canonicalPhone` is empty.

- [ ] **Step 1: Add failing Playwright test for UI identity**

Extend `tests/whatsapp-inbox.spec.js` — add before the last test:

```js
  test('shows displayLabel on top and canonicalPhone on bottom, never remoteJid', async ({
    page,
  }) => {
    let listingFulfilled = false;
    await page.route('**/api/whatsapp-conversations?status=all**', async (route) => {
      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: 'wa_1',
              providerConversationId: '183792384719283741@lid',
              remoteJid: '183792384719283741@lid',
              canonicalPhone: '5521981858541',
              displayLabel: 'Maria Souza',
              displayName: 'Maria Souza',
              identityStatus: 'verified',
              identityConfidence: 'high',
              status: 'new',
              lastMessageAt: '2026-07-01T12:00:00.000Z',
              lastMessagePreview: 'Oi',
              createdAt: '2026-07-01T12:00:00.000Z',
              updatedAt: '2026-07-01T12:00:00.000Z',
            },
            {
              id: 'wa_2',
              providerConversationId: '123456789012345@lid',
              remoteJid: '123456789012345@lid',
              canonicalPhone: '',
              displayLabel: 'Contato sem nome',
              displayName: 'Contato sem nome',
              identityStatus: 'unresolved',
              identityConfidence: null,
              status: 'new',
              lastMessageAt: '2026-07-01T12:00:00.000Z',
              lastMessagePreview: 'Olá',
              createdAt: '2026-07-01T12:00:00.000Z',
              updatedAt: '2026-07-01T12:00:00.000Z',
            },
          ],
        },
      });
      listingFulfilled = true;
    });

    await page.goto('/#/whatsapp-inbox');
    await page.waitForURL('**/#/whatsapp-inbox');

    // First conversation: name on top, formatted canonical phone on bottom
    await expect(page.locator('button').filter({ hasText: 'Maria Souza' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: '(55) 21 98185-8541' })).toBeVisible();

    // Second conversation: should show "Telefone não identificado", NOT the lid id
    await expect(page.locator('button').filter({ hasText: 'Contato sem nome' })).toBeVisible();
    await expect(page.getByText('Telefone não identificado')).toBeVisible();
    // remoteJid / lid should NEVER appear as phone
    const lidText = page.getByText('123456789012345@lid');
    await expect(lidText).toHaveCount(0);
  });
```

- [ ] **Step 2: Update frontend API types**

In `src/lib/whatsappInboxApi.ts`, add to `WhatsappConversation`:

```ts
export interface WhatsappConversation {
  id: string;
  providerConversationId: string;       // NEW
  remoteJid: string;
  canonicalPhone: string;                // NEW
  phone: string;
  displayLabel: string;                  // NEW
  displayName: string;
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict'; // NEW
  identitySource?: string | null;        // NEW
  identityConfidence?: 'high' | 'medium' | 'low' | null; // NEW
  lastMessageAt: string;
  lastMessagePreview: string;
  linkedLeadId?: string | null;
  linkedDealId?: string | null;
  linkedQuotationId?: string | null;
  status: WhatsappConversationStatus;
  createdAt: string;
  updatedAt: string;
}
```

**3a. Run Playwright test to verify fail**

Run: `npx playwright test tests/whatsapp-inbox.spec.js -g "shows displayLabel on top and canonicalPhone on bottom"`
Expected: FAIL.

- [ ] **Step 4: Update the inbox UI**

In `src/pages/WhatsAppInboxPage.tsx`:

**4a. Conversation list — top line:**

Replace:

```tsx
<p className="truncate text-sm font-medium text-fg">
  {conversation.displayName || 'Contato sem nome'}
</p>
```

With:

```tsx
<p className="truncate text-sm font-medium text-fg">
  {conversation.displayLabel || 'Contato sem nome'}
</p>
```

**4b. Conversation list — bottom line:**

Replace:

```tsx
<p className="truncate text-xs text-fg-muted">
  {fmtPhone(conversation.phone) || conversation.remoteJid}
</p>
```

With:

```tsx
<p className="truncate text-xs text-fg-muted">
  {fmtPhone(conversation.canonicalPhone) || 'Telefone não identificado'}
</p>
```

**4c. Selected conversation header:**

Replace:

```tsx
<h2 className="text-sm font-semibold text-fg">{selected.displayName}</h2>
<p className="text-xs text-fg-muted">{fmtPhone(selected.phone)}</p>
```

With:

```tsx
<h2 className="text-sm font-semibold text-fg">{selected.displayLabel}</h2>
<p className="text-xs text-fg-muted">{fmtPhone(selected.canonicalPhone) || 'Telefone não identificado'}</p>
```

**4d. Painel comercial phone display:**

Replace:

```tsx
<p>Telefone: {fmtPhone(selected.phone) || 'Não identificado'}</p>
```

With:

```tsx
<p>Telefone: {fmtPhone(selected.canonicalPhone) || 'Não identificado'}</p>
```

**4e. Pre-quote button disable:**

Replace:

```tsx
disabled={saving || !selected.phone}
```

With:

```tsx
disabled={saving || !selected.canonicalPhone || selected.identityStatus === 'unresolved' || selected.identityStatus === 'conflict'}
```

- [ ] **Step 5: Run Playwright tests to verify pass**

Run: `npx playwright test tests/whatsapp-inbox.spec.js`
Expected: PASS — all 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsappInboxApi.ts src/pages/WhatsAppInboxPage.tsx tests/whatsapp-inbox.spec.js
git commit -m "refactor: use displayLabel and canonicalPhone in whatsapp inbox ui"
```

---

### Task 8: Backfill script

**Files:**

- Create: `api/_functions/lib/whatsapp-identity-backfill.ts`
- Test: `tests/unit/whatsapp-identity-backfill.test.ts`

**Interfaces:**

- `backfillWhatsappIdentities(deps)` — reads all stored conversations, re-resolves identity with stored messages as evidence, updates canonical fields, logs counts.
- `recomputeWhatsappCrmLinks(deps)` — re-matches CRM for conversations whose canonicalPhone changed.

- [ ] **Step 1: Write failing backfill tests**

Create `tests/unit/whatsapp-identity-backfill.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backfillWhatsappIdentities } from '../../api/_functions/lib/whatsapp-identity-backfill.js';

describe('whatsapp-identity-backfill', () => {
  it('reprocesses conversations and fills canonicalPhone from stored phone', async () => {
    const deps = {
      readConversations: async () => [
        {
          id: 'wa_1',
          providerConversationId: '',
          remoteJid: '5521981858541@s.whatsapp.net',
          canonicalPhone: '',
          phone: '5521981858541',
          displayLabel: '',
          displayName: 'Maria',
          identityStatus: 'unresolved',
          identitySource: null,
          identityConfidence: null,
          source: 'evolution',
          status: 'new',
          lastMessageAt: '2026-07-01T12:00:00.000Z',
          lastMessagePreview: '',
          createdAt: '2026-07-01T12:00:00.000Z',
          updatedAt: '2026-07-01T12:00:00.000Z',
        },
      ],
      writeConversations: async (convs: any[]) => {
        assert.equal(convs.length, 1);
        assert.equal(convs[0].canonicalPhone, '5521981858541');
        assert.equal(convs[0].displayLabel, 'Maria');
        assert.equal(convs[0].identityStatus, 'derived');
        assert.equal(convs[0].identityConfidence, 'medium');
      },
      readMessages: async () => [],
      now: () => '2026-07-01T12:00:00.000Z',
    };

    const result = await backfillWhatsappIdentities(deps);
    assert.equal(result.total, 1);
    assert.equal(result.fixed, 1);
    assert.equal(result.unresolved, 0);
  });

  it('marks conversations as unresolved when no identity can be derived', async () => {
    const deps = {
      readConversations: async () => [
        {
          id: 'wa_2',
          providerConversationId: '',
          remoteJid: '183792384719283741@lid',
          canonicalPhone: '',
          phone: '',
          displayLabel: '',
          displayName: '',
          identityStatus: 'unresolved',
          identitySource: null,
          identityConfidence: null,
          source: 'evolution',
          status: 'new',
          lastMessageAt: '2026-07-01T12:00:00.000Z',
          lastMessagePreview: '',
          createdAt: '2026-07-01T12:00:00.000Z',
          updatedAt: '2026-07-01T12:00:00.000Z',
        },
      ],
      writeConversations: async (convs: any[]) => {
        assert.equal(convs[0].canonicalPhone, '');
        assert.equal(convs[0].identityStatus, 'unresolved');
      },
      readMessages: async () => [],
      now: () => '2026-07-01T12:00:00.000Z',
    };

    const result = await backfillWhatsappIdentities(deps);
    assert.equal(result.unresolved, 1);
  });
});
```

- [ ] **Step 2: Run backfill tests to verify fail**

Run: `TZ=UTC node --test tests/unit/whatsapp-identity-backfill.test.ts`
Expected: FAIL — `backfillWhatsappIdentities` not exported.

- [ ] **Step 3: Implement backfill**

Create `api/_functions/lib/whatsapp-identity-backfill.ts`:

```ts
// whatsapp-identity-backfill.ts
// Reprocesses stored WhatsApp conversations to populate canonical identity fields.

import { resolveWhatsappIdentity } from './whatsapp-identity-resolver.js';
import type { WhatsappConversation, WhatsappConversationStoreDeps } from './whatsapp-conversations-store.js';

interface BackfillDeps extends Pick<WhatsappConversationStoreDeps, 'readConversations' | 'writeConversations' | 'readMessages' | 'now'> {}

interface BackfillResult {
  total: number;
  fixed: number;
  unchanged: number;
  conflict: number;
  unresolved: number;
}

export async function backfillWhatsappIdentities(deps: BackfillDeps): Promise<BackfillResult> {
  const conversations = await deps.readConversations();
  const result: BackfillResult = { total: conversations.length, fixed: 0, unchanged: 0, conflict: 0, unresolved: 0 };

  const updated: WhatsappConversation[] = [];
  for (const conv of conversations) {
    const messages = await deps.readMessages(conv.id);
    const identity = resolveWhatsappIdentity({
      chat: { remoteJid: conv.remoteJid, pushName: conv.displayName || conv.displayLabel },
      messages: messages.map((m) => m.raw || m),
      storedConversation: conv,
    });

    const canonicalPhone = identity.canonicalPhone || conv.phone || '';
    const status = identity.identityStatus;
    const source = identity.identitySource;
    const confidence = identity.identityConfidence;

    if (canonicalPhone !== conv.canonicalPhone || conv.identityStatus !== status) {
      if (status === 'verified' || status === 'derived') result.fixed++;
      else if (status === 'conflict') result.conflict++;
      else result.unresolved++;
    } else {
      result.unchanged++;
    }

    updated.push({
      ...conv,
      providerConversationId: identity.providerConversationId || conv.remoteJid,
      canonicalPhone,
      phone: canonicalPhone || conv.phone || '',   // compat
      displayLabel: identity.displayLabel || conv.displayName || '',
      displayName: identity.displayLabel || conv.displayName || '', // compat
      identityStatus: status,
      identitySource: source,
      identityConfidence: confidence,
      updatedAt: deps.now(),
    });
  }

  await deps.writeConversations(updated);
  console.log('[whatsapp-backfill]', JSON.stringify(result));
  return result;
}
```

- [ ] **Step 4: Run backfill tests to verify pass**

Run: `TZ=UTC node --test tests/unit/whatsapp-identity-backfill.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add api/_functions/lib/whatsapp-identity-backfill.ts tests/unit/whatsapp-identity-backfill.test.ts
git commit -m "feat: add whatsapp identity backfill script"
```

---

### Task 9: Full integration verification + build

**Files:**

- Verify: all tests (unit + e2e)
- Verify: `npm run build`

- [ ] **Step 1: Run all unit tests**

Run:

```bash
TZ=UTC node --test \
  tests/unit/whatsapp-identity-resolver.test.ts \
  tests/unit/whatsapp-conversations-store.test.ts \
  tests/unit/whatsapp-conversations-sync.test.ts \
  tests/unit/whatsapp-conversations.test.ts \
  tests/unit/whatsapp-crm-match.test.ts \
  tests/unit/whatsapp-identity-backfill.test.ts \
  tests/unit/formatters.test.ts
```

Expected: ALL PASS.

- [ ] **Step 2: Run full unit test suite**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 3: Run Playwright tests**

Run: `npx playwright test tests/whatsapp-inbox.spec.js`
Expected: PASS — all tests.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean build, no errors.

- [ ] **Step 5: Commit final verification**

```bash
git add -A
git commit -m "chore: final integration verification for identity robustness"
```
