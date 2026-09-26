import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELIVERY_BATCH_LIMIT,
  MAX_DELIVERY_PASSES,
  MAX_FOLLOW_UPS_PER_CYCLE,
  SCHEDULE_RETRY_MS,
  THROTTLED_FOLLOW_UP_INTERVAL_MS,
  createWorkerCycle,
  type WorkerCycleDependencies,
} from '../../api/_worker/cycle.js';
import { FOLLOW_UP_IMMEDIATE_SEND_DAILY_CAP } from '../../api/_modules/quotation-follow-up-state.js';

const T0 = Date.parse('2026-09-25T12:00:00.000Z');

function harness(overrides: Partial<WorkerCycleDependencies> = {}) {
  const calls: string[] = [];
  const records: unknown[] = [];
  const errors: string[] = [];
  let now = T0;
  const dependencies: WorkerCycleDependencies = {
    processDue: async (limit) => {
      calls.push(`deliveries:${limit}`);
      return { processed: 0, remaining: false };
    },
    drainEffects: async () => {
      calls.push('effects');
      return { applied: 0, failed: 0 };
    },
    sweepMessages: async () => {
      calls.push('messages');
      return { requeued: 0, toReview: 0, dispatched: 0 };
    },
    followUps: {
      reapExpiredLeases: async () => 0,
      promoteDueWaitingToReady: async () => 0,
      countApprovalsTodayUtc: async () => 0,
    },
    dispatchFollowUp: async () => {
      calls.push('follow-up');
      return null;
    },
    readSchedule: async () => ({ dueNow: false, nextAt: null }),
    recordRun: async (result) => {
      records.push({ run: result });
    },
    recordSweep: async (result) => {
      records.push({ sweep: result });
    },
    reportError: (task) => {
      errors.push(task);
    },
    clock: () => now,
    ...overrides,
  };
  return {
    calls,
    records,
    errors,
    runCycle: createWorkerCycle(dependencies),
    advance(ms: number) {
      now += ms;
    },
  };
}

test('cycle runs deliveries, webhook effects, replies and follow-ups in order and records both heartbeats', async () => {
  const { calls, records, runCycle } = harness();
  const result = await runCycle();
  assert.deepEqual(calls, [`deliveries:${DELIVERY_BATCH_LIMIT}`, 'effects', 'messages', 'follow-up']);
  assert.deepEqual(records, [
    { run: { result: 'success', processed: 0, remaining: false } },
    { sweep: { result: 'success', requeued: 0, toReview: 0, dispatched: 0 } },
  ]);
  assert.deepEqual(result, { didWork: false, dueNow: false, nextAt: null });
});

test('cycle keeps processing delivery batches while work remains, up to the pass cap', async () => {
  let passes = 0;
  const { runCycle } = harness({
    processDue: async () => {
      passes += 1;
      return { processed: DELIVERY_BATCH_LIMIT, remaining: true };
    },
  });
  const result = await runCycle();
  assert.equal(passes, MAX_DELIVERY_PASSES);
  assert.equal(result.didWork, true);
  assert.equal(result.dueNow, true);
});

test('cycle stops the delivery loop when a batch claims nothing', async () => {
  let passes = 0;
  const { runCycle } = harness({
    processDue: async () => {
      passes += 1;
      return { processed: 0, remaining: true };
    },
  });
  await runCycle();
  assert.equal(passes, 1);
});

test('one failing source never stops the others and the heartbeat records the failure', async () => {
  const { calls, records, errors, runCycle } = harness({
    processDue: async () => {
      throw new Error('db down');
    },
    drainEffects: async () => {
      throw new Error('db down');
    },
  });
  await runCycle();
  assert.deepEqual(calls, ['messages', 'follow-up']);
  assert.deepEqual(errors, ['envios', 'efeitos do webhook']);
  assert.deepEqual(records[0], { run: { result: 'failure' } });
});

