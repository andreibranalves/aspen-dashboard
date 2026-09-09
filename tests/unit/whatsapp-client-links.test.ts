import assert from 'node:assert/strict';
import test from 'node:test';
import { createWhatsappContextHandler } from '../../api/_modules/whatsapp-context.js';
import { LinkConflict, type ClientLink } from '../../api/_infrastructure/db/repositories/whatsapp-client-links.js';

const id = '00000000-0000-4000-8000-000000000001';
const version = '00000000-0000-4000-8000-000000000002';
const client = { id, nome: 'Cliente exemplo', telefone: '41999701234', email: null, arquivado: false };
const scope = { accountId: '5511988881234@s.whatsapp.net', conversationId: '1234567890123@lid' };
function setup() {
  let saved: ClientLink | null = null;
  let saves = 0;
  const handler = createWhatsappContextHandler({
    findCandidatesByPhone: async phone => phone === '5541999701234' ? [{ ...client, tipo: 'cliente' }] : [],
    getClient: async () => client,
    links: {
      get: async key => key.accountId === scope.accountId ? saved : null,
      search: async () => [client],
      save: async (key, input) => {
        saves++;
        if (input.expectedVersion !== (saved?.version || null)) throw new LinkConflict();
        saved = { ...key, ...input, version, clientPhone: '5541999701234', source: 'operator', createdAt: new Date(), updatedAt: new Date() };
        return saved;
      },
      remove: async (_key, expected) => { if (expected !== saved?.version) throw new LinkConflict(); saved = null; },
    },
  });
  return { get saves() { return saves; }, call: async (method = 'GET', query = {}, input = {}) => {
    const response = await handler({ httpMethod: method, queryStringParameters: { ...scope, phone: '554199701234', ...query }, body: JSON.stringify(input), headers: {} });
    return { status: response.statusCode, ...JSON.parse(response.body || '{}') };
  } };
}

test('old mobile suggests, confirmation persists, another account cannot reuse link, unlink restores suggestion', async () => {
  const h = setup();
  const suggestion = await h.call();
  assert.equal(suggestion.match, 'suggested');
  assert.equal(suggestion.contact, undefined);
  assert.equal(h.saves, 0);
  assert.equal((await h.call('PUT', {}, { clientId: id, expectedClientPhone: '41999701234', expectedClientName: 'Cliente exemplo', expectedVersion: null })).ok, true);
  assert.equal((await h.call()).matchSource, 'operator');
  assert.equal((await h.call('GET', { accountId: '5511977771234@s.whatsapp.net' })).match, 'suggested');
  assert.equal((await h.call('PUT', {}, { clientId: id, expectedClientPhone: '41999701234', expectedClientName: 'Cliente exemplo', expectedVersion: null })).status, 409);
  assert.equal((await h.call('DELETE', {}, { expectedVersion: version })).ok, true);
  assert.equal((await h.call()).match, 'suggested');
});

test('conflicting evidence and changed phones never reveal linked history', async () => {
  const h = setup();
  await h.call('PUT', {}, { clientId: id, expectedClientPhone: '41999701234', expectedClientName: 'Cliente exemplo', expectedVersion: null });
  assert.equal((await h.call('GET', { phone: '5511988881234' })).match, 'conflict');
  const conflicting = { conversationId: '5511988881234@s.whatsapp.net' };
  assert.equal((await h.call('GET', conflicting)).match, 'conflict');
  assert.equal((await h.call('PUT', conflicting, { clientId: id, expectedClientPhone: '41999701234', expectedClientName: 'Cliente exemplo', expectedVersion: version })).status, 409);
});

test('LID without phone supports manual search; invalid scope cannot persist', async () => {
  const h = setup();
  assert.equal((await h.call('GET', { phone: '' })).match, 'unresolved');
  assert.equal((await h.call('GET', { phone: '', search: 'exemplo' })).candidates.length, 1);
  assert.equal((await h.call('PUT', { accountId: '' }, { clientId: id, expectedClientPhone: '41999701234', expectedClientName: 'Cliente exemplo', expectedVersion: null })).status, 409);
  assert.equal((await h.call('PUT', { conversationId: '123456@g.us' }, { clientId: id, expectedClientPhone: '41999701234', expectedClientName: 'Cliente exemplo', expectedVersion: null })).status, 400);
  assert.equal(h.saves, 0);
});

test('numeric header needs confirmation while an authoritative JID variant auto-matches', async () => {
  const h = setup();
  const header = await h.call('GET', { phone: '5541999701234', phoneSource: 'visible-phone' });
  assert.equal(header.match, 'suggested');
  assert.equal(header.contact, undefined);
  const changed = await h.call('GET', { phone: '5541999701234', conversationId: '554199701234@s.whatsapp.net' });
  assert.equal(changed.match, 'matched');
  assert.equal(changed.matchSource, 'phone');
  const exact = await h.call('GET', { phone: '5541999701234', conversationId: '5541999701234@s.whatsapp.net' });
  assert.equal(exact.match, 'matched');
});

test('active WhatsApp model auto-matches one exact LID client and one reversible phone variant', async () => {
  const h = setup();
  const exact = await h.call('GET', { phone: '5541999701234', phoneSource: 'active-model' });
  assert.equal(exact.match, 'matched');
  assert.equal(exact.matchSource, 'phone');
  assert.equal(exact.contact.id, id);

  const variant = await h.call('GET', { phoneSource: 'active-model' });
  assert.equal(variant.match, 'matched');
  assert.equal(variant.matchSource, 'phone-variant');
  assert.equal(variant.contact.id, id);
  assert.equal(h.saves, 0);
});

test('active WhatsApp model keeps multiple reversible phone variants ambiguous', async () => {
  const handler = createWhatsappContextHandler({
    findCandidatesByPhone: async phone => phone === '5541999701234' ? [
      { ...client, tipo: 'cliente' },
      { ...client, id: '00000000-0000-4000-8000-000000000003', nome: 'Outro cliente', tipo: 'cliente' },
    ] : [],
    links: {
      get: async () => null,
      search: async () => [],
      save: async () => { throw new Error('unexpected save'); },
      remove: async () => { throw new Error('unexpected remove'); },
    },
  });
  const response = await handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { ...scope, phone: '554199701234', phoneSource: 'active-model' },
    body: '',
  });
  const result = JSON.parse(response.body || '{}');
  assert.equal(result.match, 'ambiguous');
  assert.equal(result.candidates.length, 2);
});

test('auto-match checks the loaded client and projects that same validated read', async () => {
  let reads = 0;
  const query = { phone: '5541999701234', conversationId: '5541999701234@s.whatsapp.net' };
  const handler = createWhatsappContextHandler({
    findCandidatesByPhone: async () => [{ ...client, tipo: 'cliente' }],
    getClient: async () => { reads++; return reads === 1 ? client : { ...client, telefone: '11988881234' }; },
  });
  const response = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: query, body: '' });
  assert.equal(JSON.parse(response.body || '{}').match, 'matched');
  assert.equal(reads, 1);
  const changed = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: query, body: '' });
  assert.equal(JSON.parse(changed.body || '{}').match, 'conflict');
});
