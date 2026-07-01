import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getWhatsappConversation,
  getWhatsappMessages,
  listWhatsappConversations,
  normalizeWhatsappConversationInput,
  normalizeWhatsappMessageInput,
  updateWhatsappConversation,
  upsertWhatsappConversation,
  upsertWhatsappMessages,
  type WhatsappConversation,
  type WhatsappConversationStoreDeps,
} from '../../api/_functions/lib/whatsapp-conversations-store.js';

function makeDeps(): WhatsappConversationStoreDeps {
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

describe('whatsapp-conversations-store', () => {
  it('normalizes conversation input with safe defaults', () => {
    const deps = makeDeps();
    const conversation = normalizeWhatsappConversationInput(
      {
        remoteJid: '5511999999999@s.whatsapp.net',
        phone: '(11) 99999-9999',
        displayName: ' João  Silva ',
        lastMessagePreview: ' Quero 50 camisetas ',
      },
      deps
    );

    assert.equal(conversation.id, 'wa_1');
    assert.equal(conversation.remoteJid, '5511999999999@s.whatsapp.net');
    assert.equal(conversation.phone, '5511999999999');
    assert.equal(conversation.displayName, 'João Silva');
    assert.equal(conversation.status, 'new');
    assert.equal(conversation.source, 'evolution');
  });

  it('normalizes message input and preserves provider id', () => {
    const deps = makeDeps();
    const message = normalizeWhatsappMessageInput(
      {
        providerMessageId: 'wamid.1',
        direction: 'inbound',
        type: 'text',
        body: 'Olá, queria orçamento',
        timestamp: '2026-07-01T11:59:00.000Z',
      },
      deps
    );

    assert.equal(message.id, 'wa_1');
    assert.equal(message.providerMessageId, 'wamid.1');
    assert.equal(message.direction, 'inbound');
    assert.equal(message.type, 'text');
    assert.equal(message.body, 'Olá, queria orçamento');
  });

  it('upserts conversations by remoteJid and keeps newest preview', async () => {
    const deps = makeDeps();

    const first = await upsertWhatsappConversation(
      {
        remoteJid: '5511999999999@s.whatsapp.net',
        phone: '5511999999999',
        displayName: 'João',
        lastMessagePreview: 'primeira',
        lastMessageAt: '2026-07-01T10:00:00.000Z',
      },
      deps
    );
    const second = await upsertWhatsappConversation(
      {
        remoteJid: '5511999999999@s.whatsapp.net',
        phone: '5511999999999',
        displayName: 'João Silva',
        lastMessagePreview: 'segunda',
        lastMessageAt: '2026-07-01T11:00:00.000Z',
      },
      deps
    );

    assert.equal(first.id, second.id);
    assert.equal(second.displayName, 'João Silva');
    assert.equal(second.lastMessagePreview, 'segunda');
    assert.equal((await listWhatsappConversations({}, deps)).length, 1);
  });

  it('deduplicates messages by providerMessageId', async () => {
    const deps = makeDeps();
    const conversation = await upsertWhatsappConversation(
      { remoteJid: '5511999999999@s.whatsapp.net', phone: '5511999999999' },
      deps
    );

    await upsertWhatsappMessages(
      conversation.id,
      [
        { providerMessageId: 'm1', direction: 'inbound', body: 'Oi' },
        { providerMessageId: 'm1', direction: 'inbound', body: 'Oi duplicado' },
        { providerMessageId: 'm2', direction: 'outbound', body: 'Olá' },
      ],
      deps
    );

    const stored = await getWhatsappMessages(conversation.id, deps);
    assert.equal(stored.length, 2);
    assert.deepEqual(
      stored.map((message) => message.providerMessageId),
      ['m1', 'm2']
    );
  });

  it('filters conversations by status, query, and limit', async () => {
    const deps = makeDeps();
    await upsertWhatsappConversation(
      { remoteJid: 'a@s.whatsapp.net', phone: '5511111111111', displayName: 'Ana' },
      deps
    );
    const bruno = await upsertWhatsappConversation(
      { remoteJid: 'b@s.whatsapp.net', phone: '5522222222222', displayName: 'Bruno' },
      deps
    );
    await updateWhatsappConversation(bruno.id, { status: 'needs_quote' }, deps);

    const results = await listWhatsappConversations(
      { status: 'needs_quote', q: 'bru', limit: 1 },
      deps
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].displayName, 'Bruno');
  });

  it('throws a Portuguese 404 when conversation is missing', async () => {
    const deps = makeDeps();
    await assert.rejects(
      () => getWhatsappConversation('missing', deps),
      /Conversa do WhatsApp não encontrada/
    );
  });
});
