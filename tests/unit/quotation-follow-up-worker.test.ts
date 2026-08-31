import assert from 'node:assert/strict';
import test from 'node:test';
import { EvolutionTransportError } from '../../api/_modules/evolution-transport.js';
import { handler as worker } from '../../api/_modules/quotation-follow-up-worker.js';

const cronSecret = 'c'.repeat(32);
const followUpId = '00000000-0000-4000-8000-000000000004';
const leaseToken = '00000000-0000-4000-8000-000000000005';

function event(headers: Record<string, string> = {}, httpMethod = 'POST', body = '') {
  return {
    httpMethod,
    headers,
    queryStringParameters: {},
    body,
  };
}

function authorized(httpMethod = 'POST', body = '') {
  return event({ authorization: `Bearer ${cronSecret}` }, httpMethod, body);
}

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
  CRON_SECRET: cronSecret,
  APP_ENV: 'production',
  EXTERNAL_WRITES_ENABLED: '1',
  QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '1',
};

test('follow-up worker requires CRON_SECRET and does not send when the kill switch is off', async () => {
  let claimed = 0;
  const deps = {
    followUpModule: {
      claimApproved: async () => {
        claimed += 1;
        return claim();
      },
      markTransportStarted: async () => true,
      completeSent: async () => null,
      completeFailed: async () => null,
      completeNeedsReview: async () => null,
      reapExpiredLeases: async () => 2,
    },
    environment: { CRON_SECRET: cronSecret, QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: '0' },
  };

  assert.equal((await worker(event({ authorization: 'Bearer ' + 'x'.repeat(32) }), deps)).statusCode, 401);
  const result = await worker(authorized(), deps);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '{}'), { processed: 0, remaining: false, reaped: 2 });
  assert.equal(claimed, 0);
});

test('follow-up worker sends one claimed text step and records the provider id', async () => {
  const calls: string[] = [];
  const result = await worker(authorized('POST', JSON.stringify({ follow_up_id: followUpId })), {
    followUpModule: {
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
      completeFailed: async () => {
        calls.push('failed');
        return null;
      },
      completeNeedsReview: async () => {
        calls.push('review');
        return null;
      },
      reapExpiredLeases: async () => 0,
    },
    sendStep: async () => ({ accepted: true as const, providerMessageId: 'provider-1' }),
    environment: enabledEnv,
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body || '{}'), { processed: 1, remaining: false, reaped: 0 });
  assert.deepEqual(calls, [
    `claim:${followUpId}`,
    `start:${followUpId}:${leaseToken}`,
    `sent:${followUpId}:provider-1`,
  ]);
});

test('follow-up worker maps 429 to failed and ambiguous transport to needs_review', async () => {
  const reasons: string[] = [];
  const module = {
    claimApproved: async () => claim(),
    markTransportStarted: async () => true,
    completeSent: async () => null,
    completeFailed: async (input: { reason: string }) => {
      reasons.push(input.reason);
      return null;
    },
    completeNeedsReview: async (input: { reason: string }) => {
      reasons.push(input.reason);
      return null;
    },
    reapExpiredLeases: async () => 0,
  };

  await worker(authorized(), {
    followUpModule: module,
    sendStep: async () => {
      throw Object.assign(new Error('rate'), { status: 429 });
    },
    environment: enabledEnv,
  });
  await worker(authorized(), {
    followUpModule: module,
    sendStep: async () => {
      throw new EvolutionTransportError('timeout', 'transient', 'EVOLUTION_TIMEOUT');
    },
    environment: enabledEnv,
  });
  assert.deepEqual(reasons, ['rate_limited', 'transport_ambiguous']);
});
