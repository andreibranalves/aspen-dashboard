import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { AI_MODEL } from '../../api/_modules/atendimento-ai.js';
import { createAtendimentoContactHandler } from '../../api/_modules/atendimento-contact.js';
import type { WhatsappMessageRecord } from '../../api/_infrastructure/db/repositories/whatsapp-attendance-repository.js';

const conversationId = randomUUID();

function message(body: string, direction: 'inbound' | 'outbound' = 'inbound', at = '2026-09-25T12:00:00Z'): WhatsappMessageRecord {
  return { id: randomUUID(), conversationId, messageType: 'text', body, direction, providerTimestamp: new Date(at) } as WhatsappMessageRecord;
}

function setup(options: {
  messages: WhatsappMessageRecord[];
  answer?: (sent: Array<{ id: string; text: string }>) => unknown;
  status?: number;
  identityStatus?: 'verified' | 'conflict';
}) {
  let sentPayload: Record<string, unknown> | null = null;
  let calls = 0;
  const handler = createAtendimentoContactHandler({
    attendance: {
      getConversation: async (id) => id === conversationId ? {
        id, canonicalPhone: '5521988887777', displayName: 'Mari', identityStatus: options.identityStatus || 'verified',
        identityVersion: 1, status: 'open', revision: 1, readRevision: 0, unreadCount: 0,
        lastMessageAt: null, lastMessagePreview: null, lastMessageDirection: null,
      } : null,
      listMessagesBefore: async () => ({ items: options.messages, hasMore: false }),
    },
    client: {
      config: () => ({ apiKey: 'test', model: AI_MODEL, siteUrl: '' }),
      request: async (payload) => {
        calls += 1;
        sentPayload = payload;
        const sent = JSON.parse((payload.messages as Array<{ content: string }>)[1].content) as Array<{ id: string; text: string }>;
        const answer = options.answer ? options.answer(sent) : { name: { value: '', messageId: '' }, company: { value: '', messageId: '' } };
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status: options.status || 200 });
      },
    },
  });
  const post = async (body: Record<string, unknown> = { conversationId }) => {
    const result = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
    return { status: result.statusCode, body: JSON.parse(result.body || '{}') };
  };
  return { post, get payload() { return sentPayload; }, get calls() { return calls; } };
}

test('reads name and company the client wrote, the newest inbound e-mail and the WhatsApp number', async () => {
  const intro = message('Oi! Aqui é a Maria Silva, da Loja Sol.', 'inbound', '2026-09-25T12:00:00Z');
  const oldEmail = message('meu email antigo: maria@antigo.com', 'inbound', '2026-09-25T12:01:00Z');
  const newEmail = message('Pode mandar para Maria.Silva@LojaSol.com.br.', 'inbound', '2026-09-25T12:02:00Z');
  const operator = message('Nosso e-mail é vendas@aspen.com', 'outbound', '2026-09-25T12:03:00Z');
  const flow = setup({
    messages: [intro, oldEmail, newEmail, operator],
    answer: () => ({ name: { value: 'maria silva', messageId: intro.id }, company: { value: 'Loja Sol', messageId: intro.id } }),
  });
  const result = await flow.post();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.name, { value: 'maria silva', messageId: intro.id, at: '2026-09-25T12:00:00.000Z' });
  assert.equal(result.body.company.value, 'Loja Sol');
  assert.deepEqual(result.body.email, { value: 'maria.silva@lojasol.com.br', messageId: newEmail.id, at: '2026-09-25T12:02:00.000Z' });
  assert.equal(result.body.phone, '5521988887777');
  assert.equal(result.body.profileName, 'Mari');
  assert.equal(result.body.modelUnavailable, false);
  // The operator's own messages never reach the model.
  const sent = JSON.parse((flow.payload?.messages as Array<{ content: string }>)[1].content) as Array<{ id: string }>;
  assert.deepEqual(sent.map((item) => item.id), [intro.id, oldEmail.id, newEmail.id]);
  assert.equal(flow.payload?.model, AI_MODEL);
  assert.equal('temperature' in (flow.payload || {}), false);
});

