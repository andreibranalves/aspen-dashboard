import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backfillWhatsappIdentities } from '../../api/_modules/whatsapp-identity-backfill.js';

describe('whatsapp-identity-backfill', () => {
  it('reprocesses conversations and upgrades legacy phone into verified identity', async () => {
    let written: any[] = [];
    const deps = {
      readConversations: async () =>
        [
          {
            id: 'wa_1',
            providerConversationId: '',
            remoteJid: '5521981858541@s.whatsapp.net',
            canonicalPhone: '',
            phone: '5521981858541',
            displayLabel: '',
            displayName: 'Maria',
            identityStatus: 'unresolved' as const,
            identitySource: null,
            identityConfidence: null,
            source: 'evolution' as const,
            status: 'new' as const,
            lastMessageAt: '2026-07-01T12:00:00.000Z',
            lastMessagePreview: '',
            createdAt: '2026-07-01T12:00:00.000Z',
            updatedAt: '2026-07-01T12:00:00.000Z',
          },
        ] as any[],
      writeConversations: async (convs: any[]) => {
        written = convs;
      },
      readMessages: async () => [],
      now: () => '2026-07-01T12:00:00.000Z',
    };

    const result = await backfillWhatsappIdentities(deps);
    assert.equal(result.total, 1);
    assert.equal(result.fixed, 1);
    assert.equal(result.unresolved, 0);
    assert.equal(written[0].canonicalPhone, '5521981858541');
    assert.equal(written[0].displayLabel, 'Maria');
    assert.equal(written[0].identityStatus, 'verified');
    assert.equal(written[0].identityConfidence, 'high');
  });

  it('keeps conversations unresolved and fills fallback label when no identity can be derived', async () => {
    let written: any[] = [];
    const deps = {
      readConversations: async () =>
        [
          {
            id: 'wa_2',
            providerConversationId: '',
            remoteJid: '183792384719283741@lid',
            canonicalPhone: '',
            phone: '',
            displayLabel: '',
            displayName: '',
            identityStatus: 'unresolved' as const,
            identitySource: null,
            identityConfidence: null,
            source: 'evolution' as const,
            status: 'new' as const,
            lastMessageAt: '2026-07-01T12:00:00.000Z',
            lastMessagePreview: '',
            createdAt: '2026-07-01T12:00:00.000Z',
            updatedAt: '2026-07-01T12:00:00.000Z',
          },
        ] as any[],
      writeConversations: async (convs: any[]) => {
        written = convs;
      },
      readMessages: async () => [],
      now: () => '2026-07-01T12:00:00.000Z',
    };

    const result = await backfillWhatsappIdentities(deps);
    assert.equal(result.unresolved, 1);
    assert.equal(result.unchanged, 0);
    assert.equal(written[0].canonicalPhone, '');
    assert.equal(written[0].displayLabel, 'Contato sem nome');
    assert.equal(written[0].identityStatus, 'unresolved');
  });
});
