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
      remoteJid: '5511999999999@s.whatsapp.net',
      phone: '5511999999999',
      displayName: 'Maria Cliente',
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
});
