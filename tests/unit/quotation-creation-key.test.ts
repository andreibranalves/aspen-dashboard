import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { buildQuotePayload } from '../../src/lib/api/quotationIssueApi.ts';
import {
  ensureCreationRequestId,
  dispatchAfterDraftPersistence,
} from '../../src/features/quotations/creationRequest.ts';
import { formatOpportunityProposal } from '../../src/features/crm/opportunityProposals.ts';
import {
  loadAutoQuoteDrafts,
  saveAutoQuoteDrafts,
} from '../../src/lib/storage/autoQuoteDraftStorage.ts';
import type { Draft } from '../../src/types/domain.ts';

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    index: 0,
    original: {},
    approved: false,
    discarded: false,
    edited: {
      nome: 'Cliente',
      email: '',
      telefone: '',
      urgente: false,
      origem: 'site_form',
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
      items: [{ item_code: 'SKU-1', qty: 2, rate: 10, item_name: 'Produto' }],
      prazo_producao: '',
    },
    ...overrides,
  };
}

test('the creation key travels in the draft payload for a stable retry', () => {
  const creationRequestId = randomUUID();
  const payload = buildQuotePayload(draft({ creationRequestId }));
  assert.equal(payload.extracted.creation_request_id, creationRequestId);
});

test('legacy payloads without a creation key keep working', () => {
  const payload = buildQuotePayload(draft());
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload.extracted, 'creation_request_id'),
    false
  );
});

test('editing and reloading a draft keep the same creation key', () => {
  const creationRequestId = randomUUID();
  const first = ensureCreationRequestId(draft({ creationRequestId }), () => randomUUID());
  const edited = ensureCreationRequestId({ ...first, edited: { ...first.edited, nome: 'Cliente editado' } }, () => randomUUID());
  const reloaded = ensureCreationRequestId(JSON.parse(JSON.stringify(edited)), () => randomUUID());
  assert.equal(edited.creationRequestId, creationRequestId);
  assert.equal(reloaded.creationRequestId, creationRequestId);
});

test('a lost response, edit and reload reuse the creation key on retry', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const creationRequestId = randomUUID();
  const initial = ensureCreationRequestId(draft({ creationRequestId }));
  const sentKeys: string[] = [];

  await assert.rejects(
    dispatchAfterDraftPersistence(
      initial,
      (persisted) => saveAutoQuoteDrafts(storage, [persisted]),
      async (persisted) => {
        sentKeys.push(persisted.creationRequestId);
        throw new Error('resposta perdida');
      },
    ),
    /resposta perdida/,
  );

  const edited = ensureCreationRequestId({
    ...initial,
    edited: { ...initial.edited, nome: 'Cliente editado' },
  });
  assert.equal(saveAutoQuoteDrafts(storage, [edited]), true);
  const reloaded = loadAutoQuoteDrafts(storage)[0]!;
  const retry = await dispatchAfterDraftPersistence(
    reloaded,
    () => true,
    async (persisted) => {
      sentKeys.push(persisted.creationRequestId);
      return buildQuotePayload(persisted).extracted.creation_request_id;
    },
  );

  assert.equal(retry, creationRequestId);
  assert.deepEqual(sentKeys, [creationRequestId, creationRequestId]);
});

test('a persistence failure prevents the creation dispatch', async () => {
  let dispatches = 0;
  const result = await dispatchAfterDraftPersistence(
    draft({ creationRequestId: randomUUID() }),
    () => false,
    async () => {
      dispatches += 1;
      return 'created';
    },
  );
  assert.equal(result, null);
  assert.equal(dispatches, 0);
});

test('an automatic result carries its explicit demand link or new-demand intent', () => {
  const linked = buildQuotePayload(
    draft({ edited: { ...draft().edited, opportunity_id: randomUUID() } })
  );
  assert.equal(typeof linked.extracted.opportunity_id, 'string');

  const created = buildQuotePayload(
    draft({ edited: { ...draft().edited, new_demand: true, demand_summary: 'Cangas 100' } })
  );
  assert.equal(created.extracted.new_demand, true);
  assert.equal(created.extracted.demand_summary, 'Cangas 100');
});

test('opportunity proposals render number, state and value', () => {
  assert.equal(
    formatOpportunityProposal({
      quotationId: randomUUID(),
      businessNumber: 'ORC-20260001',
      status: 'rascunho',
      total: '250.00',
      createdAt: '2026-09-11T12:00:00.000Z',
    }),
    'ORC-20260001 · rascunho · R$\u00a0250,00'
  );
});

test('opportunity proposals without a value are still labelled', () => {
  assert.equal(
    formatOpportunityProposal({
      quotationId: randomUUID(),
      businessNumber: 'ORC-20260002',
      status: 'emitido',
      total: null,
      createdAt: '2026-09-11T12:00:00.000Z',
    }),
    'ORC-20260002 · emitido · Sem valor'
  );
});
