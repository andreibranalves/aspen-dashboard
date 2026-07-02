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

export async function backfillWhatsappIdentities(
  deps: BackfillDeps
): Promise<BackfillResult> {
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
    const identity = resolveWhatsappIdentity({
      chat: { remoteJid: conv.remoteJid, pushName: conv.displayName || conv.displayLabel },
      messages: messages.map((m) => (m.raw || m) as Record<string, unknown>),
      storedConversation: conv as unknown as Record<string, unknown>,
    });

    const canonicalPhone = identity.canonicalPhone || conv.phone || '';
    const status = identity.identityStatus;

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
      phone: canonicalPhone || conv.phone || '',
      displayLabel: identity.displayLabel || conv.displayName || '',
      displayName: identity.displayLabel || conv.displayName || '',
      identityStatus: status,
      identitySource: identity.identitySource,
      identityConfidence: identity.identityConfidence,
      updatedAt: deps.now(),
    });
  }

  await deps.writeConversations(updated);
  console.log('[whatsapp-backfill]', JSON.stringify(result));
  return result;
}
