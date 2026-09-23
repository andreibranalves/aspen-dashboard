// whatsapp-identity-resolver.ts
// Single source of truth for WhatsApp contact identity.
// Separates: provider conversation id, canonical business phone, display label.

import {
  normalizeWhatsappPhone,
  normalizeWhatsappPhoneFromRemoteJid,
} from '../_shared/whatsapp-phone.js';

// Identifiers and display names only; never applied to a message body.
function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

// A message counts as outgoing when either the envelope or its key says so.
function isFromMe(message: Record<string, unknown>): boolean {
  const key = (message.key || {}) as Record<string, unknown>;
  return message.fromMe === true || key.fromMe === true;
}

function readHighConfidenceSources(
  chat: Record<string, unknown>,
  messages: Array<Record<string, unknown>>,
  allowChatFields: boolean
): SourceResult[] {
  const results: SourceResult[] = [];

  if (allowChatFields) {
    const chatPhone = normalizeWhatsappPhone(chat.phone);
    if (chatPhone) results.push({ phone: chatPhone, source: 'chat.phone', confidence: 'high' });

    const senderPn = normalizeWhatsappPhone(chat.senderPn);
    if (senderPn) results.push({ phone: senderPn, source: 'chat.senderPn', confidence: 'high' });

    // Sender fields of an outgoing message describe the operator, not the contact.
    if (!isFromMe(chat)) {
      const participant = normalizeWhatsappPhone(chat.participant);
      if (participant)
        results.push({ phone: participant, source: 'chat.participant', confidence: 'high' });

      const chatFrom = normalizeWhatsappPhone(chat.from);
      if (chatFrom) results.push({ phone: chatFrom, source: 'chat.from', confidence: 'high' });

      const chatSender = normalizeWhatsappPhone(chat.sender);
      if (chatSender) results.push({ phone: chatSender, source: 'chat.sender', confidence: 'high' });
    }
  }

  for (const msg of messages) {
    if (isFromMe(msg)) continue;
    const key = (msg.key || {}) as Record<string, unknown>;
    const participant = normalizeWhatsappPhone(key.participant);
    if (participant) {
      results.push({ phone: participant, source: 'message.key.participant', confidence: 'high' });
    }
    const from = normalizeWhatsappPhone(msg.from);
    if (from) results.push({ phone: from, source: 'message.from', confidence: 'high' });
    const sender = normalizeWhatsappPhone(msg.sender);
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
  mediumSource: SourceResult | null
): {
  canonicalPhone: string;
  identityStatus: IdentityStatus;
  identitySource: IdentitySource;
  identityConfidence: IdentityConfidence | null;
} {
  // Resolve from fresh evidence first — deduplicate by phone value
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
  // Support multiple name field conventions: pushName (Evolution),
  // displayName/nome (normalized store), name (generic)
  const name = cleanText(
    chat.pushName || chat.displayName || chat.name || chat.nome || chat.notify
  );
  if (name) return name;
  if (canonicalPhone) return canonicalPhone;
  return 'Contato sem nome';
}

const CONFLICT = {
  canonicalPhone: '',
  identityStatus: 'conflict' as const,
  identitySource: null,
  identityConfidence: null,
};

type StoredDecision = 'fresh' | 'stored' | 'conflict';

// Stored identity is kept only while fresh evidence is absent or agrees with it;
// contradiction always surfaces as a conflict instead of being masked.
function decideAgainstStored(
  fresh: ReturnType<typeof bestSource>,
  stored: Record<string, unknown> | null
): StoredDecision {
  if (fresh.identityStatus === 'conflict') return 'conflict';
  const storedPhone = stored ? cleanText(stored.canonicalPhone) : '';
  if (!storedPhone) return 'fresh';
  if (!fresh.canonicalPhone) return 'stored';

  const storedConfidence = cleanText(stored!.identityConfidence);
  if (fresh.canonicalPhone !== storedPhone) {
    return storedConfidence === 'high' ? 'conflict' : 'fresh';
  }
  return storedConfidence === 'high' && fresh.identityConfidence !== 'high' ? 'stored' : 'fresh';
}

export function resolveWhatsappIdentity(input: {
  source?: 'provider' | 'stored';
  chat: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
  storedConversation?: Record<string, unknown> | null;
}): ResolvedWhatsappIdentity {
  const { chat, messages = [], storedConversation = null } = input;
  const source = input.source || 'provider';

  const providerConversationId = readRemoteJid(chat);

  const highSources = readHighConfidenceSources(chat, messages, source === 'provider');
  const mediumSource = readMediumConfidenceSource(chat);

  const fresh = bestSource(highSources, mediumSource);
  const decision = decideAgainstStored(fresh, storedConversation);

  if (decision === 'conflict') {
    return { providerConversationId, ...CONFLICT, displayLabel: resolveDisplayLabel(chat, '') };
  }

  if (decision === 'stored') {
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

  return {
    providerConversationId,
    ...fresh,
    displayLabel: resolveDisplayLabel(chat, fresh.canonicalPhone),
  };
}
