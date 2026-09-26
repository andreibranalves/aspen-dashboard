// Quando o aspen-worker roda um ciclo (ADR 0013): no /wake, no timer do próximo
// vencimento e, no máximo, a cada hora. Um ciclo por vez; um aviso que chega
// durante o ciclo vira mais um ciclo logo depois, nunca dois em paralelo.
import type { WorkerCycleResult } from './cycle.js';

export const MAX_SLEEP_MS = 60 * 60_000;
export const MIN_SLEEP_MS = 1_000;
export const CYCLE_ERROR_RETRY_MS = 5 * 60_000;

export interface WorkerScheduler {
  /** Pede um ciclo agora; avisos repetidos se juntam. */
  wake(): void;
  /** Para de agendar e espera o ciclo em andamento, que não começa outro envio. */
  stop(): Promise<void>;
}

export interface WorkerSchedulerDependencies {
  runCycle(stop: AbortSignal): Promise<WorkerCycleResult>;
  reportError(task: string, error: unknown): void;
  clock?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

function defaultSetTimer(callback: () => void, delayMs: number): unknown {
  return setTimeout(callback, delayMs);
}

function defaultClearTimer(timer: unknown): void {
  clearTimeout(timer as ReturnType<typeof setTimeout>);
}

/** Espera até o próximo ciclo. Só volta em 1 s se o ciclo avançou e ainda há trabalho vencido. */
export function nextDelayMs(result: WorkerCycleResult, now: number): number {
  if (result.didWork && result.dueNow) return MIN_SLEEP_MS;
  const untilNext = result.nextAt ? result.nextAt.getTime() - now : MAX_SLEEP_MS;
  return Math.min(MAX_SLEEP_MS, Math.max(MIN_SLEEP_MS, untilNext));
}

export function createWorkerScheduler(dependencies: WorkerSchedulerDependencies): WorkerScheduler {
  const clock = dependencies.clock || Date.now;
  const setTimer = dependencies.setTimer || defaultSetTimer;
  const clearTimer = dependencies.clearTimer || defaultClearTimer;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let pending = false;
  let stopped = false;
  const stopping = new AbortController();

  function cancelTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  async function loop() {
    while (pending && !stopped) {
      pending = false;
      cancelTimer();
      let delayMs: number;
      try {
        delayMs = nextDelayMs(await dependencies.runCycle(stopping.signal), clock());
      } catch (error) {
        dependencies.reportError('ciclo', error);
        delayMs = CYCLE_ERROR_RETRY_MS;
      }
      if (!pending && !stopped) {
        timer = setTimer(() => {
          timer = null;
          wake();
        }, delayMs);
      }
    }
  }

  function wake() {
    if (stopped) return;
    pending = true;
    if (running) return;
    running = loop().finally(() => {
      running = null;
      if (pending) wake();
    });
  }

  return {
    wake,
    async stop() {
      stopped = true;
      stopping.abort();
      cancelTimer();
      await running;
    },
  };
}
