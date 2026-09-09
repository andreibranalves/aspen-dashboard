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
