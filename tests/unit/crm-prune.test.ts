import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPruneCandidates,
  parseDealIds,
  pruneDeals,
  PRUNE_NEXT_STEP,
} from '../../api/modules/crm-prune.js';
import type {
  CrmDealRecord,
  CrmDealRepository,
  CrmPruneCandidate,
  CrmPruneResult,
} from '../../api/infrastructure/db/repositories/crm-deals-repository.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');

function repositoryThatNowHasOrder(): CrmDealRepository {
  const candidate: CrmPruneCandidate = {
    deal_id: 'deal-1',
    lead_name: 'Ana',
    quotation: 'ORC-20260001',
    quotation_date: '2026-07-01',
    age_days: 40,
    deal_modified: '2026-07-01T12:00:00.000Z',
    grand_total: 100,
  };
  const row: CrmDealRecord = {
    id: 'deal-1',
    quoteLeadId: null,
    clientId: null,
    quotationId: 'quotation-1',
    nome: 'Ana',
    email: 'ana@example.com',
    telefone: '5511999990000',
    status: 'Orcamento Enviado',
    followUpStage: 0,
    nextStep: null,
    lostReason: null,
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    updatedAt: new Date('2026-07-01T12:00:00.000Z'),
    quotation: 'ORC-20260001',
  };
  const result: CrmPruneResult = {
    success: true,
    updated: 0,
    skipped: 1,
    skipped_deals: [{ deal_id: 'deal-1', reason: 'Pedido criado após a listagem.' }],
  };

  return {
    async list() {
      return [row];
    },
    async updateStatus() {
      return row;
    },
    async upsertForQuotation() {
      return row;
    },
    async prune() {
      return result;
    },
    async listPruneCandidates() {
      return [candidate];
    },
  };
}

test('returns local prune candidates with the Kanban response fields', async () => {
  const repository = repositoryThatNowHasOrder();
  assert.deepEqual(await getPruneCandidates(repository, NOW), [
    {
      deal_id: 'deal-1',
      lead_name: 'Ana',
      quotation: 'ORC-20260001',
      quotation_date: '2026-07-01',
      age_days: 40,
      deal_modified: '2026-07-01T12:00:00.000Z',
      grand_total: 100,
    },
  ]);
});

test('revalidates a prune candidate before marking it lost', async () => {
  const result = await pruneDeals(['deal-1'], NOW, repositoryThatNowHasOrder());
  assert.deepEqual(result, {
    success: true,
    updated: 0,
    skipped: 1,
    skipped_deals: [{ deal_id: 'deal-1', reason: 'Pedido criado após a listagem.' }],
  });
});

test('keeps the Portuguese prune next step contract', () => {
  assert.equal(
    PRUNE_NEXT_STEP,
    'Marcado como perdido por limpeza de pipeline: sem resposta após 30 dias.'
  );
});

test('validates POST deal_ids payload', () => {
  assert.deepEqual(parseDealIds({ deal_ids: ['A', 'B', 'A', '', 123] }), ['A', 'B']);
  assert.throws(() => parseDealIds({ deal_ids: [] }), /Selecione ao menos uma oportunidade/);
  assert.throws(() => parseDealIds({}), /deal_ids deve ser uma lista/);
});
