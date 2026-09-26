// Um ciclo do aspen-worker (ADR 0013): relê o banco e roda todo o trabalho
// assíncrono do WhatsApp que venceu. Cada fonte falha sozinha, e o resultado diz
// ao agendador quando acordar de novo. Com `stop` abortado, nenhuma fonte começa
// outro envio; o que já está em curso termina.
import type { SweepResult } from '../_modules/whatsapp-message-dispatch.js';
import type {
  FollowUpDispatchOutcome,
  QuotationFollowUpWorkerModule,
} from '../_modules/quotation-follow-up-dispatch.js';
import { shouldSendFollowUpImmediately } from '../_modules/quotation-follow-up-state.js';
import type {
  MessageSweepRunResult,
  QuotationDeliveryWorkerRunResult,
} from '../_infrastructure/db/repositories/quotation-delivery-diagnostics-repository.js';
import type { WorkerSchedule } from '../_infrastructure/db/repositories/worker-schedule-repository.js';

export const DELIVERY_BATCH_LIMIT = 20;
export const MAX_DELIVERY_PASSES = 10;
export const EFFECTS_BATCH_LIMIT = 20;
export const MAX_EFFECT_PASSES = 10;
export const EFFECTS_PASS_BUDGET_MS = 60_000;
export const MESSAGE_SWEEP_BUDGET_MS = 5 * 60_000;
export const MAX_FOLLOW_UPS_PER_CYCLE = 20;
// Passado o teto diário de aprovações, os retornos saem um a cada 15 min.
export const THROTTLED_FOLLOW_UP_INTERVAL_MS = 15 * 60_000;
export const SCHEDULE_RETRY_MS = 5 * 60_000;
// A varredura horária garante que a limpeza roda; mais que isso só gasta Neon.
export const PRUNE_INTERVAL_MS = 60 * 60_000;

export interface WorkerCycleResult {
  /** O ciclo mudou algum estado. */
  didWork: boolean;
  /** Ainda há trabalho vencido. */
  dueNow: boolean;
  /** Próximo horário futuro em que algo vence. */
  nextAt: Date | null;
}

export interface WorkerCycleDependencies {
  processDue(limit: number, stop: AbortSignal): Promise<{ processed: number; remaining: boolean }>;
  drainEffects(deadlineAt: number): Promise<{ applied: number; failed: number }>;
  /** Apaga os efeitos do webhook concluídos há mais de 14 dias. */
  pruneEffects(): Promise<number>;
  sweepMessages(deadlineAt: number, stop: AbortSignal): Promise<SweepResult>;
  followUps: Pick<
    QuotationFollowUpWorkerModule,
    'reapExpiredLeases' | 'promoteDueWaitingToReady' | 'countApprovalsTodayUtc'
  >;
  dispatchFollowUp(): Promise<FollowUpDispatchOutcome | null>;
  readSchedule(now: Date): Promise<WorkerSchedule>;
  recordRun(result: QuotationDeliveryWorkerRunResult): Promise<void>;
  recordSweep(result: MessageSweepRunResult): Promise<void>;
  reportError(task: string, error: unknown): void;
  clock?: () => number;
}

