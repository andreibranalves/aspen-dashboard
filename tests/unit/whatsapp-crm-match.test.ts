import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveWhatsappCrmMatch } from '../../api/_functions/lib/whatsapp-crm-match.js';
import type {
  WhatsappConversation,
  WhatsappConversationStoreDeps,
} from '../../api/_functions/lib/whatsapp-conversations-store.js';

// ── Test helpers ──────────────────────────────────────────────────────────

function makeDeps(): WhatsappConversationStoreDeps & {
  listLeads: (filters: Array<Array<string | number>>) => Promise<Array<Record<string, unknown>>>;
  getDoc: (doctype: string, name: string) => Promise<Record<string, unknown> | null>;
  _setLeads: (value: Array<Record<string, unknown>>) => void;
  _setDocs: (doctype: string, name: string, doc: Record<string, unknown>) => void;
  _seedConversation: (conv: WhatsappConversation) => void;
  _getConversations: () => WhatsappConversation[];
} {
  let conversations: WhatsappConversation[] = [];
  let nextId = 1;
  let leads: Array<Record<string, unknown>> = [];
  const docs = new Map<string, Record<string, unknown>>();

  return {
    now: () => '2026-07-01T12:00:00.000Z',
    id: () => `wa_${nextId++}`,
    readConversations: async () => conversations,
    writeConversations: async (value) => {
      conversations = value;
    },
    readMessages: async () => [],
    writeMessages: async () => {},
    listLeads: async () => leads,
    getDoc: async (doctype, name) => docs.get(`${doctype}:${name}`) || null,
    _setLeads: (value) => {
      leads = value;
    },
    _setDocs: (doctype, name, doc) => {
      docs.set(`${doctype}:${name}`, doc);
    },
    _seedConversation: (conv) => {
      conversations = [conv];
    },
    _getConversations: () => conversations,
  };
}

