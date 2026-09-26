import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createAtendimentoQuoteDraftHandler } from '../../api/_modules/atendimento-quote-draft.js';
import type { QuoteLeadRecord } from '../../api/_infrastructure/db/repositories/quote-leads-repository.js';

const conversationId = randomUUID();
const demandId = randomUUID();
const clientId = randomUUID();

function setup() {
  const rows = new Map<string, QuoteLeadRecord>();
  let admissions = 0;
  const handler = createAtendimentoQuoteDraftHandler({
    attendance: {
      getConversation: async (id) => id === conversationId ? {
        id, canonicalPhone: '5511999999999', displayName: 'Cliente', identityStatus: 'verified',
        identityVersion: 1, status: 'open', revision: 1, readRevision: 0, unreadCount: 1,
        lastMessageAt: null, lastMessagePreview: null, lastMessageDirection: null,
      } : null,
      getConversationScope: async () => null,
    },
    leads: {
      findByDemandId: async (id) => rows.get(id) || null,
      admitWhatsappDraft: async (input) => {
        admissions += 1;
        const id = String(input.demandId);
        const existing = rows.get(id);
        if (existing) return existing;
        const lead = {
          id: randomUUID(), demandId: id, externalId: String(input.externalId), crmDealId: randomUUID(),
          nome: String(input.nome || ''), email: String(input.email || ''), telefone: String(input.telefone || ''),
          raw: input.raw,
        } as QuoteLeadRecord;
        rows.set(id, lead);
        return lead;
      },
    },
    linkedClientId: async () => clientId,
  });
  const post = async (body: Record<string, unknown>) => {
    const response = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
    return { status: response.statusCode, body: JSON.parse(response.body || '{}') };
  };
  const get = async (id: string) => {
    const response = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { demandId: id } });
    return { status: response.statusCode, body: JSON.parse(response.body || '{}') };
  };
  return { post, get, rows, get admissions() { return admissions; } };
}

test('records the client header once and a repeated demand recovers the same lead', async () => {
  const flow = setup();
  const contact = { name: 'Maria  Silva', company: 'Loja X', email: 'Maria@Loja.com' };
  const first = await flow.post({ conversationId, demandId, contact });
  assert.equal(first.status, 201);
  assert.equal(first.body.text, 'Nome: Maria Silva\nEmpresa: Loja X\nE-mail: maria@loja.com\nTelefone: 5511999999999');
  assert.equal(first.body.name, 'Maria Silva');
  assert.equal(first.body.email, 'maria@loja.com');
  assert.equal(first.body.phone, '5511999999999');
  assert.equal(first.body.clientId, clientId);
  assert.equal(first.body.quoteLeadId, flow.rows.get(demandId)?.id);
  assert.deepEqual(flow.rows.get(demandId)?.raw?.atendimentoDraft, { text: first.body.text });
  const replay = await flow.post({ conversationId, demandId, contact: { name: 'Outro' } });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.deepEqual((await flow.get(demandId)).body, first.body);
  assert.equal(flow.admissions, 1);
});

test('a missing name or e-mail leaves the line empty and the profile name as fallback', async () => {
  const flow = setup();
  const draft = await flow.post({ conversationId, demandId, contact: {} });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.text, 'Nome: \nE-mail: \nTelefone: 5511999999999');
  assert.equal(draft.body.name, 'Cliente');
  assert.equal(draft.body.email, null);
});

test('rejects a demand from another conversation and an invalid contact', async () => {
  const flow = setup();
  await flow.post({ conversationId, demandId, contact: {} });
  assert.equal((await flow.post({ conversationId: randomUUID(), demandId, contact: {} })).status, 409);
  assert.equal((await flow.post({ conversationId, demandId: randomUUID(), contact: { email: 'sem arroba' } })).status, 400);
  assert.equal((await flow.post({ conversationId, demandId: randomUUID(), contact: { name: 'x'.repeat(256) } })).status, 400);
  assert.equal((await flow.post({ conversationId, demandId: randomUUID(), contact: { name: 42 } })).status, 400);
  assert.equal(flow.admissions, 1);
});

test('still opens a demand recorded from a message selection', async () => {
  const flow = setup();
  const selectionDemand = randomUUID();
  flow.rows.set(selectionDemand, {
    id: randomUUID(), demandId: selectionDemand, externalId: conversationId, crmDealId: null,
    nome: 'Cliente', email: '', telefone: '5511999999999',
    raw: { atendimentoDraft: { text: 'Quero 100 peças', messageIds: [randomUUID()] } },
  } as QuoteLeadRecord);
  const draft = await flow.get(selectionDemand);
  assert.equal(draft.status, 200);
  assert.equal(draft.body.text, 'Quero 100 peças');
});
