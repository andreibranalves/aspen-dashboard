import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeEvolutionConversation,
  normalizeEvolutionMessage,
  syncMessagesForConversation,
  syncWhatsappConversations,
  unwrapEvolutionCollection,
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

    assert.equal(normalized!.remoteJid, '5511999999999@s.whatsapp.net');
    assert.equal(normalized!.phone, '5511999999999');
    assert.equal(normalized!.displayName, 'Maria Cliente');
    assert.equal(normalized!.lastMessagePreview, 'Quero 100 cangas');
  });

  it('prefers explicit sender phone over lid-like remoteJid', () => {
    const normalized = normalizeEvolutionConversation({
      remoteJid: '183792384719283741@lid',
      senderPn: '554896241095',
      pushName: 'Cliente LID',
      updatedAt: 1782916800,
      lastMessage: { text: 'Oi' },
    });

    assert.equal(normalized!.remoteJid, '183792384719283741@lid');
    assert.equal(normalized!.phone, '554896241095');
    assert.equal(normalized!.displayName, 'Cliente LID');
  });

  it('does not derive phone from a lid-like remoteJid when no explicit phone exists', () => {
    const normalized = normalizeEvolutionConversation({
      remoteJid: '183792384719283741@lid',
      pushName: 'Cliente LID',
      updatedAt: 1782916800,
      lastMessage: { text: 'Oi' },
    });

    assert.equal(normalized!.remoteJid, '183792384719283741@lid');
    assert.equal(normalized!.phone, '');
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

    assert.equal(inbound!.providerMessageId, 'm1');
    assert.equal(inbound!.direction, 'inbound');
    assert.equal(inbound!.body, 'Oi');
    assert.equal(outbound!.direction, 'outbound');
  });

  it('unwraps Evolution collections from nested payload shapes', () => {
    assert.equal(
      unwrapEvolutionCollection({ messages: { records: [{ key: { id: 'm1' } }] } }).length,
      1
    );
    assert.equal(
      unwrapEvolutionCollection({ data: { messages: { records: [{ key: { id: 'm2' } }] } } })
        .length,
      1
    );
    assert.equal(unwrapEvolutionCollection({ response: [{ key: { id: 'm3' } }] }).length, 1);
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

  it('allows syncing up to 100 messages for a selected conversation', async () => {
    const storeDeps = makeStoreDeps();
    let requestedLimit = 0;
    const syncDeps: EvolutionSyncDeps = {
      ...storeDeps,
      fetchMessages: async (_remoteJid, limit) => {
        requestedLimit = limit;
        return [
          {
            key: { id: 'm1', fromMe: false },
            messageTimestamp: 1782916800,
            message: { conversation: 'Mensagem 1' },
          },
        ];
      },
    };

    const conversation: WhatsappConversation = {
      id: 'wa_1',
      providerConversationId: '5511999999999@s.whatsapp.net',
      remoteJid: '5511999999999@s.whatsapp.net',
      canonicalPhone: '5511999999999',
      phone: '5511999999999',
      displayLabel: 'Maria Cliente',
      displayName: 'Maria Cliente',
      identityStatus: 'verified',
      identitySource: 'chat.phone',
      identityConfidence: 'high',
      source: 'evolution',
      status: 'new',
      lastMessageAt: '2026-07-01T12:00:00.000Z',
      lastMessagePreview: 'Mensagem 1',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-01T12:00:00.000Z',
    };

    await syncMessagesForConversation(conversation, 100, syncDeps);

    assert.equal(requestedLimit, 100);
    assert.equal((await storeDeps.readMessages(conversation.id)).length, 1);
  });

  it('backfills the real phone when refreshing a conversation stored with lid-like remoteJid', async () => {
    const storeDeps = makeStoreDeps();
    const conversation: WhatsappConversation = {
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
      lastMessagePreview: 'Mensagem 1',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-01T12:00:00.000Z',
    };
    await storeDeps.writeConversations([conversation]);

    const syncDeps: EvolutionSyncDeps = {
      ...storeDeps,
      fetchMessages: async () => [
        {
          key: {
            id: 'm1',
            fromMe: false,
            participant: '554896241095@s.whatsapp.net',
          },
          messageTimestamp: 1782916800,
          message: { conversation: 'Mensagem 1' },
        },
      ],
    };

    await syncMessagesForConversation(conversation, 100, syncDeps);

    const storedConversations = await storeDeps.readConversations();
    assert.equal(storedConversations[0].phone, '554896241095');
  });

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

  it('backfills canonicalPhone via resolver after message sync', async () => {
    const storeDeps = makeStoreDeps();
    const conversation: WhatsappConversation = {
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

  it('keeps unresolved legacy conversation unresolved when refresh has no trusted phone source', async () => {
    const storeDeps = makeStoreDeps();
    const conversation: WhatsappConversation = {
      id: 'wa_1',
      providerConversationId: '183792384719283741@lid',
      remoteJid: '183792384719283741@lid',
      canonicalPhone: '',
      phone: '5521981858541',
      displayLabel: '',
      displayName: 'Maria Legado',
      identityStatus: 'unresolved',
      identitySource: null,
      identityConfidence: null,
      source: 'evolution',
      status: 'new',
      lastMessageAt: '2026-07-02T12:00:00.000Z',
      lastMessagePreview: 'Oi',
      createdAt: '2026-07-02T12:00:00.000Z',
      updatedAt: '2026-07-02T12:00:00.000Z',
    };
    await storeDeps.writeConversations([conversation]);

    const updated = await syncMessagesForConversation(conversation as any, 100, {
      ...storeDeps,
      fetchMessages: async () => [],
    });

    assert.equal(updated.canonicalPhone, '');
    assert.equal(updated.identityStatus, 'unresolved');
  });
});
