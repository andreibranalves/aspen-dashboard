import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  LinkConflict,
  type ClientLink,
  type LinkScope,
  type WhatsappClientLinksRepository,
} from '../../api/_infrastructure/db/repositories/whatsapp-client-links.js';
import type { WhatsappConversationScope } from '../../api/_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import { createAtendimentoContextHandlers } from '../../api/_modules/atendimento-context.js';
import { createWhatsappContextHandler } from '../../api/_modules/whatsapp-context.js';

const ACCOUNT = '5511988881234@s.whatsapp.net';
const LID = '123456789012345@lid';
const conversationId = '0b9f1e52-7c1f-4d0e-9a51-3f7d3c1a2b40';
const client = { id: randomUUID(), nome: 'Cliente Exemplo', telefone: '41999701234', email: null, arquivado: false };

function memoryLinks() {
  const rows = new Map<string, ClientLink>();
  const key = (scope: LinkScope) => `${scope.accountId}|${scope.conversationId}`;
  const links: WhatsappClientLinksRepository = {
    get: async (scope) => rows.get(key(scope)) || null,
    search: async () => [client],
    save: async (scope, input) => {
      const current = rows.get(key(scope)) || null;
      if (input.expectedVersion !== (current?.version || null)) throw new LinkConflict();
      if (client.telefone !== input.expectedClientPhone || client.nome !== input.expectedClientName) throw new LinkConflict();
      const row = {
        ...scope,
        clientId: input.clientId,
        observedPhone: input.observedPhone,
        clientPhone: '5541999701234',
        version: randomUUID(),
        source: 'operator',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(key(scope), row);
      return row;
    },
    remove: async (scope, expected) => {
      if (rows.get(key(scope))?.version !== expected) throw new LinkConflict();
      rows.delete(key(scope));
    },
  };
  return { rows, links };
}

function setup(scope: Partial<WhatsappConversationScope> = {}, options: { account?: string; instance?: string } = {}) {
  const { rows, links } = memoryLinks();
  const context = {
    links,
    getClient: async () => client,
    findCandidatesByPhone: async (phone: string) => (phone === '5541999701234' ? [{ ...client, tipo: 'cliente' as const }] : []),
    history: {},
  };
  const conversation: WhatsappConversationScope = {
    instance: 'aspen',
    providerConversationId: LID,
    canonicalPhone: '5541999701234',
    identityStatus: 'derived',
    identityVersion: 1,
    ...scope,
  };
  const handlers = createAtendimentoContextHandlers({
    repository: { getConversationScope: async (id) => (id === conversationId ? conversation : null) },
    accountId: async () => options.account ?? ACCOUNT,
    instance: () => options.instance ?? 'aspen',
    context,
  });
  const read = async (query: Record<string, string> = {}) => {
    const result = await handlers.context({ httpMethod: 'GET', headers: {}, queryStringParameters: { conversationId, ...query } });
    return { status: result.statusCode, ...JSON.parse(result.body || '{}') };
  };
  const link = async (body: Record<string, unknown>) => {
    const result = await handlers.link({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: JSON.stringify({ conversationId, ...body }) });
    return { status: result.statusCode, ...JSON.parse(result.body || '{}') };
  };
  const confirm = { action: 'confirm', clientId: client.id, expectedClientName: client.nome, expectedClientPhone: client.telefone };
  return { rows, context, read, link, confirm };
}

test('the panel links in the same scope the extension reads: connected account and technical conversation', async () => {
  const panel = setup();
  const suggested = await panel.read();
  assert.equal(suggested.context.match, 'suggested', 'a derived phone only suggests');
  assert.equal(suggested.context.linking.available, true);

  const confirmed = await panel.link({ ...panel.confirm, expectedVersion: null });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.context.matchSource, 'operator');
  assert.deepEqual([...panel.rows.keys()], [`${ACCOUNT}|${LID}`]);

  const extension = createWhatsappContextHandler({ ...panel.context, env: {} });
  const seen = await extension({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { accountId: ACCOUNT, conversationId: LID, phone: '5541999701234' },
  });
  assert.equal(JSON.parse(seen.body || '{}').matchSource, 'operator');
});

