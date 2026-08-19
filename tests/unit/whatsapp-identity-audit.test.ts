import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditWhatsappIdentities } from '../../api/_modules/whatsapp-identity-audit.js';

describe('whatsapp-identity-audit', () => {
  it('classifies provider numeric jid as trusted', async () => {
    const report = await auditWhatsappIdentities({
      readConversations: async () => [
        {
          id: 'wa_1',
          providerConversationId: '5521981858541@s.whatsapp.net',
          remoteJid: '5521981858541@s.whatsapp.net',
          canonicalPhone: '5521981858541',
          phone: '5521981858541',
          displayLabel: 'Maria',
          displayName: 'Maria',
        },
      ],
      readMessages: async () => [],
    } as any);

    assert.equal(report.total, 1);
    assert.equal(report.counts.verifiedRemoteJid, 1);
    assert.equal(report.rows[0].classification, 'verified_remote_jid');
    assert.equal(report.rows[0].candidatePhone, '5521981858541');
  });

  it('classifies lid plus participant phone as trusted via message', async () => {
    const report = await auditWhatsappIdentities({
      readConversations: async () => [
        {
          id: 'wa_2',
          providerConversationId: '183792384719283741@lid',
          remoteJid: '183792384719283741@lid',
          canonicalPhone: '',
          phone: '',
          displayLabel: '',
          displayName: 'Cliente',
        },
      ],
      readMessages: async () => [
        {
          raw: {
            key: { participant: '5521981858541@s.whatsapp.net', fromMe: false },
          },
        },
      ],
    } as any);

    assert.equal(report.counts.verifiedMessageParticipant, 1);
    assert.equal(report.rows[0].classification, 'verified_message_participant');
    assert.equal(report.rows[0].candidatePhone, '5521981858541');
  });

  it('classifies legacy-only phone as polluted and not trusted', async () => {
    const report = await auditWhatsappIdentities({
      readConversations: async () => [
        {
          id: 'wa_3',
          providerConversationId: '183792384719283741@lid',
          remoteJid: '183792384719283741@lid',
          canonicalPhone: '',
          phone: '26359532982352',
          displayLabel: '',
          displayName: 'Contato sem nome',
        },
      ],
      readMessages: async () => [],
    } as any);

    assert.equal(report.counts.legacyOnly, 1);
    assert.equal(report.rows[0].classification, 'legacy_only');
    assert.equal(report.rows[0].candidatePhone, '');
  });
});
