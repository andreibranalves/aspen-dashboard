import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCommercialQueuePage } from '../../src/lib/api/commercialQueueApi.ts';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_id: '00000000-0000-4000-8000-00000000000a',
    opportunity_id: '00000000-0000-4000-8000-00000000000b',
    kind: 'first_contact',
    reason_code: 'new_lead',
    reason_label: 'Primeiro atendimento',
    origin: 'automatic',
    state: 'active',
    due_at: '2026-09-11T12:00:00.000Z',
    follow_up_stage: 0,
    demand_summary: 'Cangas 100 unidades',
    contact_name: 'Cliente Sintético',
    contact_phone: null,
    contact_email: null,
    client_id: null,
    client_name: null,
    proposals: [],
    ...overrides,
  };
}

test('parses the server-owned follow-up stage without queue-owned suggestion dates', () => {
  const page = parseCommercialQueuePage({
    data: [row({ follow_up_stage: 1 })],
    total: 1,
    page: 1,
    page_size: 25,
  });
  assert.equal(page.data[0].followUpStage, 1);
});

test('parses linked proposals with value and state', () => {
  const page = parseCommercialQueuePage({
    data: [
      row({
        proposals: [
          {
            quotation_id: '00000000-0000-4000-8000-0000000000c1',
            business_number: 'ORC-20260001',
            status: 'rascunho',
            total: '250.00',
          },
        ],
      }),
    ],
    total: 1,
    page: 1,
    page_size: 25,
  });
  assert.deepEqual(page.data[0].proposals, [
    {
      quotationId: '00000000-0000-4000-8000-0000000000c1',
      businessNumber: 'ORC-20260001',
      status: 'rascunho',
      total: '250.00',
    },
  ]);
});

test('rejects a payload without the proposals contract', () => {
  const withoutProposals = row();
  delete withoutProposals.proposals;
  assert.throws(() =>
    parseCommercialQueuePage({ data: [withoutProposals], total: 1, page: 1, page_size: 25 })
  );
});

test('rejects malformed proposals instead of silently dropping them', () => {
  assert.throws(() =>
    parseCommercialQueuePage({
      data: [row({ proposals: [{ business_number: 'ORC-1' }] })],
      total: 1,
      page: 1,
      page_size: 25,
    })
  );
});
