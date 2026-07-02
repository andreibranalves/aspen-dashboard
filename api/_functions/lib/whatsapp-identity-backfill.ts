// whatsapp-identity-backfill.ts
// Reprocesses stored WhatsApp conversations to populate canonical identity fields.
// Used for backfill of historical data contaminated by fragile fallback rules.

import { resolveWhatsappIdentity } from './whatsapp-identity-resolver.js';
import type {
  WhatsappConversation,
  WhatsappConversationStoreDeps,
} from './whatsapp-conversations-store.js';

type BackfillDeps = Pick<
  WhatsappConversationStoreDeps,
  'readConversations' | 'writeConversations' | 'readMessages' | 'now'
>;

export interface BackfillResult {
  total: number;
  fixed: number;
  unchanged: number;
  conflict: number;
  unresolved: number;
}

export async function backfillWhatsappIdentities(deps: BackfillDeps): Promise<BackfillResult> {
  const conversations = await deps.readConversations();
  const result: BackfillResult = {
    total: conversations.length,
    fixed: 0,
    unchanged: 0,
    conflict: 0,
    unresolved: 0,
  };

  const updated: WhatsappConversation[] = [];
  for (const conv of conversations) {
    const messages = await deps.readMessages(conv.id);
    const legacyPhone = conv.canonicalPhone || conv.phone || '';
    const legacyName = conv.displayLabel || conv.displayName || '';
    const identity = resolveWhatsappIdentity({
      chat: {
        remoteJid: conv.providerConversationId || conv.remoteJid,
        phone: legacyPhone,
        pushName: legacyName,
        displayName: legacyName,
      },
      messages: messages.map((m) => (m.raw || m) as Record<string, unknown>),
      storedConversation: conv as unknown as Record<string, unknown>,
    });

    const canonicalPhone = identity.canonicalPhone || legacyPhone;
    const displayLabel = identity.displayLabel || legacyName || 'Contato sem nome';
    const status = identity.identityStatus;

    if (
      canonicalPhone !== conv.canonicalPhone ||
      displayLabel !== conv.displayLabel ||
      conv.identityStatus !== status
    ) {
      if (status === 'verified' || status === 'derived') result.fixed++;
      else if (status === 'conflict') result.conflict++;
      else result.unresolved++;
    } else {
      result.unchanged++;
    }

    updated.push({
      ...conv,
      providerConversationId:
        identity.providerConversationId || conv.providerConversationId || conv.remoteJid,
      remoteJid: identity.providerConversationId || conv.remoteJid,
      canonicalPhone,
      phone: canonicalPhone,
      displayLabel,
      displayName: displayLabel,
      identityStatus: status,
      identitySource: identity.identitySource,
      identityConfidence: identity.identityConfidence,
      updatedAt: deps.now(),
    });
  }

  await deps.writeConversations(updated);
  return result;
}
