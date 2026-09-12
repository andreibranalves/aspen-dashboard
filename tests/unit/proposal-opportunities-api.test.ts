import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProposalOpportunitiesHandler,
  type ProposalOpportunityRepository,
} from '../../api/_modules/proposal-opportunities.js';

const CLIENT_ID = '00000000-0000-4000-8000-00000000000a';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-00000000000b';

function event(httpMethod: string, query: Record<string, string> = {}) {
  return { httpMethod, headers: {}, queryStringParameters: query, body: '' };
}

function repository(
  overrides: Partial<ProposalOpportunityRepository> = {}
): ProposalOpportunityRepository {
  return {
    listChoices: async () => [],
    listProposals: async () => [],
    ...overrides,
  };
}

test('GET /api/proposal-opportunities lists every open demand for a client', async () => {
  const handler = createProposalOpportunitiesHandler({
    repository: repository({
      listChoices: async () => [
        {
          opportunityId: OPPORTUNITY_ID,
          clientId: CLIENT_ID,
          demandSummary: 'Cangas 100 unidades',
          status: 'Novo Lead',
          updatedAt: '2026-09-11T12:00:00.000Z',
          proposalCount: 2,
        },
      ],
    }),
  });
  const result = await handler(event('GET', { client_id: CLIENT_ID }));
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body || '{}');
  assert.deepEqual(body.data, [
    {
      opportunity_id: OPPORTUNITY_ID,
      client_id: CLIENT_ID,
      demand_summary: 'Cangas 100 unidades',
      status: 'Novo Lead',
      updated_at: '2026-09-11T12:00:00.000Z',
      proposal_count: 2,
    },
  ]);
});

test('GET /api/proposal-opportunities lists every proposal of a demand', async () => {
  const handler = createProposalOpportunitiesHandler({
    repository: repository({
      listProposals: async () => [
        {
          quotationId: '00000000-0000-4000-8000-0000000000c1',
          businessNumber: 'ORC-20260001',
          status: 'rascunho',
          total: '250.00',
          createdAt: '2026-09-11T12:00:00.000Z',
        },
      ],
    }),
  });
  const result = await handler(event('GET', { opportunity_id: OPPORTUNITY_ID }));
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body || '{}');
  assert.deepEqual(body.proposals, [
    {
      quotation_id: '00000000-0000-4000-8000-0000000000c1',
      business_number: 'ORC-20260001',
      status: 'rascunho',
      total: '250.00',
      created_at: '2026-09-11T12:00:00.000Z',
    },
  ]);
});

test('GET /api/proposal-opportunities requires exactly one selector', async () => {
  const handler = createProposalOpportunitiesHandler({ repository: repository() });
  for (const query of [{}, { client_id: CLIENT_ID, opportunity_id: OPPORTUNITY_ID }]) {
    const result = await handler(event('GET', query));
    assert.equal(result.statusCode, 400);
  }
});

test('GET /api/proposal-opportunities rejects invalid identifiers', async () => {
  const handler = createProposalOpportunitiesHandler({ repository: repository() });
  for (const query of [{ client_id: 'not-a-uuid' }, { opportunity_id: '123' }]) {
    const result = await handler(event('GET', query));
    assert.equal(result.statusCode, 400);
  }
});

test('GET /api/proposal-opportunities never leaks repository failures', async () => {
  const handler = createProposalOpportunitiesHandler({
    repository: repository({
      listChoices: async () => {
        throw new Error('relation "crm_deals" does not exist');
      },
    }),
  });
  const result = await handler(event('GET', { client_id: CLIENT_ID }));
  assert.equal(result.statusCode, 503);
  assert.equal((result.body || '').includes('crm_deals'), false);
});

test('GET /api/proposal-opportunities rejects other methods', async () => {
  const handler = createProposalOpportunitiesHandler({ repository: repository() });
  const result = await handler(event('POST', { client_id: CLIENT_ID }));
  assert.equal(result.statusCode, 405);
});
