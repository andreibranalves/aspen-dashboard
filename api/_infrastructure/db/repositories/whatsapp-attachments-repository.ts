import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../client.js';
import { whatsappConversations, whatsappMessageAttachments } from '../schema.js';

export interface WhatsappAttachment {
  id: string;
  conversationId: string;
  messageId: string | null;
  mediaType: 'image' | 'document';
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  checksum: string;
  contentBase64: string;
}

export async function createWhatsappAttachment(input: Omit<WhatsappAttachment, 'id' | 'messageId'>): Promise<string | null> {
  const db = getDatabase();
  const [conversation] = await db.select({ id: whatsappConversations.id }).from(whatsappConversations)
    .where(eq(whatsappConversations.id, input.conversationId));
  if (!conversation) return null;
  const id = randomUUID();
  await db.insert(whatsappMessageAttachments).values({ id, ...input });
  return id;
}

export async function loadWhatsappAttachment(id: string): Promise<WhatsappAttachment | null> {
  const [row] = await getDatabase().select().from(whatsappMessageAttachments)
    .where(eq(whatsappMessageAttachments.id, id));
  return row ? { ...row, mediaType: row.mediaType as 'image' | 'document' } : null;
}
