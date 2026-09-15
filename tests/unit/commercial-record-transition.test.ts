import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoFalseSilenceLabel,
  classifyOpportunityTransition,
  FALSE_SILENCE_LABEL,
  INSUFFICIENT_EVIDENCE_REVIEW_REASON,
  summarizeTransitionDecisions,
  type OpportunityTransitionFacts,
} from '../../api/_modules/commercial-record-transition.js';

function facts(overrides: Partial<OpportunityTransitionFacts> = {}): OpportunityTransitionFacts {
  return {
    opportunityId: '11111111-1111-4111-8111-111111111111',
    status: 'Orcamento Enviado',
    clientId: '22222222-2222-4222-8222-222222222222',
    siblingOpenOpportunityIds: [],
    hasActiveNextAction: false,
    hasSuspendedRestrictedAction: false,
    hasAcceptedHistory: false,
    hasDismissedAttempts: false,
    contactRestricted: false,
    insufficientEvidenceForSilence: false,
    ...overrides,
  };
}

test('restricted contact receives suspended continuity', () => {
  const decision = classifyOpportunityTransition(
    facts({ contactRestricted: true, insufficientEvidenceForSilence: true }),
  );
  assert.equal(decision.classification, 'restricted');
  assert.deepEqual(decision.applyPlan, { type: 'ensure_suspended_action' });
});

test('closed opportunity is preserved', () => {
  const decision = classifyOpportunityTransition(facts({ status: 'Pedido Fechado' }));
  assert.equal(decision.classification, 'closed');
  assert.deepEqual(decision.applyPlan, { type: 'noop', preserve: true });
});

test('dismissed attempts without active work stay dismissed and preserved', () => {
  const decision = classifyOpportunityTransition(
    facts({ hasDismissedAttempts: true, hasActiveNextAction: false, hasAcceptedHistory: false }),
  );
  assert.equal(decision.classification, 'dismissed');
  assert.deepEqual(decision.applyPlan, { type: 'noop', preserve: true });
});

test('insufficient evidence becomes uncertain review, never Sem resposta', () => {
  const decision = classifyOpportunityTransition(
    facts({ insufficientEvidenceForSilence: true, hasActiveNextAction: false }),
  );
  assert.equal(decision.classification, 'uncertain_association');
  assert.equal(decision.reviewReason, INSUFFICIENT_EVIDENCE_REVIEW_REASON);
  assert.equal(decision.applyPlan.type, 'ensure_verify_conversation');
  assert.notEqual(decision.reviewReason, FALSE_SILENCE_LABEL);
  assert.doesNotMatch(decision.reviewReason || '', /sem resposta/i);
});

test('open opportunity without history gets first contact', () => {
  const decision = classifyOpportunityTransition(facts());
  assert.equal(decision.classification, 'open_opportunity');
  assert.deepEqual(decision.applyPlan, { type: 'ensure_first_contact' });
});

test('active next action is kept', () => {
  const decision = classifyOpportunityTransition(facts({ hasActiveNextAction: true }));
  assert.equal(decision.classification, 'open_opportunity');
  assert.deepEqual(decision.applyPlan, { type: 'keep_active_action', preserve: true });
});

test('same client keeps sibling opportunities unmerged in the summary', () => {
  const a = classifyOpportunityTransition(
    facts({
      opportunityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      siblingOpenOpportunityIds: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ],
    }),
  );
  const b = classifyOpportunityTransition(
    facts({
      opportunityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      siblingOpenOpportunityIds: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ],
    }),
  );
  assert.deepEqual(a.siblingOpenOpportunityIds, ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
  assert.deepEqual(b.siblingOpenOpportunityIds, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
  const summary = summarizeTransitionDecisions([a, b]);
  assert.equal(summary.unmergedClientGroups.length, 1);
  assert.equal(summary.unmergedClientGroups[0].opportunityIds.length, 2);
});

test('assertNoFalseSilenceLabel rejects the false silence label', () => {
  assert.throws(() => assertNoFalseSilenceLabel(FALSE_SILENCE_LABEL));
  assert.doesNotThrow(() => assertNoFalseSilenceLabel(INSUFFICIENT_EVIDENCE_REVIEW_REASON));
});
