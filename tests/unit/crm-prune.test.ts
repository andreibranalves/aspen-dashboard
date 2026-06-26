import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getPruneCandidates,
  parseDealIds,
  pruneDeals,
} from '../../api/_functions/lib/crm-prune.js';

function makeDeps(data: {
  deals: Record<string, unknown>[];
  quotations: Record<string, unknown>[];
  linkedItems?: Record<string, unknown>[];
}) {
  const puts: Array<{ doctype: string; name: string; payload: Record<string, unknown> }> = [];

  return {
    deps: {
      erpGetList: async (doctype: string) => {
        if (doctype === 'CRM Deal') return data.deals;
        if (doctype === 'Quotation') return data.quotations;
        if (doctype === 'Sales Order Item') return data.linkedItems || [];
        throw new Error(`Unexpected doctype: ${doctype}`);
      },
      erpPut: async (doctype: string, name: string, payload: Record<string, unknown>) => {
        puts.push({ doctype, name, payload });
        return { name, ...payload };
      },
    },
    puts,
  };
}

const NOW = new Date('2026-06-26T12:00:00.000Z');

describe('crm-prune helper', () => {
  it('returns only old quotation deals that were not recently modified and have no sales order', async () => {
    const { deps } = makeDeps({
      deals: [
        {
          name: 'DEAL-OLD',
          lead_name: 'Cliente Antigo',
          status: 'Orcamento Enviado',
          custom_quotation: 'QTN-OLD',
          modified: '2026-06-01T10:00:00.000Z',
        },
        {
          name: 'DEAL-RECENT-DEAL',
          lead_name: 'Cliente Mexido',
          status: 'Orcamento Enviado',
          custom_quotation: 'QTN-OLD-2',
          modified: '2026-06-24T10:00:00.000Z',
        },
        {
          name: 'DEAL-NO-QUOTE',
          lead_name: 'Sem orçamento',
          status: 'Orcamento Enviado',
          custom_quotation: '',
          modified: '2026-06-01T10:00:00.000Z',
        },
        {
          name: 'DEAL-WRONG-STATUS',
          lead_name: 'Negociando',
          status: 'Em Negociacao',
          custom_quotation: 'QTN-OLD-3',
          modified: '2026-06-01T10:00:00.000Z',
        },
      ],
      quotations: [
        { name: 'QTN-OLD', transaction_date: '2026-05-20', grand_total: 1234.56, status: 'Open' },
        { name: 'QTN-OLD-2', transaction_date: '2026-05-20', grand_total: 999, status: 'Open' },
        { name: 'QTN-OLD-3', transaction_date: '2026-05-20', grand_total: 888, status: 'Open' },
      ],
      linkedItems: [],
    });

    const candidates = await getPruneCandidates(deps, NOW);

    assert.deepEqual(candidates, [
      {
        deal_id: 'DEAL-OLD',
        lead_name: 'Cliente Antigo',
        quotation: 'QTN-OLD',
        quotation_date: '2026-05-20',
        age_days: 37,
        deal_modified: '2026-06-01T10:00:00.000Z',
        grand_total: 1234.56,
      },
    ]);
  });

  it('excludes old quotations that already have linked sales orders', async () => {
    const { deps } = makeDeps({
      deals: [
        {
          name: 'DEAL-LINKED',
          lead_name: 'Cliente Fechado',
          status: 'Orcamento Enviado',
          custom_quotation: 'QTN-LINKED',
          modified: '2026-06-01T10:00:00.000Z',
        },
      ],
      quotations: [
        { name: 'QTN-LINKED', transaction_date: '2026-05-01', grand_total: 2000, status: 'Open' },
      ],
      linkedItems: [{ prevdoc_docname: 'QTN-LINKED' }],
    });

    assert.deepEqual(await getPruneCandidates(deps, NOW), []);
  });

  it('revalidates selected deals before marking them as Perdido', async () => {
    const { deps, puts } = makeDeps({
      deals: [
        {
          name: 'DEAL-VALID',
          lead_name: 'Cliente Valido',
          status: 'Orcamento Enviado',
          custom_quotation: 'QTN-VALID',
          modified: '2026-06-01T10:00:00.000Z',
        },
        {
          name: 'DEAL-RECENT',
          lead_name: 'Cliente Recente',
          status: 'Orcamento Enviado',
          custom_quotation: 'QTN-RECENT',
          modified: '2026-06-25T10:00:00.000Z',
        },
      ],
      quotations: [
        { name: 'QTN-VALID', transaction_date: '2026-05-01', grand_total: 1000, status: 'Open' },
        { name: 'QTN-RECENT', transaction_date: '2026-05-01', grand_total: 1000, status: 'Open' },
      ],
    });

    const result = await pruneDeals(['DEAL-VALID', 'DEAL-RECENT', 'DEAL-MISSING'], deps, NOW);

    assert.equal(result.success, true);
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 2);
    assert.deepEqual(result.skipped_deals, [
      { deal_id: 'DEAL-RECENT', reason: 'Deal não está mais elegível para limpeza.' },
      { deal_id: 'DEAL-MISSING', reason: 'Deal não está mais elegível para limpeza.' },
    ]);
    assert.deepEqual(puts, [
      {
        doctype: 'CRM Deal',
        name: 'DEAL-VALID',
        payload: {
          status: 'Perdido',
          lost_reason: 'Unresponsive Prospect',
          next_step: 'Marcado como perdido por limpeza de pipeline: sem resposta após 30 dias.',
        },
      },
    ]);
  });

  it('validates POST deal_ids payload', () => {
    assert.deepEqual(parseDealIds({ deal_ids: ['A', 'B', 'A', '', 123] }), ['A', 'B']);
    assert.throws(() => parseDealIds({ deal_ids: [] }), /Selecione ao menos uma oportunidade/);
    assert.throws(() => parseDealIds({}), /deal_ids deve ser uma lista/);
  });
});
