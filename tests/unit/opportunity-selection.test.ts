import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialOpportunitySelection,
  isOpportunitySelectionValid,
  opportunitySelectionPayload,
  reconcileOpportunitySelection,
} from '../../src/features/quotations/opportunitySelection.ts';
import type { OpportunityChoice } from '../../src/lib/api/proposalOpportunitiesApi.ts';

function choice(opportunityId: string, demandSummary: string): OpportunityChoice {
  return {
    opportunityId,
    clientId: '00000000-0000-4000-8000-00000000000a',
    demandSummary,
    status: 'Novo Lead',
    updatedAt: '2026-09-11T12:00:00.000Z',
    proposalCount: 1,
  };
}

test('a client with no demand starts a new one', () => {
  const selection = initialOpportunitySelection([]);
  assert.equal(selection.mode, 'new');
  assert.equal(isOpportunitySelectionValid(selection, []), true);
  assert.deepEqual(opportunitySelectionPayload(selection), { new_demand: true });
});

test('a single plausible demand may be offered selected', () => {
  const choices = [choice('11111111-1111-4111-8111-111111111111', 'Cangas 100')];
  const selection = initialOpportunitySelection(choices);
  assert.equal(selection.mode, 'existing');
  assert.equal(selection.opportunityId, choices[0].opportunityId);
  assert.equal(isOpportunitySelectionValid(selection, choices), true);
  assert.deepEqual(opportunitySelectionPayload(selection), {
    opportunity_id: choices[0].opportunityId,
  });
});

test('several plausible demands require an explicit choice and never pick the latest', () => {
  const choices = [
    choice('11111111-1111-4111-8111-111111111111', 'Cangas 100'),
    choice('22222222-2222-4222-8222-222222222222', 'Toalhas 20'),
  ];
  const selection = initialOpportunitySelection(choices);
  assert.equal(selection.opportunityId, null, 'nothing is preselected');
  assert.equal(
    isOpportunitySelectionValid(selection, choices),
    false,
    'the operator must confirm before saving'
  );
});

test('a stale selection that is not among the choices is rejected', () => {
  const choices = [choice('11111111-1111-4111-8111-111111111111', 'Cangas 100')];
  const stale = {
    mode: 'existing' as const,
    opportunityId: '99999999-9999-4999-8999-999999999999',
    demandSummary: '',
  };
  assert.equal(isOpportunitySelectionValid(stale, choices), false);
});

test('an unresolved choice never silently becomes a new demand', () => {
  assert.deepEqual(
    opportunitySelectionPayload({ mode: 'existing', opportunityId: null, demandSummary: '' }),
    {}
  );
});

test('a new demand payload carries the optional summary', () => {
  assert.deepEqual(
    opportunitySelectionPayload({ mode: 'new', opportunityId: null, demandSummary: '  Cangas 100  ' }),
    { new_demand: true, demand_summary: 'Cangas 100' }
  );
});

test('hydration for the same client preserves the restored explicit choice', () => {
  const restored = {
    mode: 'existing' as const,
    opportunityId: '11111111-1111-4111-8111-111111111111',
    demandSummary: '',
  };
  const choices = [choice('11111111-1111-4111-8111-111111111111', 'Cangas 100')];
  const reconciled = reconcileOpportunitySelection(restored, choices, { sameClient: true });
  assert.deepEqual(reconciled, restored);
});

test('a restored choice no longer eligible stays blocked instead of selecting another', () => {
  const restored = {
    mode: 'existing' as const,
    opportunityId: '99999999-9999-4999-8999-999999999999',
    demandSummary: '',
  };
  const choices = [
    choice('11111111-1111-4111-8111-111111111111', 'Cangas 100'),
    choice('22222222-2222-4222-8222-222222222222', 'Toalhas 20'),
  ];
  const reconciled = reconcileOpportunitySelection(restored, choices, { sameClient: true });
  assert.deepEqual(reconciled, restored);
  assert.equal(isOpportunitySelectionValid(reconciled, choices), false);
});

test('an explicit new demand survives hydration', () => {
  const restored = {
    mode: 'new' as const,
    opportunityId: null,
    demandSummary: 'Cangas 100',
  };
  const reconciled = reconcileOpportunitySelection(restored, [], { sameClient: true });
  assert.deepEqual(reconciled, restored);
});

test('a real client change resets the choice and never picks the latest candidate', () => {
  const previous = {
    mode: 'new' as const,
    opportunityId: null,
    demandSummary: '',
  };
  const choices = [
    choice('11111111-1111-4111-8111-111111111111', 'Cangas 100'),
    choice('22222222-2222-4222-8222-222222222222', 'Toalhas 20'),
  ];
  const reconciled = reconcileOpportunitySelection(previous, choices, { sameClient: false });
  assert.equal(reconciled.mode, 'existing');
  assert.equal(reconciled.opportunityId, null);
  assert.equal(isOpportunitySelectionValid(reconciled, choices), false);
});
