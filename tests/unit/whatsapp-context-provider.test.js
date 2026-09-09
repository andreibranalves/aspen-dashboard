import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../../extensions/whatsapp-context/provider.js', import.meta.url), 'utf8');
function setup(title, ids) {
  const runtime = vm.createContext({});
  vm.runInContext(source, runtime);
  const header = { getAttribute: () => title, textContent: title, querySelector: () => null };
  const main = { getAttribute: () => null, querySelectorAll: () => ids.map(id => ({ getAttribute: key => key === 'data-id' ? id : null })) };
  const documentRef = { querySelector: selector => selector.includes('header') || selector.includes('chat-title') ? header : selector === '[role="main"]' ? main : null };
  return { provider: runtime.AspenWhatsappProvider, documentRef };
}

test('provider reads selected message JID and connected account without turning LID into phone', async () => {
  const { provider, documentRef } = setup('Cliente exemplo', ['false_123456789012345@lid_message']);
  const result = await provider.resolveConversation({ documentRef, storageRef: { getItem: () => JSON.stringify('5511988881234:2@c.us') } });
  assert.equal(result.accountId, '5511988881234@s.whatsapp.net');
  assert.equal(result.technicalId, '123456789012345@lid');
  assert.equal(result.phone, undefined);
  assert.equal(result.status, 'unresolved');
});

test('provider preserves international JID, refuses groups and ambiguous conversation IDs', async () => {
  const direct = setup('Cliente exemplo', ['false_12025550123@c.us_message']);
  assert.equal((await direct.provider.resolveConversation({ documentRef: direct.documentRef })).phone, '12025550123');
  const group = setup('Equipe', ['false_123456789@g.us_message']);
  assert.equal((await group.provider.resolveConversation({ documentRef: group.documentRef })).status, 'unsupported');
  const ambiguous = setup('Cliente exemplo', ['false_12025550123@c.us_one', 'false_12025550124@c.us_two']);
  assert.equal((await ambiguous.provider.resolveConversation({ documentRef: ambiguous.documentRef })).technicalId, null);
});

test('a changed header is observed immediately for the same LID', async () => {
  const { provider, documentRef } = setup('+55 41 99970-1234', ['false_123456789012345@lid_message']);
  const first = await provider.resolveConversation({ documentRef });
  const header = documentRef.querySelector('header');
  header.getAttribute = () => '+55 11 98888-1234';
  const next = await provider.resolveConversation({ documentRef });
  assert.notEqual(first.phone, next.phone);
  assert.equal(next.phone, '5511988881234');
});

test('active model supplies identity when DOM only contains opaque message IDs', async () => {
  const { provider, documentRef } = setup('Contato exemplo', ['ABCD1234', 'EFGH5678']);
  const result = await provider.resolveConversation({ documentRef, readActiveIdentity: async () => ({ status: 'resolved', accountId: '5511988881234:2@c.us', technicalId: '123456789@lid', phone: '554191234567' }) });
  assert.equal(result.status, 'ready');
  assert.equal(result.technicalId, '123456789@lid');
  assert.equal(result.accountId, '5511988881234@s.whatsapp.net');
  assert.equal(result.phone, '554191234567');
});

test('provider refuses a stale active model while DOM has already switched conversations', async () => {
  const { provider, documentRef } = setup('Contato B', ['false_12025550124@c.us_message']);
  const stale = { status: 'resolved', accountId: '5511988881234:2@c.us', technicalId: '12025550123@c.us', phone: '12025550123' };
  const result = await provider.resolveConversation({ documentRef, readActiveIdentity: async () => stale });
  assert.equal(result.status, 'resolving');
  assert.equal(result.phone, undefined);
  assert.equal(result.technicalId, undefined);
});

test('provider refuses identity that changes between consecutive model reads', async () => {
  const { provider, documentRef } = setup('Contato exemplo', ['opaque-message-id']);
  const values = [
    { status: 'resolved', accountId: '5511988881234:2@c.us', technicalId: '12025550123@c.us', phone: '12025550123' },
    { status: 'resolved', accountId: '5511988881234:2@c.us', technicalId: '12025550124@c.us', phone: '12025550124' },
  ];
  const result = await provider.resolveConversation({ documentRef, readActiveIdentity: async () => values.shift() });
  assert.equal(result.status, 'resolving');
});

test('visible key includes header and composer recipient', () => {
  const { provider, documentRef } = setup('Contato exemplo', []);
  const original = documentRef.querySelector;
  documentRef.querySelector = selector => selector.includes('contenteditable')
    ? { getAttribute: () => 'Digite uma mensagem para +55 41 9123-4567' }
    : original(selector);
  assert.match(provider.visibleConversationKey(documentRef), /Contato exemplo\|Digite uma mensagem/);
});

test('provider rechecks DOM after the final model read', async () => {
  const state = { id: 'false_12025550123@c.us_message', title: 'Contato A' };
  const element = { getAttribute: name => name === 'data-id' ? state.id : null };
  const header = { getAttribute: () => state.title, textContent: state.title, querySelector: () => null };
  const main = { getAttribute: () => null, querySelectorAll: () => [element] };
  const documentRef = { querySelector: selector => selector.includes('header') || selector.includes('chat-title') ? header : selector === '[role="main"]' ? main : null };
  const runtime = vm.createContext({});
  vm.runInContext(source, runtime);
  let reads = 0;
  const result = await runtime.AspenWhatsappProvider.resolveConversation({ documentRef, readActiveIdentity: async () => {
    reads++;
    if (reads === 2) { state.id = 'false_12025550124@c.us_message'; state.title = 'Contato B'; header.textContent = state.title; }
    return { status: 'resolved', accountId: '5511988881234:2@c.us', technicalId: '12025550123@c.us', phone: '12025550123' };
  } });
  assert.equal(result.status, 'resolving');
});

test('exact LID to PN mapping may match the same PN found in DOM', async () => {
  const { provider, documentRef } = setup('Contato exemplo', ['false_12025550123@c.us_message']);
  const active = { status: 'resolved', accountId: '5511988881234:2@c.us', technicalId: '987654321@lid', phone: '12025550123' };
  const result = await provider.resolveConversation({ documentRef, readActiveIdentity: async () => active });
  assert.equal(result.status, 'ready');
  assert.equal(result.technicalId, '987654321@lid');
  assert.equal(result.phone, '12025550123');
});
