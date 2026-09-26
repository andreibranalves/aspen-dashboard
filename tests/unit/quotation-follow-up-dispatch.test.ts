import assert from 'node:assert/strict';
import test from 'node:test';
import { EvolutionTransportError } from '../../api/_modules/evolution-transport.js';
import {
  dispatchNextApprovedFollowUp,
  type QuotationFollowUpWorkerModule,
} from '../../api/_modules/quotation-follow-up-dispatch.js';

const followUpId = '00000000-0000-4000-8000-000000000004';
const leaseToken = '00000000-0000-4000-8000-000000000005';

function claim() {
  return {
    followUp: {
      followUpId,
      canonicalPhone: '5511999990000',
      messageSnapshot: 'Olá.',
    },
    leaseToken,
  };
}

const enabledEnv = {
  APP_ENV: 'production',
  EXTERNAL_WRITES_ENABLED: '1',
  QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '1',
};

function module(overrides: Partial<QuotationFollowUpWorkerModule> = {}): QuotationFollowUpWorkerModule {
  return {
    claimApproved: async () => claim(),
    markTransportStarted: async () => true,
    completeSent: async () => null,
    completeFailed: async () => null,
    completeNeedsReview: async () => null,
    reapExpiredLeases: async () => 0,
    countApprovalsTodayUtc: async () => 0,
    ...overrides,
  };
}

test('follow-up dispatch does not claim when the kill switch is off', async () => {
  let claimed = 0;
  const outcome = await dispatchNextApprovedFollowUp({
    followUpModule: module({
      claimApproved: async () => {
        claimed += 1;
        return claim();
      },
    }),
    environment: { ...enabledEnv, QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '0' },
  });
  assert.equal(outcome, null);
  assert.equal(claimed, 0);
});

test('follow-up dispatch returns null when nothing is approved', async () => {
  const outcome = await dispatchNextApprovedFollowUp({
    followUpModule: module({ claimApproved: async () => null }),
    environment: enabledEnv,
  });
  assert.equal(outcome, null);
});

test('follow-up dispatch sends one claimed text step and records the provider id', async () => {
  const calls: string[] = [];
  const outcome = await dispatchNextApprovedFollowUp({
    followUpModule: module({
      claimApproved: async (id) => {
        calls.push(`claim:${id}`);
        return claim();
      },
      markTransportStarted: async (id, token) => {
        calls.push(`start:${id}:${token}`);
        return true;
      },
      completeSent: async (input) => {
        calls.push(`sent:${input.id}:${input.providerMessageId}`);
        return null;
      },
    }),
    sendStep: async () => ({ accepted: true as const, providerMessageId: 'provider-1' }),
    environment: enabledEnv,
  });
  assert.equal(outcome, 'sent');
  assert.deepEqual(calls, [
    'claim:undefined',
    `start:${followUpId}:${leaseToken}`,
    `sent:${followUpId}:provider-1`,
  ]);
});

test('follow-up dispatch maps 429 to failed and ambiguous transport to needs_review', async () => {
  const reasons: string[] = [];
  const recording = module({
    completeFailed: async (input) => {
      reasons.push(input.reason);
      return null;
    },
    completeNeedsReview: async (input) => {
      reasons.push(input.reason);
      return null;
    },
  });

  const rateLimited = await dispatchNextApprovedFollowUp({
    followUpModule: recording,
    sendStep: async () => {
      throw Object.assign(new Error('rate'), { status: 429 });
    },
    environment: enabledEnv,
  });
  const ambiguous = await dispatchNextApprovedFollowUp({
    followUpModule: recording,
    sendStep: async () => {
      throw new EvolutionTransportError('timeout', 'transient', 'EVOLUTION_TIMEOUT');
    },
    environment: enabledEnv,
  });
  assert.deepEqual([rateLimited, ambiguous], ['failed', 'needs_review']);
  assert.deepEqual(reasons, ['rate_limited', 'transport_ambiguous']);
});

test('follow-up dispatch never calls transport when the lease revalidation rejects the start', async () => {
  let transportCalls = 0;
  const outcome = await dispatchNextApprovedFollowUp({
    followUpModule: module({ markTransportStarted: async () => false }),
    sendStep: async () => {
      transportCalls += 1;
      return { accepted: true as const, providerMessageId: 'must-not-send' };
    },
    environment: enabledEnv,
  });
  assert.equal(outcome, 'skipped');
  assert.equal(transportCalls, 0);
});
