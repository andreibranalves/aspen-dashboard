import {
  normalizeWhatsappPhone,
  normalizeWhatsappPhoneFromRemoteJid,
  type WhatsappConversationStoreDeps,
} from './whatsapp-conversations-store.js';

export interface WhatsappIdentityAuditRow {
  id: string;
  providerConversationId: string;
  displayName: string;
  storedCanonicalPhone: string;
  storedPhone: string;
  candidatePhone: string;
  classification:
    | 'verified_remote_jid'
    | 'verified_message_participant'
    | 'legacy_only'
    | 'unresolved';
}

export interface WhatsappIdentityAuditReport {
  total: number;
  counts: {
    verifiedRemoteJid: number;
    verifiedMessageParticipant: number;
    legacyOnly: number;
    unresolved: number;
  };
  rows: WhatsappIdentityAuditRow[];
}

export async function auditWhatsappIdentities(
  deps: Pick<WhatsappConversationStoreDeps, 'readConversations' | 'readMessages'>
): Promise<WhatsappIdentityAuditReport> {
  const conversations = await deps.readConversations();
  const rows: WhatsappIdentityAuditRow[] = [];
  const counts = {
    verifiedRemoteJid: 0,
    verifiedMessageParticipant: 0,
    legacyOnly: 0,
    unresolved: 0,
  };

  for (const conv of conversations) {
    const providerConversationId = conv.providerConversationId || conv.remoteJid || '';
    const byRemoteJid = normalizeWhatsappPhoneFromRemoteJid(providerConversationId);
    if (byRemoteJid) {
      counts.verifiedRemoteJid++;
      rows.push({
        id: conv.id,
        providerConversationId,
        displayName: conv.displayLabel || conv.displayName || '',
        storedCanonicalPhone: conv.canonicalPhone || '',
        storedPhone: conv.phone || '',
        candidatePhone: byRemoteJid,
        classification: 'verified_remote_jid',
      });
      continue;
    }

    const messages = await deps.readMessages(conv.id);
    const participant = messages
      .map((message) =>
        normalizeWhatsappPhone((message.raw as any)?.key?.participant)
      )
      .find(Boolean);
    if (participant) {
      counts.verifiedMessageParticipant++;
      rows.push({
        id: conv.id,
        providerConversationId,
        displayName: conv.displayLabel || conv.displayName || '',
        storedCanonicalPhone: conv.canonicalPhone || '',
        storedPhone: conv.phone || '',
        candidatePhone: participant,
        classification: 'verified_message_participant',
      });
      continue;
    }

    if (conv.phone) {
      counts.legacyOnly++;
      rows.push({
        id: conv.id,
        providerConversationId,
        displayName: conv.displayLabel || conv.displayName || '',
        storedCanonicalPhone: conv.canonicalPhone || '',
        storedPhone: conv.phone || '',
        candidatePhone: '',
        classification: 'legacy_only',
      });
      continue;
    }

    counts.unresolved++;
    rows.push({
      id: conv.id,
      providerConversationId,
      displayName: conv.displayLabel || conv.displayName || '',
      storedCanonicalPhone: conv.canonicalPhone || '',
      storedPhone: conv.phone || '',
      candidatePhone: '',
      classification: 'unresolved',
    });
  }

  return { total: rows.length, counts, rows };
}