test('drops a name that is not written in the cited message', async () => {
  const hello = message('Bom dia, quero orçamento de camisetas');
  const other = message('Sou a Ana');
  for (const answer of [
    { value: 'Maria Silva', messageId: hello.id },
    { value: 'Ana', messageId: randomUUID() },
    { value: 'Ana', messageId: hello.id },
    { value: 'an', messageId: other.id },
  ]) {
    const flow = setup({ messages: [hello, other], answer: () => ({ name: answer, company: { value: '', messageId: '' } }) });
    const result = await flow.post();
    assert.equal(result.status, 200);
    assert.equal(result.body.name, null, JSON.stringify(answer));
  }
});

const noName = { name: { value: '', messageId: '' }, company: { value: '', messageId: '' } };

test('keeps the one-line order summary when its numbers are written in the cited messages', async () => {
  const hello = message('Olá, gostaria de um orçamento para Cangas personalizadas.', 'inbound', '2026-09-25T12:00:00Z');
  const reply = message('Qual a quantidade?', 'outbound', '2026-09-25T12:01:00Z');
  const quantity = message('Caso nao tenha quantidade mínima, inicialmente 10', 'inbound', '2026-09-25T12:02:00Z');
  const flow = setup({
    messages: [hello, reply, quantity],
    answer: () => ({
      ...noName,
      // Out of order, repeated, an operator message and an unknown ID.
      order: { summary: '  10 cangas   personalizadas ', messageIds: [quantity.id, hello.id, quantity.id, reply.id, randomUUID()] },
    }),
  });
  const result = await flow.post();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.order, { text: '10 cangas personalizadas', messageIds: [hello.id, quantity.id] });
});

test('a summary with a number the client did not write falls back to the cited messages', async () => {
  const hello = message('Quero cangas personalizadas', 'inbound', '2026-09-25T12:00:00Z');
  const detail = message('  Com logo  ', 'inbound', '2026-09-25T12:01:00Z');
  const flow = setup({
    messages: [hello, detail],
    answer: () => ({ ...noName, order: { summary: '30 cangas personalizadas com logo', messageIds: [detail.id, hello.id] } }),
  });
  assert.deepEqual((await flow.post()).body.order, { text: 'Quero cangas personalizadas\nCom logo', messageIds: [hello.id, detail.id] });
});

test('no order without a cited client message, and the fallback keeps the newest messages within the cap', async () => {
  const none = setup({ messages: [message('Oi')], answer: () => ({ ...noName, order: { summary: 'camisetas', messageIds: [] } }) });
  assert.equal((await none.post()).body.order, null);

  const old = message('a'.repeat(3_000), 'inbound', '2026-09-25T12:00:00Z');
  const recent = message('b'.repeat(3_000), 'inbound', '2026-09-25T12:01:00Z');
  const capped = setup({ messages: [old, recent], answer: () => ({ ...noName, order: { summary: '', messageIds: [old.id, recent.id] } }) });
  assert.deepEqual((await capped.post()).body.order, { text: 'b'.repeat(3_000), messageIds: [recent.id] });
});

test('reports a failed name read apart from a name that is not there', async () => {
  const flow = setup({ messages: [message('email: a@b.com')], status: 503 });
  const result = await flow.post();
  assert.equal(result.status, 200);
  assert.equal(result.body.name, null);
  assert.equal(result.body.order, null);
  assert.equal(result.body.modelUnavailable, true);
  assert.equal(result.body.email.value, 'a@b.com');
});

test('without client text there is no model call, and a conflicting identity hides the phone', async () => {
  const flow = setup({ messages: [message('Olá, tudo bem?', 'outbound')], identityStatus: 'conflict' });
  const result = await flow.post();
  assert.equal(result.status, 200);
  assert.equal(flow.calls, 0);
  assert.equal(result.body.email, null);
  assert.equal(result.body.phone, null);
  assert.equal(result.body.modelUnavailable, false);
});

test('rejects an invalid or unknown conversation', async () => {
  const flow = setup({ messages: [] });
  assert.equal((await flow.post({ conversationId: 'x' })).status, 400);
  assert.equal((await flow.post({ conversationId: randomUUID() })).status, 404);
});
