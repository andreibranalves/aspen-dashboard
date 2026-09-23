// Turns provider message items into durable attendance history. The live
// webhook and the backfill both go through here, so they share normalization,
// deduplication keys and identity precedence.

import {
  createPostgresWhatsappAttendanceRepository,
  type IngestWhatsappMessage,
  type WhatsappAttendanceRepository,
  type WhatsappTransportIdentity,
} from '../_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import { readWhatsappMessageContent, whatsappMessagePreview } from './whatsapp-message-content.js';
import { resolveWhatsappIdentity } from './whatsapp-identity-resolver.js';

export interface WhatsappUpsertIngestionItem {
  item: Record<string, unknown>;
  /** Real provider id; items without one are never persisted. */
  providerMessageId: string;
  remoteJid: string;
  fromMe: boolean;
  occurredAt: Date;
}

export interface IngestWhatsappUpsertsInput {
  instance: string;
  origin: 'live' | 'backfill';
  items: WhatsappUpsertIngestionItem[];
  repository?: Pick<WhatsappAttendanceRepository, 'ingestConversation'>;
}

function contactName(items: WhatsappUpsertIngestionItem[]): string | null {
  // pushName on an outgoing message is the operator's own profile name.
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const entry = items[index];
    if (entry.fromMe) continue;
    const name = typeof entry.item.pushName === 'string' ? entry.item.pushName.replace(/\s+/g, ' ').trim() : '';
    if (name) return name;
  }
  return null;
}

export async function ingestWhatsappUpserts(input: IngestWhatsappUpsertsInput): Promise<{ inserted: number }> {
  const repository = input.repository || createPostgresWhatsappAttendanceRepository();
  const groups = new Map<string, WhatsappUpsertIngestionItem[]>();
  for (const entry of input.items) {
    if (!entry.providerMessageId || !entry.remoteJid) continue;
    const group = groups.get(entry.remoteJid) || [];
    group.push(entry);
    groups.set(entry.remoteJid, group);
  }

  let inserted = 0;
  for (const [remoteJid, entries] of groups) {
    const messages: IngestWhatsappMessage[] = [];
    for (const entry of entries) {
      const content = readWhatsappMessageContent(entry.item);
      if (!content) continue;
      messages.push({
        providerMessageId: entry.providerMessageId,
        direction: entry.fromMe ? 'outbound' : 'inbound',
        messageType: content.type,
        body: content.body,
        preview: whatsappMessagePreview(content),
        providerTimestamp: entry.occurredAt,
      });
    }
    if (messages.length === 0) continue;

    const result = await repository.ingestConversation({
      instance: input.instance,
      providerConversationId: remoteJid,
      origin: input.origin,
      contactName: contactName(entries),
      messages,
      resolveIdentity: (stored): WhatsappTransportIdentity => {
        const resolved = resolveWhatsappIdentity({
          chat: { ...(entries.find((entry) => !entry.fromMe)?.item || entries[0].item), remoteJid },
          messages: entries.map((entry) => entry.item),
          storedConversation: stored ? { ...stored } : null,
          acceptLidAlternative: true,
        });
        return {
          canonicalPhone: resolved.canonicalPhone,
          identityStatus: resolved.identityStatus,
          identitySource: resolved.identitySource,
          identityConfidence: resolved.identityConfidence,
        };
      },
    });
    inserted += result.inserted;
  }
  return { inserted };
}
