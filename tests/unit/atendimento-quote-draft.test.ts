import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createAtendimentoQuoteDraftHandler } from '../../api/_modules/atendimento-quote-draft.js';
import type { QuoteLeadRecord } from '../../api/_infrastructure/db/repositories/quote-leads-repository.js';

const conversationId = randomUUID();
const firstId = randomUUID();
const secondId = randomUUID();
const demandId = randomUUID();
const clientId = randomUUID();

function setup() {
  const rows = new Map<string, QuoteLeadRecord>();
  let admissions = 0;
  const messages = [
    { id: firstId, body: 'Quero  100 peças', messageType: 'text' as const },
    { id: secondId, body: 'Prazo?\nObrigado.', messageType: 'text' as const },
  ];
  const handler = createAtendimentoQuoteDraftHandler({
    attendance: {
      getConversation: async (id) => id === conversationId ? {
        id, canonicalPhone: '5511999999999', displayName: 'Cliente', identityStatus: 'verified',
        identityVersion: 1, status: 'open', revision: 1, readRevision: 0, unreadCount: 1,
        lastMessageAt: null, lastMessagePreview: null, lastMessageDirection: null,
      } : null,
      getConversationScope: async () => null,
      loadQuoteSelection: async (id, ids) => id === conversationId ? messages.filter((message) => ids.includes(message.id)) : [],
    },
    leads: {
      findByDemandId: async (id) => rows.get(id) || null,
      admitWhatsappDraft: async (input) => {
        admissions += 1;
        const id = String(input.demandId);
        const existing = rows.get(id);
        if (existing) return existing;
        const lead = {
          id: randomUUID(), demandId: id, externalId: String(input.externalId),
          crmDealId: randomUUID(), raw: input.raw,
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

test('prepares exact selected text once and a repeated demand recovers the same lead', async () => {
  const flow = setup();
  const first = await flow.post({ conversationId, demandId, messageIds: [secondId, firstId] });
  assert.equal(first.status, 201);
  assert.equal(first.body.text, 'Quero  100 peças\n\nPrazo?\nObrigado.');
  assert.equal(first.body.clientId, clientId);
  assert.equal(first.body.quoteLeadId, flow.rows.get(demandId)?.id);
  assert.deepEqual(flow.rows.get(demandId)?.raw?.atendimentoDraft, {
    text: first.body.text, messageIds: [firstId, secondId],
  });
  const replay = await flow.post({ conversationId, demandId, messageIds: [firstId] });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.deepEqual((await flow.get(demandId)).body, first.body);
  assert.equal(flow.admissions, 1);
});

test('rejects a demand from another conversation and selections outside the limits', async () => {
  const flow = setup();
  await flow.post({ conversationId, demandId, messageIds: [firstId] });
  assert.equal((await flow.post({ conversationId: randomUUID(), demandId, messageIds: [firstId] })).status, 409);
  assert.equal((await flow.post({ conversationId, demandId: randomUUID(), messageIds: [randomUUID()] })).status, 400);
  assert.equal((await flow.post({ conversationId, demandId: randomUUID(), messageIds: Array.from({ length: 51 }, () => randomUUID()) })).status, 413);
  assert.equal(flow.admissions, 1);
});
