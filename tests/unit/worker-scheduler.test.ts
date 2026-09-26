import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkerCycleResult } from '../../api/_worker/cycle.js';
import {
  CYCLE_ERROR_RETRY_MS,
  MAX_SLEEP_MS,
  MIN_SLEEP_MS,
  createWorkerScheduler,
  nextDelayMs,
} from '../../api/_worker/scheduler.js';

const T0 = Date.parse('2026-09-25T12:00:00.000Z');

function idle(nextAt: Date | null = null): WorkerCycleResult {
  return { didWork: false, dueNow: false, nextAt };
}

function fakeTimers() {
  const timers: Array<{ callback: () => void; delayMs: number; cleared: boolean }> = [];
  return {
    timers,
    setTimer(callback: () => void, delayMs: number) {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer: unknown) {
      (timer as { cleared: boolean }).cleared = true;
    },
    active() {
      return timers.filter((timer) => !timer.cleared);
    },
  };
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

test('delay: back in a second only when the cycle advanced and work is still due', () => {
  assert.equal(nextDelayMs({ didWork: true, dueNow: true, nextAt: null }, T0), MIN_SLEEP_MS);
  // Vencido mas sem avanço: não gira em falso; espera o próximo horário ou a hora cheia.
  assert.equal(nextDelayMs({ didWork: false, dueNow: true, nextAt: null }, T0), MAX_SLEEP_MS);
  assert.equal(nextDelayMs(idle(new Date(T0 + 90_000)), T0), 90_000);
  assert.equal(nextDelayMs(idle(new Date(T0 + 5 * MAX_SLEEP_MS)), T0), MAX_SLEEP_MS);
  assert.equal(nextDelayMs(idle(new Date(T0 - 1)), T0), MIN_SLEEP_MS);
});

test('scheduler runs one cycle per wake burst and arms the next timer', async () => {
  const timers = fakeTimers();
  let cycles = 0;
  let release!: () => void;
  const scheduler = createWorkerScheduler({
    runCycle: async () => {
      cycles += 1;
      if (cycles === 1) await new Promise<void>((resolve) => (release = resolve));
      return idle(new Date(T0 + 60_000));
    },
    reportError: () => {},
    clock: () => T0,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  scheduler.wake();
  scheduler.wake();
  scheduler.wake();
  await settle();
  assert.equal(cycles, 1);
  release();
  await settle();
  // Os avisos que chegaram durante o ciclo viram um único ciclo a mais.
  assert.equal(cycles, 2);
  assert.equal(timers.active().length, 1);
  assert.equal(timers.active()[0].delayMs, 60_000);
  await scheduler.stop();
});

test('the timer wakes the scheduler, and a cycle error retries in five minutes', async () => {
  const timers = fakeTimers();
  const errors: string[] = [];
  let cycles = 0;
  const scheduler = createWorkerScheduler({
    runCycle: async () => {
      cycles += 1;
      if (cycles === 2) throw new Error('boom');
      return idle(new Date(T0 + 60_000));
    },
    reportError: (task) => errors.push(task),
    clock: () => T0,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  scheduler.wake();
  await settle();
  timers.active()[0].callback();
  await settle();
  assert.equal(cycles, 2);
  assert.deepEqual(errors, ['ciclo']);
  assert.equal(timers.active().at(-1)?.delayMs, CYCLE_ERROR_RETRY_MS);
  await scheduler.stop();
});

test('stop tells the running cycle, waits for it and ignores later wakes', async () => {
  const timers = fakeTimers();
  let cycles = 0;
  let release!: () => void;
  let stopSignal!: AbortSignal;
  const scheduler = createWorkerScheduler({
    runCycle: async (stop) => {
      cycles += 1;
      stopSignal = stop;
      await new Promise<void>((resolve) => (release = resolve));
      return idle();
    },
    reportError: () => {},
    clock: () => T0,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  scheduler.wake();
  await settle();
  let stopped = false;
  assert.equal(stopSignal.aborted, false);
  const stopping = scheduler.stop().then(() => (stopped = true));
  await settle();
  assert.equal(stopped, false);
  assert.equal(stopSignal.aborted, true);
  release();
  await stopping;
  scheduler.wake();
  await settle();
  assert.equal(cycles, 1);
  assert.equal(timers.active().length, 0);
});
