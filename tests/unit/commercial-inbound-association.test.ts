import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyInboundAssociation,
  type InboundAssociationInput,
} from '../../api/_modules/commercial-inbound-association.js';

function input(overrides: Partial<InboundAssociationInput> = {}): InboundAssociationInput {
  return {
    identityStatus: 'verified',
    canonicalPhone: '+55 11 91234-5678',
    linkedOpportunityIds: [],
    ...overrides,
  };
}

test('inbound with a verified identity and a single linked opportunity is unambiguous', () => {
  assert.deepEqual(
    classifyInboundAssociation(
      input({ linkedOpportunityIds: ['11111111-1111-4111-8111-111111111111'] })
    ),
    { outcome: 'unambiguous', opportunityId: '11111111-1111-4111-8111-111111111111' }
  );
});

test('inbound with duplicated linked opportunities deduplicates preserving insertion order', () => {
  assert.deepEqual(
    classifyInboundAssociation(
      input({
        linkedOpportunityIds: [
          '22222222-2222-4222-8222-222222222222',
          '11111111-1111-4111-8111-111111111111',
          '  22222222-2222-4222-8222-222222222222  ',
          '11111111-1111-4111-8111-111111111111',
        ],
      })
    ),
    {
      outcome: 'ambiguous',
      candidateOpportunityIds: [
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
      ],
    }
  );
});

test('inbound with a derived identity and multiple linked opportunities is ambiguous in insertion order', () => {
  assert.deepEqual(
    classifyInboundAssociation(
      input({
        identityStatus: 'derived',
        linkedOpportunityIds: [
          '33333333-3333-4333-8333-333333333333',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      })
    ),
    {
      outcome: 'ambiguous',
      candidateOpportunityIds: [
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    }
  );
});

test('inbound with an unresolved identity is none', () => {
  assert.deepEqual(
    classifyInboundAssociation(input({ identityStatus: 'unresolved', canonicalPhone: null })),
    { outcome: 'none' }
  );
});

test('inbound with a conflicting identity is none', () => {
  assert.deepEqual(classifyInboundAssociation(input({ identityStatus: 'conflict' })), {
    outcome: 'none',
  });
});

test('inbound with a verified identity but no canonical phone is none', () => {
  assert.deepEqual(
    classifyInboundAssociation(
      input({
        canonicalPhone: null,
        linkedOpportunityIds: ['11111111-1111-4111-8111-111111111111'],
      })
    ),
    { outcome: 'none' }
  );
});

test('inbound whose linked opportunities are all blank is none', () => {
  assert.deepEqual(classifyInboundAssociation(input({ linkedOpportunityIds: ['  ', ''] })), {
    outcome: 'none',
  });
});
