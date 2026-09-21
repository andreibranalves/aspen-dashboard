import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ClientMatchApiError,
  fetchClientMatches,
  fetchLinkedClient,
  parseClientMatchResponse,
} from '../../src/lib/api/clientMatchApi.ts';
import { buildQuotePayload } from '../../src/lib/api/quotationIssueApi.ts';
import {
  loadAutoQuoteDrafts,
  saveAutoQuoteDrafts,
} from '../../src/lib/storage/autoQuoteDraftStorage.ts';
import type { Draft, DraftEdited, StoredAutoQuoteDraft } from '../../src/types/domain.ts';

const CLIENT_A = '11111111-1111-4111-8111-111111111111';

const RESPONSE: unknown = {
  status: 'review',
  reason: 'weak_matches_only',
  matched_client_id: null,
  candidates: [
    {
      id: CLIENT_A,
      nome: 'Maria Souza',
      empresa: 'Souza Ltda',
      documento: '**.***.***/****-90',
      email: 'maria@example.com',
      telefone: '11988887777',
      arquivado: false,
      matched_by: ['nome', 'empresa'],
    },
  ],
  total_candidates: 1,
  page: 1,
  has_more: false,
};

function makeDraft(overrides: Partial<DraftEdited> = {}): Draft {
  return {
    index: 0,
    original: { nome: 'Maria Souza' },
    edited: {
      nome: 'Maria Souza',
      empresa: 'Souza Ltda',
      email: 'maria@example.com',
      telefone: '(11) 98888-7777',
      urgente: false,
      origem: 'Google Ads',
      cnpj: '',
      endereco: {
        cep: '',
        logradouro: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
      },
      items: [{ item_code: 'SKU-1', qty: 2, rate: 10 }],
      prazo_producao: '',
      ...overrides,
    },
    approved: false,
    discarded: false,
  };
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function withFetch<T>(
  handler: (url: string, init?: RequestInit) => Response,
  run: () => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

async function rejection(run: () => Promise<unknown>): Promise<ClientMatchApiError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof ClientMatchApiError, `unexpected error: ${String(error)}`);
    return error;
  }
  throw new Error('expected the call to reject');
}

test('the payload transports the link and only a true confirmation', () => {
  const linked = buildQuotePayload(makeDraft({ client_id: CLIENT_A }));
  assert.equal(linked.extracted.client_id, CLIENT_A);
  assert.equal('confirm_new_client' in linked.extracted, false);

  const confirmed = buildQuotePayload(makeDraft({ confirm_new_client: true }));
  assert.equal(confirmed.extracted.confirm_new_client, true);
  assert.equal('client_id' in confirmed.extracted, false);

  const explicitFalse = buildQuotePayload(makeDraft({ confirm_new_client: false }));
  assert.equal('confirm_new_client' in explicitFalse.extracted, false);
});

test('a persisted confirmation is not restored as authority', () => {
  const storage = createStorage();
  const persisted: StoredAutoQuoteDraft = {
    ...(makeDraft({ client_id: CLIENT_A, confirm_new_client: true }) as StoredAutoQuoteDraft),
  };
  saveAutoQuoteDrafts(storage, [persisted]);
  const [restored] = loadAutoQuoteDrafts(storage);
  assert.equal(restored.edited.client_id, CLIENT_A);
  assert.equal('confirm_new_client' in restored.edited, false);
  assert.equal(restored.edited.nome, 'Maria Souza');
  assert.deepEqual(restored.edited.items, [{ item_code: 'SKU-1', qty: 2, rate: 10 }]);
});

test('a legacy draft without the new fields still loads', () => {
  const storage = createStorage();
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [makeDraft()] }));
  const [restored] = loadAutoQuoteDrafts(storage);
  assert.equal(restored.edited.nome, 'Maria Souza');
  assert.equal(restored.edited.client_id, undefined);
  assert.equal('confirm_new_client' in restored.edited, false);
});