test('a failing heartbeat is reported and does not hide the schedule', async () => {
  const nextAt = new Date(T0 + 60_000);
  const { errors, runCycle } = harness({
    recordRun: async () => {
      throw new Error('db down');
    },
    readSchedule: async () => ({ dueNow: false, nextAt }),
  });
  const result = await runCycle();
  assert.deepEqual(errors, ['heartbeat']);
  assert.equal(result.nextAt?.getTime(), nextAt.getTime());
});

test('an unreadable schedule retries later instead of looping', async () => {
  const { errors, runCycle } = harness({
    readSchedule: async () => {
      throw new Error('db down');
    },
  });
  const result = await runCycle();
  assert.deepEqual(errors, ['agenda']);
  assert.equal(result.dueNow, false);
  assert.equal(result.nextAt?.getTime(), T0 + SCHEDULE_RETRY_MS);
});

test('cycle sends every approved follow-up below the daily cap', async () => {
  let approved = 3;
  const { runCycle } = harness({
    dispatchFollowUp: async () => (approved-- > 0 ? 'sent' : null),
  });
  const result = await runCycle();
  assert.equal(approved, -1);
  assert.equal(result.didWork, true);
  assert.equal(result.nextAt, null);
});

test('follow-ups left over the per-cycle cap keep the cycle due', async () => {
  let sent = 0;
  const { runCycle } = harness({
    dispatchFollowUp: async () => {
      sent += 1;
      return 'sent';
    },
  });
  const result = await runCycle();
  assert.equal(sent, MAX_FOLLOW_UPS_PER_CYCLE);
  assert.equal(result.didWork, true);
  assert.equal(result.dueNow, true);
});

test('a stopping cycle starts no other send and passes the stop to deliveries and replies', async () => {
  const stop = new AbortController();
  const signals: AbortSignal[] = [];
  const { calls, runCycle } = harness({
    processDue: async (_limit, signal) => {
      signals.push(signal);
      calls.push('deliveries');
      stop.abort();
      return { processed: DELIVERY_BATCH_LIMIT, remaining: true };
    },
    sweepMessages: async (_deadlineAt, signal) => {
      signals.push(signal);
      calls.push('messages');
      return { requeued: 0, toReview: 0, dispatched: 0 };
    },
  });
  await runCycle(stop.signal);
  assert.deepEqual(calls, ['deliveries', 'messages']);
  assert.ok(signals.every((signal) => signal === stop.signal));
});

test('past the daily cap, follow-ups go one per 15 minutes', async () => {
  let sent = 0;
  const { runCycle, advance } = harness({
    followUps: {
      reapExpiredLeases: async () => 0,
      promoteDueWaitingToReady: async () => 0,
      countApprovalsTodayUtc: async () => FOLLOW_UP_IMMEDIATE_SEND_DAILY_CAP,
    },
    dispatchFollowUp: async () => {
      sent += 1;
      return 'sent';
    },
  });
  const first = await runCycle();
  assert.equal(sent, 1);
  assert.equal(first.nextAt?.getTime(), T0 + THROTTLED_FOLLOW_UP_INTERVAL_MS);

  advance(60_000);
  const early = await runCycle();
  assert.equal(sent, 1);
  assert.equal(early.nextAt?.getTime(), T0 + THROTTLED_FOLLOW_UP_INTERVAL_MS);

  advance(THROTTLED_FOLLOW_UP_INTERVAL_MS);
  await runCycle();
  assert.equal(sent, 2);
});

test('the earliest of the schedule and the follow-up throttle wins', async () => {
  const soon = new Date(T0 + 30_000);
  const { runCycle } = harness({
    followUps: {
      reapExpiredLeases: async () => 0,
      promoteDueWaitingToReady: async () => 0,
      countApprovalsTodayUtc: async () => FOLLOW_UP_IMMEDIATE_SEND_DAILY_CAP,
    },
    dispatchFollowUp: async () => 'sent',
    readSchedule: async () => ({ dueNow: false, nextAt: soon }),
  });
  const result = await runCycle();
  assert.equal(result.nextAt?.getTime(), soon.getTime());
});
