import { eq } from 'drizzle-orm';
import { getDatabase } from '../client.js';
import { whatsappConversations, whatsappMessages } from '../schema.js';

export async function findReceivedMediaMessage(id: string) {
  const [message] = await getDatabase()
    .select({
      id: whatsappMessages.id,
      conversationId: whatsappMessages.conversationId,
      providerMessageId: whatsappMessages.providerMessageId,
      direction: whatsappMessages.direction,
      type: whatsappMessages.messageType,
      instance: whatsappConversations.instance,
      providerConversationId: whatsappConversations.providerConversationId,
    })
    .from(whatsappMessages)
    .innerJoin(whatsappConversations, eq(whatsappConversations.id, whatsappMessages.conversationId))
    .where(eq(whatsappMessages.id, id));
  return message || null;
}

export async function findContactPhotoConversation(id: string) {
  const [conversation] = await getDatabase()
    .select({
      instance: whatsappConversations.instance,
      providerConversationId: whatsappConversations.providerConversationId,
    })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.id, id));
  return conversation || null;
}
