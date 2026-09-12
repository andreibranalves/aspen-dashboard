import assert from 'node:assert/strict';
import test from 'node:test';

import {
  draftOpportunityRequestKey,
  draftOpportunityRequestMatches,
  planDraftOpportunityApplication,
  shouldStartDraftOpportunityRequest,
  type DraftOpportunityRequest,
} from '../../src/features/quotations/draftOpportunityRequest.ts';

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';

function request(key: string): DraftOpportunityRequest {
  return { key, token: Symbol('opportunity-request') };
}

test('the request identity is the draft index plus its client', () => {
  assert.equal(
    draftOpportunityRequestKey(3, CLIENT_A),
    draftOpportunityRequestKey(3, CLIENT_A)
  );
  assert.notEqual(
    draftOpportunityRequestKey(3, CLIENT_A),
    draftOpportunityRequestKey(3, CLIENT_B)
  );
  assert.notEqual(
    draftOpportunityRequestKey(3, CLIENT_A),
    draftOpportunityRequestKey(4, CLIENT_A)
  );
});

test('editing the same draft keeps its in-flight request matched', () => {
  const key = draftOpportunityRequestKey(0, CLIENT_A);
  assert.equal(draftOpportunityRequestMatches(request(key), key), true);
});

test('changing the client is not the same request and must start a new load', () => {
  const previous = request(draftOpportunityRequestKey(0, CLIENT_A));
  const nextKey = draftOpportunityRequestKey(0, CLIENT_B);
  assert.equal(draftOpportunityRequestMatches(previous, nextKey), false);
  assert.equal(
    shouldStartDraftOpportunityRequest({
      request: previous,
      key: nextKey,
      hasOrigin: false,
      clientId: CLIENT_B,
    }),
    true,
  );
});

test('a decided client still starts its load after another client is in flight', () => {
  const inFlightA = request(draftOpportunityRequestKey(0, CLIENT_A));
  const currentB = request(draftOpportunityRequestKey(0, CLIENT_B));
  assert.equal(
    shouldStartDraftOpportunityRequest({
      request: inFlightA,
      key: currentB.key,
      hasOrigin: false,
      clientId: CLIENT_B,
    }),
    true,
  );
  assert.deepEqual(
    planDraftOpportunityApplication({
      request: currentB,
      token: currentB.token,
      draftActive: true,
      alreadyDecided: true,
    }),
    { choices: true, selection: false, settleLoading: true },
  );
});

test('a current response fills choices, may auto-select and always settles loading', () => {
  const key = draftOpportunityRequestKey(0, CLIENT_A);
  const pending = request(key);
  const decision = planDraftOpportunityApplication({
    request: pending,
    token: pending.token,
    draftActive: true,
    alreadyDecided: false,
  });
  assert.deepEqual(decision, { choices: true, selection: true, settleLoading: true });
});

test('a stale token after a client change never overwrites the new choices', () => {
  const stale = request(draftOpportunityRequestKey(0, CLIENT_A));
  const current = request(draftOpportunityRequestKey(0, CLIENT_B));
  const decision = planDraftOpportunityApplication({
    request: current,
    token: stale.token,
    draftActive: true,
    alreadyDecided: false,
  });
  assert.deepEqual(decision, { choices: false, selection: false, settleLoading: false });
});

test('a response cannot resurrect after the queue is cleared', () => {
  const stale = request(draftOpportunityRequestKey(0, CLIENT_A));
  const decision = planDraftOpportunityApplication({
    request: undefined,
    token: stale.token,
    draftActive: true,
    alreadyDecided: false,
  });
  assert.deepEqual(decision, { choices: false, selection: false, settleLoading: false });
});

test('a response cannot resurrect a removed draft', () => {
  const stale = request(draftOpportunityRequestKey(0, CLIENT_A));
  const decision = planDraftOpportunityApplication({
    request: stale,
    token: stale.token,
    draftActive: false,
    alreadyDecided: false,
  });
  assert.deepEqual(decision, { choices: false, selection: false, settleLoading: false });
});

test('an explicit decision made during the load is never overwritten', () => {
  const current = request(draftOpportunityRequestKey(0, CLIENT_A));
  const decision = planDraftOpportunityApplication({
    request: current,
    token: current.token,
    draftActive: true,
    alreadyDecided: true,
  });
  assert.deepEqual(decision, { choices: true, selection: false, settleLoading: true });
});