test('AC-17: a confirmation made on an old view is refused and answers the current context', async () => {
  const panel = setup();
  const opened = await panel.read();
  const version = opened.context.linking.version;
  assert.equal(version, null);

  // Meanwhile the extension (or another tab) confirms the link.
  assert.equal((await panel.link({ ...panel.confirm, expectedVersion: null })).status, 200);

  const stale = await panel.link({ ...panel.confirm, expectedVersion: version });
  assert.equal(stale.status, 409);
  assert.equal(stale.code, 'CLIENT_LINK_CONFLICT');
  assert.equal(stale.context.matchSource, 'operator');
  assert.ok(stale.context.linking.version);

  const staleRemoval = await panel.link({ action: 'remove', expectedVersion: randomUUID() });
  assert.equal(staleRemoval.status, 409);
  assert.equal(panel.rows.size, 1);

  // A client changed after the panel opened is refused as well.
  const changedName = await panel.link({ ...panel.confirm, expectedClientName: 'Nome antigo', expectedVersion: stale.context.linking.version });
  assert.equal(changedName.code, 'CLIENT_LINK_CONFLICT');

  const removed = await panel.link({ action: 'remove', expectedVersion: stale.context.linking.version });
  assert.equal(removed.status, 200);
  assert.equal(removed.context.match, 'suggested');
});

test('the display name never confirms a client', async () => {
  const panel = setup({ canonicalPhone: null, identityStatus: 'unresolved' });
  const result = await panel.read();
  assert.equal(result.context.match, 'unresolved');
  assert.equal(result.context.contact, undefined);
  const search = await panel.read({ search: 'Exemplo' });
  assert.equal(search.context.match, 'suggested', 'a name search only lists candidates');
  assert.equal(panel.rows.size, 0);
});

test('a verified phone shows the matched context without creating a link', async () => {
  const panel = setup({ identityStatus: 'verified' });
  const result = await panel.read();
  assert.equal(result.context.match, 'matched');
  assert.equal(result.context.matchSource, 'phone');
  assert.equal(panel.rows.size, 0);
});

test('without a proven account scope nothing is linked', async () => {
  for (const panel of [
    setup({}, { account: '' }),
    setup({}, { instance: 'another-instance' }),
    setup({ providerConversationId: '120363000000000000@g.us' }),
  ]) {
    assert.equal((await panel.read()).context.linking.available, false);
    const refused = await panel.link({ ...panel.confirm, expectedVersion: null });
    assert.equal(refused.status, 409);
    assert.equal(refused.code, 'CLIENT_LINK_CONFLICT');
    assert.equal(panel.rows.size, 0);
  }
});

test('an identity conflict hides context and refuses to link', async () => {
  const panel = setup({ canonicalPhone: null, identityStatus: 'conflict' });
  const result = await panel.read();
  assert.equal(result.context.match, 'conflict');
  assert.equal(result.context.linking.available, false);
  assert.equal((await panel.link({ ...panel.confirm, expectedVersion: null })).status, 409);
});

test('validates input and never leaks internal failures', async () => {
  const panel = setup();
  assert.equal((await panel.read({ conversationId: 'x' })).status, 400);
  assert.equal((await panel.read({ conversationId: randomUUID() })).status, 404);
  assert.equal((await panel.read({ search: 'a' })).status, 400);
  assert.equal((await panel.link({ action: 'merge' })).status, 400);

  const broken = createAtendimentoContextHandlers({
    repository: {
      getConversationScope: async () => {
        throw new Error('relation "whatsapp_conversations" does not exist');
      },
    },
  });
  const failed = await broken.context({ httpMethod: 'GET', headers: {}, queryStringParameters: { conversationId } });
  assert.equal(failed.statusCode, 503);
  assert.doesNotMatch(failed.body || '', /relation|whatsapp_/);
});

test('the connected account is the phone JID of an open instance, cached briefly', async () => {
  const { readConnectedAccountId, resetConnectedAccountCache } = await import(
    '../../api/_infrastructure/integrations/evolution/account.js'
  );
  let calls = 0;
  const client = (entry: Record<string, unknown>, ok = true) => ({
    config: () => ({ baseUrl: 'http://evolution.test', apiKey: 'k', instance: 'aspen' }),
    request: async () => {
      calls += 1;
      return new Response(JSON.stringify([entry]), { status: ok ? 200 : 500 });
    },
  });
  resetConnectedAccountCache();
  const open = client({ name: 'aspen', connectionStatus: 'open', ownerJid: '5511988881234:12@s.whatsapp.net' });
  assert.equal(await readConnectedAccountId(open, () => 0), ACCOUNT, 'the device suffix is dropped');
  assert.equal(await readConnectedAccountId(open, () => 30_000), ACCOUNT);
  assert.equal(calls, 1, 'the second read within a minute is cached');
  assert.equal(await readConnectedAccountId(open, () => 61_000), ACCOUNT);
  assert.equal(calls, 2);
  resetConnectedAccountCache();
  assert.equal(await readConnectedAccountId(client({ name: 'aspen', connectionStatus: 'close', ownerJid: ACCOUNT }), () => 0), '');
  assert.equal(await readConnectedAccountId(client({ name: 'aspen', connectionStatus: 'open', ownerJid: LID }), () => 0), '');
  assert.equal(await readConnectedAccountId(client({}, false), () => 0), '');
});
