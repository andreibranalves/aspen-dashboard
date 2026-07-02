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

  it('does not derive phone from lid-like remoteJid without explicit phone', () => {
    const deps = makeDeps();
    const conversation = normalizeWhatsappConversationInput(
      {
        remoteJid: '183792384719283741@lid',
        displayName: 'Cliente LID',
      },
      deps
    );

    assert.equal(conversation.remoteJid, '183792384719283741@lid');
    assert.equal(conversation.phone, '');
    assert.equal(conversation.displayName, 'Cliente LID');
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

  it('preserves a saved phone when a later sync only brings a lid-like remoteJid', async () => {
    const deps = makeDeps();

    const first = await upsertWhatsappConversation(
      {
        remoteJid: '183792384719283741@lid',
        phone: '554896241095',
        displayName: 'Cliente',
        lastMessagePreview: 'primeira',
        lastMessageAt: '2026-07-01T10:00:00.000Z',
      },
      deps
    );
    const second = await upsertWhatsappConversation(
      {
        remoteJid: '183792384719283741@lid',
        displayName: 'Cliente Atualizado',
        lastMessagePreview: 'segunda',
        lastMessageAt: '2026-07-01T11:00:00.000Z',
      },
      deps
    );

    assert.equal(first.id, second.id);
    assert.equal(second.phone, '554896241095');
    assert.equal(second.displayName, 'Cliente Atualizado');
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

  it('populates canonicalPhone and providerConversationId during normalization', () => {
    const deps = makeDeps();
    const conversation = normalizeWhatsappConversationInput(
      {
        remoteJid: '5521981858541@s.whatsapp.net',
        phone: '5521981858541',
        displayName: 'Maria',
      },
      deps
    );

    assert.equal(conversation.providerConversationId, '5521981858541@s.whatsapp.net');
    assert.equal(conversation.canonicalPhone, '5521981858541');
    assert.equal(conversation.phone, '5521981858541'); // compat
    assert.equal(conversation.displayLabel, 'Maria');
    assert.equal(conversation.displayName, 'Maria'); // compat
    assert.equal(conversation.identityStatus, 'verified');
    assert.equal(conversation.identityConfidence, 'high');
  });

  it('preserves old remoteJid and phone for backward compatibility', () => {
    const deps = makeDeps();
    const conversation = normalizeWhatsappConversationInput(
      {
        remoteJid: '183792384719283741@lid',
        senderPn: '5521981858541',
        displayName: 'Maria',
      },
      deps
    );

    assert.equal(conversation.remoteJid, '183792384719283741@lid'); // compat stays
    assert.equal(conversation.providerConversationId, '183792384719283741@lid');
    assert.equal(conversation.canonicalPhone, '5521981858541');
    assert.equal(conversation.phone, '5521981858541'); // compat populated
    assert.equal(conversation.displayName, 'Maria'); // compat populated
    assert.equal(conversation.displayLabel, 'Maria');
  });

  it('sets identityStatus unresolved when no phone can be derived', () => {
    const deps = makeDeps();
    const conversation = normalizeWhatsappConversationInput(
      {
        remoteJid: '183792384719283741@lid',
        displayName: 'Cliente LID',
      },
      deps
    );

    assert.equal(conversation.canonicalPhone, '');
    assert.equal(conversation.phone, ''); // compat
    assert.equal(conversation.identityStatus, 'unresolved');
    assert.equal(conversation.identityConfidence, null);
  });

  it('preserves canonicalPhone on upsert when new payload has weaker evidence', async () => {
    const deps = makeDeps();

    const first = await upsertWhatsappConversation(
      {
        remoteJid: '183792384719283741@lid',
        senderPn: '5521981858541',
        displayName: 'Maria',
        lastMessagePreview: 'primeira',
        lastMessageAt: '2026-07-01T10:00:00.000Z',
      },
      deps
    );
    assert.equal(first.canonicalPhone, '5521981858541');
    assert.equal(first.identityConfidence, 'high');

    const second = await upsertWhatsappConversation(
      {
        remoteJid: '183792384719283741@lid',
        displayName: 'Maria Atualizada',
        lastMessagePreview: 'segunda',
        lastMessageAt: '2026-07-01T11:00:00.000Z',
      },
      deps
    );

    assert.equal(second.canonicalPhone, '5521981858541'); // preserved
    assert.equal(second.identityConfidence, 'high'); // preserved
    assert.equal(second.displayLabel, 'Maria Atualizada'); // updated
  });

  it('filters conversations by canonicalPhone in search', async () => {
    const deps = makeDeps();
    await upsertWhatsappConversation(
      { remoteJid: 'a@s.whatsapp.net', phone: '5521981858541', displayName: 'Maria' },
      deps
    );

    const results = await listWhatsappConversations({ q: '5521981858541' }, deps);
    assert.equal(results.length, 1);
  });

  it('clears canonicalPhone and phone when fresh identity is unresolved for a lid', async () => {
    const deps = makeDeps();
    // Simula estado legado: @lid com canonicalPhone falso, identityStatus derived
    await deps.writeConversations([
      {
        id: 'wa_legacy_lid',
        providerConversationId: '265639532982352@lid',
        remoteJid: '265639532982352@lid',
        canonicalPhone: '265639532982352',
        phone: '265639532982352',
        displayLabel: 'Contato sem nome',
        displayName: 'Contato sem nome',
        identityStatus: 'derived',
        identitySource: 'providerConversationId',
        identityConfidence: 'medium',
        lastMessageAt: '2026-07-02T12:00:00.000Z',
        lastMessagePreview: 'oi',
        source: 'evolution',
        status: 'new',
        createdAt: '2026-07-02T12:00:00.000Z',
        updatedAt: '2026-07-02T12:00:00.000Z',
      },
    ]);

    // Upsert com nova resolução diz "unresolved"
    await upsertWhatsappConversation(
      {
        remoteJid: '265639532982352@lid',
        phone: '',
        displayName: 'Contato sem nome',
        providerConversationId: '265639532982352@lid',
        canonicalPhone: '',
        displayLabel: 'Contato sem nome',
        identityStatus: 'unresolved',
        identitySource: null,
        identityConfidence: null,
        lastMessageAt: Date.now(),
        lastMessagePreview: 'oi',
      },
      deps
    );
    const [conversation] = await deps.readConversations();
    assert.equal(conversation.canonicalPhone, '');
    assert.equal(conversation.phone, '');
  });

  it('keeps valid canonicalPhone when fresh identity is not unresolved', async () => {
    const deps = makeDeps();
    await upsertWhatsappConversation(
      {
        remoteJid: '5521981858541@s.whatsapp.net',
        phone: '5521981858541',
        displayName: 'Maria',
      },
      deps
    );

    // Atualiza com status change apenas (sem identity)
    await upsertWhatsappConversation(
      {
        remoteJid: '5521981858541@s.whatsapp.net',
        phone: '',
        displayName: 'Maria',
        status: 'closed',
      },
      deps
    );
    const [conversation] = await deps.readConversations();
    assert.ok(conversation.canonicalPhone);
  });

  it('strips canonicalPhone from lid conversations with unresolved identity on list', async () => {
    const deps = makeDeps();
    // Insere conversas legadas com dados sujos diretamente no store
    await deps.writeConversations([
      {
        id: 'wa_legacy_01',
        providerConversationId: '265639532982352@lid',
        remoteJid: '265639532982352@lid',
        canonicalPhone: '265639532982352',
        phone: '265639532982352',
        displayLabel: 'Contato sem nome',
        displayName: 'Contato sem nome',
        identityStatus: 'unresolved',
        identitySource: null,
        identityConfidence: null,
        source: 'evolution',
        status: 'new',
        lastMessageAt: '2026-07-02T12:00:00.000Z',
        lastMessagePreview: 'oi',
        createdAt: '2026-07-02T12:00:00.000Z',
        updatedAt: '2026-07-02T12:00:00.000Z',
      },
      {
        id: 'wa_good_01',
        providerConversationId: '5521981858541@s.whatsapp.net',
        remoteJid: '5521981858541@s.whatsapp.net',
        canonicalPhone: '5521981858541',
        phone: '5521981858541',
        displayLabel: 'Maria',
        displayName: 'Maria',
        identityStatus: 'verified',
        identitySource: 'chat.phone',
        identityConfidence: 'high',
        source: 'evolution',
        status: 'new',
        lastMessageAt: '2026-07-02T12:00:00.000Z',
        lastMessagePreview: 'oi',
        createdAt: '2026-07-02T12:00:00.000Z',
        updatedAt: '2026-07-02T12:00:00.000Z',
      },
    ]);

    const result = await listWhatsappConversations({}, deps);
    assert.equal(result.length, 2);
    const legacy = result.find((c) => c.id === 'wa_legacy_01')!;
    const good = result.find((c) => c.id === 'wa_good_01')!;
    assert.equal(legacy.canonicalPhone, '');
    assert.equal(legacy.phone, '');
    assert.equal(good.canonicalPhone, '5521981858541');
    assert.equal(good.phone, '5521981858541');
  });
});
