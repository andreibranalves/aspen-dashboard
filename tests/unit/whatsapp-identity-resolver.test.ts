import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhatsappIdentity } from '../../api/modules/whatsapp-identity-resolver.js';

describe('whatsapp-identity-resolver', () => {
  it('derives canonicalPhone from chat.phone with high confidence', () => {
    const result = resolveWhatsappIdentity({
      chat: { phone: '5521981858541', pushName: 'Maria Souza' },
    });
    assert.equal(result.providerConversationId, '');
    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.displayLabel, 'Maria Souza');
    assert.equal(result.identityStatus, 'verified');
    assert.equal(result.identityConfidence, 'high');
    assert.equal(result.identitySource, 'chat.phone');
  });

  it('prefers senderPn over lid remoteJid', () => {
    const result = resolveWhatsappIdentity({
      chat: {
        remoteJid: '183792384719283741@lid',
        senderPn: '5521981858541',
        pushName: 'Maria',
      },
    });
    assert.equal(result.providerConversationId, '183792384719283741@lid');
    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.identityConfidence, 'high');
    assert.equal(result.identitySource, 'chat.senderPn');
  });

  it('rejects lid as canonicalPhone when no explicit phone exists', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '183792384719283741@lid', pushName: 'Cliente' },
    });
    assert.equal(result.providerConversationId, '183792384719283741@lid');
    assert.equal(result.canonicalPhone, '');
    assert.equal(result.identityStatus, 'unresolved');
    assert.equal(result.identityConfidence, null);
  });

  it('accepts remoteJid as canonicalPhone only when numeric JID', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '5521981858541@s.whatsapp.net', pushName: 'João' },
    });
    assert.equal(result.providerConversationId, '5521981858541@s.whatsapp.net');
    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.identityStatus, 'derived');
    assert.equal(result.identityConfidence, 'medium');
    assert.equal(result.identitySource, 'providerConversationId');
  });

  it('uses message participant as high-confidence source', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '183792384719283741@lid', pushName: 'Cliente' },
      messages: [
        {
          key: { participant: '5521981858541@s.whatsapp.net', fromMe: false },
          message: { conversation: 'Oi' },
        },
      ],
    });
    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.identityStatus, 'verified');
    assert.equal(result.identityConfidence, 'high');
    assert.equal(result.identitySource, 'message.key.participant');
  });

  it('preserves existing canonicalPhone when new evidence is weaker', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '183792384719283741@lid', pushName: 'Cliente' },
      storedConversation: {
        canonicalPhone: '5521981858541',
        identityStatus: 'verified',
        identityConfidence: 'high',
      },
    });
    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.identityStatus, 'verified');
    assert.equal(result.identityConfidence, 'high');
  });

  it('upgrades identity when new evidence is stronger', () => {
    const result = resolveWhatsappIdentity({
      chat: { phone: '5521981858541', pushName: 'Maria' },
      storedConversation: {
        canonicalPhone: '5521981858541',
        identityStatus: 'derived',
        identityConfidence: 'medium',
        identitySource: 'providerConversationId',
      },
    });
    assert.equal(result.identityStatus, 'verified');
    assert.equal(result.identityConfidence, 'high');
    assert.equal(result.identitySource, 'chat.phone');
  });

  it('sets displayLabel to name when available', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '5521981858541@s.whatsapp.net', pushName: 'João Silva' },
    });
    assert.equal(result.displayLabel, 'João Silva');
  });

  it('sets displayLabel to canonicalPhone when no name exists', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '5521981858541@s.whatsapp.net' },
    });
    assert.equal(result.displayLabel, '5521981858541');
  });

  it('marks conflict when two strong sources disagree', () => {
    const result = resolveWhatsappIdentity({
      chat: { phone: '5511999999999', senderPn: '5521888888888', pushName: 'Cliente' },
    });
    assert.equal(result.identityStatus, 'conflict');
    assert.equal(result.canonicalPhone, '');
  });

  it('ignores message content (text body) as phone source', () => {
    const result = resolveWhatsappIdentity({
      chat: { remoteJid: '183792384719283741@lid', pushName: 'Cliente' },
      messages: [
        {
          key: { fromMe: false },
          message: { conversation: 'meu numero é 5521981858541' },
        },
      ],
    });
    assert.equal(result.canonicalPhone, '');
  });

  it('ignores stored legacy phone when source is stored', () => {
    const result = resolveWhatsappIdentity({
      source: 'stored',
      chat: {
        remoteJid: '183792384719283741@lid',
        phone: '5521981858541',
        displayName: 'Maria Legado',
      },
    });

    assert.equal(result.canonicalPhone, '');
    assert.equal(result.identityStatus, 'unresolved');
  });

  it('accepts participant phone for stored conversations', () => {
    const result = resolveWhatsappIdentity({
      source: 'stored',
      chat: { remoteJid: '183792384719283741@lid', displayName: 'Maria Legado' },
      messages: [
        {
          key: { participant: '5521981858541@s.whatsapp.net', fromMe: false },
        },
      ],
    });

    assert.equal(result.canonicalPhone, '5521981858541');
    assert.equal(result.identityStatus, 'verified');
    assert.equal(result.identitySource, 'message.key.participant');
  });
});