function makeConversation(overrides: Partial<WhatsappConversation> = {}): WhatsappConversation {
  return {
    id: 'wa_1',
    remoteJid: '5511999999999@s.whatsapp.net',
    phone: '5511999999999',
    displayName: 'Maria Silva',
    lastMessageAt: '2026-07-01T12:00:00.000Z',
    lastMessagePreview: 'Quero orçamento',
    source: 'evolution',
    status: 'new',
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('whatsapp-crm-match', () => {
  it('prefers exact phone match over name fallback', async () => {
    const deps = makeDeps();
    deps._setLeads([
      { name: 'LEAD-001', lead_name: 'Maria Silva', first_name: 'Maria', email_id: 'maria@example.com', mobile_no: '5511999999999' },
    ]);
    deps._setDocs('Lead', 'LEAD-001', { name: 'LEAD-001', first_name: 'Maria', email_id: 'maria@example.com', mobile_no: '5511999999999' });

    const conv = makeConversation();
    deps._seedConversation(conv);

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.deepEqual(match, {
      id: 'LEAD-001',
      tipo: 'lead',
      nome: 'Maria',
      telefone: '5511999999999',
      email: 'maria@example.com',
      matchSource: 'phone',
    });
  });

  it('returns null when no candidates found', async () => {
    const deps = makeDeps();
    deps._setLeads([]);

    const conv = makeConversation({ phone: '5511000000000', displayName: 'Desconhecido' });
    deps._seedConversation(conv);

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match, null);
  });

  it('returns null when phone and name are too short for matching', async () => {
    const deps = makeDeps();

    const conv = makeConversation({ phone: '', displayName: 'A' });
    deps._seedConversation(conv);

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match, null);
  });

  it('uses name fallback when phone has no match', async () => {
    const deps = makeDeps();
    let callCount = 0;
    deps.listLeads = async (filters) => {
      callCount++;
      // phone queries (2 variants) return nothing
      if (callCount <= 2) return [];
      // name query
      return [
        { name: 'LEAD-002', lead_name: 'Maria Silva', first_name: 'Maria', email_id: null, mobile_no: '5511888888888' },
      ];
    };

    const conv = makeConversation({ phone: '5511000000000' });
    deps._seedConversation(conv);

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match?.matchSource, 'name');
    assert.equal(match?.id, 'LEAD-002');
  });

  it('validates and reuses a saved CRM link', async () => {
    const deps = makeDeps();
    deps._setDocs('Lead', 'LEAD-003', {
      name: 'LEAD-003',
      first_name: 'João',
      email_id: 'joao@test.com',
      mobile_no: '5511977777777',
    });

    const conv = makeConversation({
      linkedCrmEntityId: 'LEAD-003',
      linkedCrmEntityType: 'lead',
      linkedCrmMatchSource: 'phone',
    });
    deps._seedConversation(conv);

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match?.id, 'LEAD-003');
    assert.equal(match?.tipo, 'lead');
    assert.equal(match?.matchSource, 'phone');
  });

  it('clears invalid saved CRM link and resolves fresh', async () => {
    const deps = makeDeps();
    deps.getDoc = async () => null;
    deps._setLeads([
      { name: 'LEAD-004', lead_name: 'Ana Costa', first_name: 'Ana', email_id: null, mobile_no: '5511966666666' },
    ]);

    const conv = makeConversation({
      phone: '5511966666666',
      displayName: 'Ana Costa',
      linkedCrmEntityId: 'LEAD-DELETED',
      linkedCrmEntityType: 'lead',
      linkedCrmMatchSource: 'phone',
    });
    deps._seedConversation(conv);

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match?.id, 'LEAD-004');
    const convs = deps._getConversations();
    assert.equal(convs[0].linkedCrmEntityId, 'LEAD-004');
    assert.equal(convs[0].linkedCrmEntityType, 'lead');
  });

  it('persists CRM link fields after resolving match', async () => {
    const deps = makeDeps();
    deps._setLeads([
      { name: 'LEAD-005', lead_name: 'Pedro Alves', first_name: 'Pedro', email_id: null, mobile_no: '5511955555555' },
    ]);

    const conv = makeConversation({
      phone: '5511955555555',
      displayName: 'Pedro Alves',
    });
    deps._seedConversation(conv);

    await resolveWhatsappCrmMatch({ conversation: conv, deps });

    const convs = deps._getConversations();
    assert.equal(convs[0].linkedCrmEntityId, 'LEAD-005');
    assert.equal(convs[0].linkedCrmEntityType, 'lead');
    assert.equal(convs[0].linkedCrmMatchSource, 'phone');
  });

  it('skips name fallback for single-word names', async () => {
    const deps = makeDeps();
    deps._setLeads([]);

    const conv = makeConversation({ phone: '5511000000000', displayName: 'Maria' });
    deps._seedConversation(conv);

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match, null);
  });

  it('skips name fallback for very short names', async () => {
    const deps = makeDeps();
    deps._setLeads([]);

    const conv = makeConversation({ phone: '5511000000000', displayName: 'Ab Cd' });
    deps._seedConversation(conv);

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match, null);
  });

  // ── Email matching ─────────────────────────────────────────────────────

  it('matches by email extracted from inbound messages', async () => {
    const deps = makeDeps();
    deps._setLeads([
      { name: 'LEAD-EMAIL', lead_name: 'Carlos Lima', first_name: 'Carlos', email_id: 'carlos@test.com', mobile_no: null },
    ]);
    deps._setDocs('Lead', 'LEAD-EMAIL', { name: 'LEAD-EMAIL', first_name: 'Carlos', email_id: 'carlos@test.com', mobile_no: null });

    const conv = makeConversation({ phone: '5511000000000', displayName: 'Desconhecido' });
    deps._seedConversation(conv);
    deps.readMessages = async () => [
      { id: 'm1', conversationId: 'wa_1', providerMessageId: 'p1', direction: 'inbound', type: 'text' as const, body: 'Olá, meu email é carlos@test.com', mediaUrl: '', timestamp: '2026-07-01T11:00:00.000Z' },
    ];

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match?.id, 'LEAD-EMAIL');
    assert.equal(match?.matchSource, 'email');
    assert.equal(match?.email, 'carlos@test.com');
  });

  it('ignores emails from outbound messages', async () => {
    const deps = makeDeps();
    deps._setLeads([
      { name: 'LEAD-OUT', lead_name: 'Test', first_name: 'Test', email_id: 'test@test.com', mobile_no: null },
    ]);

    const conv = makeConversation({ phone: '5511000000000', displayName: 'A B C' });
    deps._seedConversation(conv);
    deps.readMessages = async () => [
      { id: 'm1', conversationId: 'wa_1', providerMessageId: 'p1', direction: 'outbound', type: 'text' as const, body: 'Envie para test@test.com', mediaUrl: '', timestamp: '2026-07-01T11:00:00.000Z' },
    ];

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match, null);
  });

  // ── Phone prefix robustness ────────────────────────────────────────────

  it('matches when ERP stores phone with 55 prefix and conversation has local number', async () => {
    const deps = makeDeps();
    deps._setLeads([
      { name: 'LEAD-55', lead_name: 'Rita Santos', first_name: 'Rita', email_id: null, mobile_no: '5511988887777' },
    ]);
    deps._setDocs('Lead', 'LEAD-55', { name: 'LEAD-55', first_name: 'Rita', email_id: null, mobile_no: '5511988887777' });

    // Conversation phone has no 55 prefix
    const conv = makeConversation({ phone: '11988887777', displayName: 'Rita Santos' });
    deps._seedConversation(conv);

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match?.id, 'LEAD-55');
    assert.equal(match?.matchSource, 'phone');
  });

  it('matches when ERP stores phone without 55 prefix and conversation has full number', async () => {
    const deps = makeDeps();
    deps._setLeads([
      { name: 'LEAD-NO55', lead_name: 'João Neto', first_name: 'João', email_id: null, mobile_no: '11988887777' },
    ]);
    deps._setDocs('Lead', 'LEAD-NO55', { name: 'LEAD-NO55', first_name: 'João', email_id: null, mobile_no: '11988887777' });

    // Conversation phone has 55 prefix
    const conv = makeConversation({ phone: '5511988887777', displayName: 'João Neto' });
    deps._seedConversation(conv);

    const match = await resolveWhatsappCrmMatch({ conversation: conv, deps });

    assert.equal(match?.id, 'LEAD-NO55');
    assert.equal(match?.matchSource, 'phone');
  });
});