function earliest(...dates: Array<Date | null>): Date | null {
  const times = dates.filter((date): date is Date => date !== null).map((date) => date.getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

export function createWorkerCycle(
  dependencies: WorkerCycleDependencies,
): (stop?: AbortSignal) => Promise<WorkerCycleResult> {
  const clock = dependencies.clock || Date.now;
  const report = dependencies.reportError;
  let throttledFollowUpAt = 0;
  let nextPruneAt = 0;

  async function deliveries(stop: AbortSignal) {
    let processed = 0;
    let remaining = false;
    for (let pass = 0; pass < MAX_DELIVERY_PASSES && !stop.aborted; pass += 1) {
      const result = await dependencies.processDue(DELIVERY_BATCH_LIMIT, stop);
      processed += result.processed;
      remaining = result.remaining;
      if (!result.remaining || result.processed === 0) break;
    }
    return { processed, remaining };
  }

  async function effects(stop: AbortSignal) {
    let handled = 0;
    for (let pass = 0; pass < MAX_EFFECT_PASSES && !stop.aborted; pass += 1) {
      const result = await dependencies.drainEffects(clock() + EFFECTS_PASS_BUDGET_MS);
      handled += result.applied + result.failed;
      if (result.applied + result.failed < EFFECTS_BATCH_LIMIT) break;
    }
    return handled;
  }

  // Aprovados ficam fora da agenda do banco: `remaining` e `nextAt` dizem quando
  // voltar a eles.
  async function followUps(
    stop: AbortSignal,
  ): Promise<{ changed: number; remaining: boolean; nextAt: Date | null }> {
    const { followUps: module } = dependencies;
    let changed = await module.reapExpiredLeases(50);
    if (module.promoteDueWaitingToReady) changed += await module.promoteDueWaitingToReady(new Date(clock()));
    const throttled = !shouldSendFollowUpImmediately(await module.countApprovalsTodayUtc(new Date(clock())));
    for (let sent = 0; sent < MAX_FOLLOW_UPS_PER_CYCLE; sent += 1) {
      if (stop.aborted) return { changed, remaining: false, nextAt: null };
      if (throttled && clock() < throttledFollowUpAt) {
        return { changed, remaining: false, nextAt: new Date(throttledFollowUpAt) };
      }
      const outcome = await dependencies.dispatchFollowUp();
      if (outcome === null) return { changed, remaining: false, nextAt: null };
      changed += 1;
      if (throttled) {
        throttledFollowUpAt = clock() + THROTTLED_FOLLOW_UP_INTERVAL_MS;
        return { changed, remaining: false, nextAt: new Date(throttledFollowUpAt) };
      }
    }
    return { changed, remaining: true, nextAt: null };
  }

  return async function runCycle(stop: AbortSignal = new AbortController().signal): Promise<WorkerCycleResult> {
    let didWork = false;
    let deliveriesRemaining = false;

    let run: QuotationDeliveryWorkerRunResult;
    try {
      const result = await deliveries(stop);
      didWork ||= result.processed > 0;
      deliveriesRemaining = result.remaining;
      run = { result: 'success', ...result };
    } catch (error) {
      report('envios', error);
      run = { result: 'failure' };
    }

    try {
      didWork = (await effects(stop)) > 0 || didWork;
    } catch (error) {
      report('efeitos do webhook', error);
    }

    let sweep: MessageSweepRunResult;
    try {
      const result = await dependencies.sweepMessages(clock() + MESSAGE_SWEEP_BUDGET_MS, stop);
      didWork ||= result.requeued + result.toReview + result.dispatched > 0;
      sweep = { result: 'success', ...result };
    } catch (error) {
      report('respostas do Atendimento', error);
      sweep = { result: 'failure' };
    }

    let followUpsRemaining = false;
    let followUpNextAt: Date | null = null;
    try {
      const result = await followUps(stop);
      didWork ||= result.changed > 0;
      followUpsRemaining = result.remaining;
      followUpNextAt = result.nextAt;
    } catch (error) {
      report('retornos', error);
    }

    // O heartbeat de cada varredura é o que o alarme de envios parados lê.
    for (const [task, record] of [
      ['heartbeat', () => dependencies.recordRun(run)],
      ['heartbeat das respostas', () => dependencies.recordSweep(sweep)],
    ] as const) {
      try {
        await record();
      } catch (error) {
        report(task, error);
      }
    }

    // Uma falha espera a hora seguinte, como a limpeza que deu certo.
    if (!stop.aborted && clock() >= nextPruneAt) {
      nextPruneAt = clock() + PRUNE_INTERVAL_MS;
      try {
        await dependencies.pruneEffects();
      } catch (error) {
        report('limpeza dos efeitos', error);
      }
    }

    let schedule: WorkerSchedule;
    try {
      schedule = await dependencies.readSchedule(new Date(clock()));
    } catch (error) {
      report('agenda', error);
      schedule = { dueNow: false, nextAt: new Date(clock() + SCHEDULE_RETRY_MS) };
    }
    return {
      didWork,
      dueNow: schedule.dueNow || deliveriesRemaining || followUpsRemaining,
      nextAt: earliest(schedule.nextAt, followUpNextAt),
    };
  };
}
