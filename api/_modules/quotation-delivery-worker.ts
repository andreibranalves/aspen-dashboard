import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { isMachineBearerAuthorized } from '../_shared/machine-auth.js';
import {
  createQuotationDeliveryModule,
  type QuotationDeliveryModule,
} from './quotation-delivery-outbox.js';
import { createPostgresQuotationFollowUpRepository } from '../_infrastructure/db/repositories/quotation-follow-up-repository.js';
import { createPostgresWhatsappContactActivityRepository } from '../_infrastructure/db/repositories/whatsapp-contact-activity-repository.js';
import { getEvolutionConfig } from '../_infrastructure/integrations/evolution/config.js';
import { createWebhookEffectRunners, drainWebhookEffects } from './whatsapp-webhook-effects.js';
import { sweepOperatorMessages, type SweepResult } from './whatsapp-message-dispatch.js';
import {
  recordMessageSweepRun,
  recordQuotationDeliveryWorkerRun,
  type MessageSweepRunResult,
  type QuotationDeliveryWorkerRunResult,
} from '../_infrastructure/db/repositories/quotation-delivery-diagnostics-repository.js';

// Three 15-second transport timeouts leave room for function overhead within Vercel's 60-second limit.
export const QUOTATION_DELIVERY_WORKER_BATCH_SIZE = 3;

// Pending WhatsApp webhook effects are DB-only work resumed after the quotation
// batch, never before it, and only while the tick still has room.
export const WEBHOOK_EFFECTS_DRAIN_LIMIT = 20;
const FUNCTION_BUDGET_MS = 50_000;
const MIN_DRAIN_WINDOW_MS = 5_000;

export interface QuotationDeliveryWorkerDependencies {
  deliveryModule?: Pick<QuotationDeliveryModule, 'processDue'>;
  processDue?: (limit: number) => Promise<{ processed: number; remaining: boolean }>;
  recordRun?: (result: QuotationDeliveryWorkerRunResult) => Promise<void>;
  drainEffects?: (deadlineAt: number) => Promise<{ applied: number; failed: number }>;
  sweepMessages?: (deadlineAt: number) => Promise<SweepResult>;
  recordSweep?: (result: MessageSweepRunResult) => Promise<void>;
  clock?: () => number;
  environment?: {
    CRON_SECRET?: string;
  };
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function validResult(value: unknown): value is { processed: number; remaining: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(result.processed) &&
    (result.processed as number) >= 0 &&
    (result.processed as number) <= QUOTATION_DELIVERY_WORKER_BATCH_SIZE &&
    typeof result.remaining === 'boolean'
  );
}

async function recordResult(
  recordRun: (result: QuotationDeliveryWorkerRunResult) => Promise<void>,
  result: QuotationDeliveryWorkerRunResult
): Promise<void> {
  try {
    await recordRun(result);
  } catch {
    return;
  }
}

async function liveDrainEffects(deadlineAt: number) {
  const instance = getEvolutionConfig().instance;
  if (!instance) return { applied: 0, failed: 0 };
  const runners = createWebhookEffectRunners(
    createPostgresWhatsappContactActivityRepository(),
    createPostgresQuotationFollowUpRepository(),
  );
  return drainWebhookEffects({ instance, runners, limit: WEBHOOK_EFFECTS_DRAIN_LIMIT, deadlineAt });
}

async function sweepAfterBatch(
  sweep: (deadlineAt: number) => Promise<SweepResult>,
  recordSweep: (result: MessageSweepRunResult) => Promise<void>,
  startedAt: number,
): Promise<void> {
  let outcome: MessageSweepRunResult;
  try {
    const result = await sweep(startedAt + FUNCTION_BUDGET_MS);
    outcome = { result: 'success', ...result };
  } catch (error) {
    console.error('[quotation-delivery-worker] operator messages', error instanceof Error ? error.name : typeof error);
    outcome = { result: 'failure' };
  }
  try {
    await recordSweep(outcome);
  } catch {
    return;
  }
}

async function drainAfterBatch(
  drain: (deadlineAt: number) => Promise<{ applied: number; failed: number }>,
  startedAt: number,
  clock: () => number,
): Promise<void> {
  const deadlineAt = startedAt + FUNCTION_BUDGET_MS;
  if (deadlineAt - clock() < MIN_DRAIN_WINDOW_MS) return;
  try {
    const result = await drain(deadlineAt);
    if (result.applied || result.failed) {
      console.info('[quotation-delivery-worker] webhook effects', result.applied, result.failed);
    }
  } catch (error) {
    console.error('[quotation-delivery-worker] webhook effects', error instanceof Error ? error.name : typeof error);
  }
}

export async function handler(
  event: FunctionEvent,
  dependencies: QuotationDeliveryWorkerDependencies = {},
): Promise<FunctionResult> {
  const clock = dependencies.clock || Date.now;
  const startedAt = clock();
  const method = String(event.httpMethod || '').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return json(405, { error: 'Método não permitido.' });
  }

  const environment = dependencies.environment || process.env;
  if (!isMachineBearerAuthorized(event.headers, environment.CRON_SECRET)) {
    return json(401, { error: 'Não autorizado.' });
  }

  const processDue =
    dependencies.processDue ||
    (dependencies.deliveryModule
      ? (limit: number) => dependencies.deliveryModule!.processDue(limit)
      : createQuotationDeliveryModule().processDue);
  const recordRun = dependencies.recordRun || recordQuotationDeliveryWorkerRun;
  const drainEffects = dependencies.drainEffects || liveDrainEffects;
  const sweepMessages =
    dependencies.sweepMessages || ((deadlineAt: number) => sweepOperatorMessages({ deadlineAt, clock }));
  const recordSweep = dependencies.recordSweep || recordMessageSweepRun;
  try {
    const result = await processDue(QUOTATION_DELIVERY_WORKER_BATCH_SIZE);
    // The quotation batch always runs first and unchanged. The DB-only
    // webhook-effects drain keeps its time before the message sweep, which
    // only transports while a full timeout still fits in what remains.
    await drainAfterBatch(drainEffects, startedAt, clock);
    await sweepAfterBatch(sweepMessages, recordSweep, startedAt);
    if (!validResult(result)) {
      await recordResult(recordRun, { result: 'failure' });
      return json(503, { error: 'Não foi possível processar a fila de entregas. Tente novamente.' });
    }
    await recordResult(recordRun, {
      result: 'success',
      processed: result.processed,
      remaining: result.remaining,
    });
    return json(200, { processed: result.processed, remaining: result.remaining });
  } catch {
    await recordResult(recordRun, { result: 'failure' });
    return json(503, { error: 'Não foi possível processar a fila de entregas. Tente novamente.' });
  }
}

export const quotationDeliveryWorker = handler;
