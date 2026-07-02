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
  if (chatParticipant)
    results.push({ phone: chatParticipant, source: 'chat.participant', confidence: 'high' });

  // chat.from
  const chatFrom = normalizeWhatsappPhone(chat.from);
  if (chatFrom) results.push({ phone: chatFrom, source: 'chat.from', confidence: 'high' });

  // chat.sender
  const chatSender = normalizeWhatsappPhone(chat.sender);
  if (chatSender) results.push({ phone: chatSender, source: 'chat.sender', confidence: 'high' });

  // message.key.participant (inbound only)
  for (const msg of messages) {
    const key = (msg.key || {}) as Record<string, unknown>;
    if (key.fromMe === true) continue;
    const participant = normalizeWhatsappPhone(key.participant);
    if (participant) {
      results.push({ phone: participant, source: 'message.key.participant', confidence: 'high' });
    }
  }

  // message.from (inbound only)
  for (const msg of messages) {
    if ((msg as Record<string, unknown>).fromMe === true) continue;
    const from = normalizeWhatsappPhone((msg as Record<string, unknown>).from);
    if (from) results.push({ phone: from, source: 'message.from', confidence: 'high' });
  }

  // message.sender (inbound only)
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
  const name = cleanText(chat.pushName || chat.displayName || chat.name || chat.nome || chat.notify);
  if (name) return name;
  if (canonicalPhone) return canonicalPhone;
  return 'Contato sem nome';
}

function shouldKeepStored(
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

  // Fresh is unresolved but we have a stored phone → keep stored
  if (freshStatus === 'unresolved' && storedPhone) return true;

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

  const fresh = bestSource(highSources, mediumSource);

  if (shouldKeepStored(fresh.identityStatus, fresh.identityConfidence, storedConversation)) {
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
