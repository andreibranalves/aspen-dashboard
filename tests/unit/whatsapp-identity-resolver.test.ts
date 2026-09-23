import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhatsappIdentity } from '../../api/_modules/whatsapp-identity-resolver.js';

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

  describe('precedence against stored identity', () => {
    const storedHigh = {
      canonicalPhone: '5521981858541',
      identityStatus: 'verified',
      identitySource: 'chat.senderPn',
      identityConfidence: 'high',
    };

    it('reports conflict when two fresh sources contradict a trusted stored phone', () => {
      const result = resolveWhatsappIdentity({
        chat: { remoteJid: '183792384719283741@lid', phone: '5521911112222', senderPn: '5521933334444' },
        storedConversation: storedHigh,
      });
      assert.equal(result.identityStatus, 'conflict');
      assert.equal(result.canonicalPhone, '');
    });

    it('reports conflict when a single fresh phone contradicts a trusted stored phone', () => {
      const result = resolveWhatsappIdentity({
        chat: { remoteJid: '183792384719283741@lid', senderPn: '5521911112222' },
        storedConversation: storedHigh,
      });
      assert.equal(result.identityStatus, 'conflict');
      assert.equal(result.canonicalPhone, '');
    });

    it('reports conflict when weaker fresh evidence names another phone', () => {
      const result = resolveWhatsappIdentity({
        chat: { remoteJid: '5521911112222@s.whatsapp.net' },
        storedConversation: storedHigh,
      });
      assert.equal(result.identityStatus, 'conflict');
    });

    it('keeps a stored conflict until it is explicitly reviewed', () => {
      const result = resolveWhatsappIdentity({
        chat: { remoteJid: '183792384719283741@lid', senderPn: '5521911112222' },
        storedConversation: { canonicalPhone: '', identityStatus: 'conflict' },
      });
      assert.equal(result.identityStatus, 'conflict');
      assert.equal(result.canonicalPhone, '');
    });

    it('keeps the trusted stored phone when weaker fresh evidence agrees', () => {
      const result = resolveWhatsappIdentity({
        chat: { remoteJid: '5521981858541@s.whatsapp.net' },
        storedConversation: storedHigh,
      });
      assert.equal(result.identityStatus, 'verified');
      assert.equal(result.canonicalPhone, '5521981858541');
      assert.equal(result.identityConfidence, 'high');
    });
  });

  describe('Evolution 2.3 LID addressing', () => {
    it('uses key.remoteJidAlt as the phone of a LID conversation in both directions', () => {
      for (const fromMe of [false, true]) {
        const result = resolveWhatsappIdentity({
          chat: { remoteJid: '183792384719283741@lid' },
          messages: [{ key: { remoteJid: '183792384719283741@lid', remoteJidAlt: '5521981858541@s.whatsapp.net', fromMe } }],
          acceptLidAlternative: true,
        });
        assert.equal(result.providerConversationId, '183792384719283741@lid');
        assert.equal(result.canonicalPhone, '5521981858541');
        assert.equal(result.identityStatus, 'verified');
        assert.equal(result.identitySource, 'message.key.remoteJidAlt');
      }
    });

    it('ignores remoteJidAlt that is not a phone JID or belongs to a PN conversation', () => {
      const lidAlt = resolveWhatsappIdentity({
        chat: { remoteJid: '183792384719283741@lid' },
        messages: [{ key: { remoteJid: '183792384719283741@lid', remoteJidAlt: '99999@lid' } }],
        acceptLidAlternative: true,
      });
      assert.equal(lidAlt.identityStatus, 'unresolved');
      const pn = resolveWhatsappIdentity({
        chat: { remoteJid: '5521981858541@s.whatsapp.net' },
        messages: [{ key: { remoteJid: '5521981858541@s.whatsapp.net', remoteJidAlt: '5521911112222@s.whatsapp.net' } }],
        acceptLidAlternative: true,
      });
      assert.equal(pn.canonicalPhone, '5521981858541');
    });

    it('keeps follow-up identity unchanged unless the alternative is explicitly accepted', () => {
      const result = resolveWhatsappIdentity({
        chat: { remoteJid: '183792384719283741@lid' },
        messages: [{ key: { remoteJid: '183792384719283741@lid', remoteJidAlt: '5521981858541@s.whatsapp.net' } }],
      });
      assert.equal(result.identityStatus, 'unresolved');
    });
  });

  describe('fromMe normalization', () => {
    it('ignores message.from when fromMe is only set on the key', () => {
      const result = resolveWhatsappIdentity({
        source: 'stored',
        chat: { remoteJid: '183792384719283741@lid' },
        messages: [{ key: { fromMe: true }, from: '5521911112222' }],
      });
      assert.equal(result.canonicalPhone, '');
      assert.equal(result.identityStatus, 'unresolved');
    });

    it('ignores key.participant when fromMe is only set on the envelope', () => {
      const result = resolveWhatsappIdentity({
        source: 'stored',
        chat: { remoteJid: '183792384719283741@lid' },
        messages: [{ fromMe: true, key: { participant: '5521911112222@s.whatsapp.net' } }],
      });
      assert.equal(result.canonicalPhone, '');
    });

    it('ignores sender fields of a chat that is itself an outgoing message', () => {
      const result = resolveWhatsappIdentity({
        chat: {
          remoteJid: '183792384719283741@lid',
          key: { fromMe: true },
          sender: '5521911112222',
          participant: '5521933334444',
        },
      });
      assert.equal(result.canonicalPhone, '');
      assert.equal(result.identityStatus, 'unresolved');
    });
  });
});