test('a malformed query envelope is an error, never an empty result', () => {
  assert.throws(() => parseClientMatchResponse({ ...(RESPONSE as object), status: 'maybe' }));
  assert.throws(() => parseClientMatchResponse({ ...(RESPONSE as object), candidates: 'none' }));
  assert.throws(() => parseClientMatchResponse({ ...(RESPONSE as object), has_more: undefined }));
  assert.throws(() => parseClientMatchResponse({ ...(RESPONSE as object), page: 0 }));
  assert.throws(() => parseClientMatchResponse({ ...(RESPONSE as object), reason: 'unclear' }));
  assert.throws(() => parseClientMatchResponse('nope'));
});

test('the query posts the identity and returns the parsed envelope', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const parsed = await withFetch(
    (url, init) => {
      requests.push({ url, body: JSON.parse(String(init?.body)) });
      return jsonResponse(200, RESPONSE);
    },
    () => fetchClientMatches({ nome: 'Maria Souza', empresa: 'Souza Ltda' })
  );
  assert.deepEqual(requests, [
    { url: '/api/client-matches', body: { nome: 'Maria Souza', empresa: 'Souza Ltda' } },
  ]);
  assert.equal(parsed.status, 'review');
  assert.equal(parsed.reason, 'weak_matches_only');
  assert.equal(parsed.candidates[0].matched_by[0], 'nome');
  assert.equal(parsed.candidates[0].arquivado, false);
});

test('a validation failure surfaces the server message and nothing else', async () => {
  const error = await withFetch(
    () => jsonResponse(400, { error: 'O CNPJ/CPF informado é inválido.' }),
    () => rejection(() => fetchClientMatches({ cnpj: '123' }))
  );
  assert.equal(error.status, 400);
  assert.equal(error.message, 'O CNPJ/CPF informado é inválido.');
});

test('an unavailable backend never leaks the body, driver text or stack trace', async () => {
  const error = await withFetch(
    () =>
      jsonResponse(503, {
        error: 'duplicate key value violates unique constraint "clients_tax_id_key"',
        stack: 'at ClientMatchRepository.search (api/_infrastructure/db/repositories/x.ts:41:9)',
      }),
    () => rejection(() => fetchClientMatches({ nome: 'Maria' }))
  );
  assert.equal(error.status, 503);
  assert.equal(error.message, 'Não foi possível verificar o cliente.');
  assert.equal(error.message.includes('constraint'), false);
  assert.equal(error.message.includes('repositories'), false);
});

test('a network failure rejects with the same safe error', async () => {
  const error = await withFetch(
    () => {
      throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:5432');
    },
    () => rejection(() => fetchClientMatches({ nome: 'Maria' }))
  );
  assert.equal(error.status, 0);
  assert.equal(error.message, 'Não foi possível verificar o cliente.');
});

test('the restored link is validated against the existing client endpoint', async () => {
  const requests: string[] = [];
  const active = await withFetch(
    (url) => {
      requests.push(url);
      return jsonResponse(200, {
        id: CLIENT_A,
        nome: 'Maria Souza',
        arquivado: false,
        archived: false,
        status: 'active',
      });
    },
    () => fetchLinkedClient(CLIENT_A)
  );
  assert.deepEqual(requests, [`/api/client-detail?name=${CLIENT_A}`]);
  assert.deepEqual(active, { id: CLIENT_A, nome: 'Maria Souza', arquivado: false });

  const archived = await withFetch(
    () => jsonResponse(200, { id: CLIENT_A, nome: 'Maria Souza', status: 'archived' }),
    () => fetchLinkedClient(CLIENT_A)
  );
  assert.deepEqual(archived, { id: CLIENT_A, nome: 'Maria Souza', arquivado: true });
});

test('an unknown or malformed linked client is a failure the card can retry', async () => {
  const missing = await withFetch(
    () => jsonResponse(404, { error: 'Cliente não encontrado.' }),
    () => rejection(() => fetchLinkedClient(CLIENT_A))
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.message, 'Não foi possível verificar o cliente.');

  const malformed = await withFetch(
    () => jsonResponse(200, { id: CLIENT_A, arquivado: false }),
    () => rejection(() => fetchLinkedClient(CLIENT_A))
  );
  assert.equal(malformed.message, 'Resposta inválida do cadastro do cliente.');
});
