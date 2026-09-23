import { eq, sql } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import {
  evolutionReceiptInbox,
  quotationDeliverySteps,
  quotationDeliveryWorkerRuns,
  whatsappMessageSweepRuns,
} from '../schema.js';

/** Stable identity of the scheduled worker that drains the delivery outbox. */
export const QUOTATION_DELIVERY_WORKER_NAME = 'quotation-delivery-worker';
const FAILED_WORKER_RUN_PROCESSED = -1;

type DatabaseProvider = () => AppDatabase;

export interface QuotationDeliveryWorkerRun {
  worker: string;
  lastRunAt: Date;
  result: 'success' | 'failure';
  processed: number;
  remaining: boolean;
}

export interface MessageSweepRun {
  lastRunAt: Date;
  result: 'success' | 'failure';
  requeued: number;
  toReview: number;
  dispatched: number;
}

export type MessageSweepRunResult =
  | { result: 'success'; requeued: number; toReview: number; dispatched: number; now?: Date }
  | { result: 'failure'; now?: Date };

export type QuotationDeliveryWorkerRunResult =
  | { result: 'success'; processed: number; remaining: boolean; now?: Date }
  | { result: 'failure'; now?: Date };

/**
 * Operational read model of the delivery pipeline. Pure diagnostics: it reads
 * durable state and never claims, sends, expires or rewrites anything.
 *
 * The values separate failures that looked identical from the screen: worker
 * execution, steps parked in reconciliation and receipts received without a
 * correlated provider id.
 */
export interface QuotationDeliveryDiagnostics {
  worker: QuotationDeliveryWorkerRun | null;
  messageSweep: MessageSweepRun | null;
  reconcilingSteps: number;
  pendingReceipts: number;
}

function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function recordQuotationDeliveryWorkerRun(
  input: QuotationDeliveryWorkerRunResult,
  getDb: DatabaseProvider = getDatabase
): Promise<void> {
  const now = input?.now instanceof Date ? input.now : new Date();
  const processed =
    input.result === 'success' ? count(input.processed) : FAILED_WORKER_RUN_PROCESSED;
  const remaining = input.result === 'success' && input.remaining === true;
  await getDb()
    .insert(quotationDeliveryWorkerRuns)
    .values({
      worker: QUOTATION_DELIVERY_WORKER_NAME,
      lastRunAt: now,
      processed,
      remaining,
    })
    .onConflictDoUpdate({
      target: quotationDeliveryWorkerRuns.worker,
      set: {
        lastRunAt: now,
        processed,
        remaining,
      },
    });
}

export async function recordMessageSweepRun(
  input: MessageSweepRunResult,
  getDb: DatabaseProvider = getDatabase
): Promise<void> {
  const values = {
    lastRunAt: input.now instanceof Date ? input.now : new Date(),
    result: input.result,
    requeued: input.result === 'success' ? count(input.requeued) : 0,
    toReview: input.result === 'success' ? count(input.toReview) : 0,
    dispatched: input.result === 'success' ? count(input.dispatched) : 0,
  };
  await getDb()
    .insert(whatsappMessageSweepRuns)
    .values({ worker: QUOTATION_DELIVERY_WORKER_NAME, ...values })
    .onConflictDoUpdate({ target: whatsappMessageSweepRuns.worker, set: values });
}

export async function readQuotationDeliveryDiagnostics(
  getDb: DatabaseProvider = getDatabase
): Promise<QuotationDeliveryDiagnostics> {
  const db = getDb();
  const [worker] = await db
    .select()
    .from(quotationDeliveryWorkerRuns)
    .where(eq(quotationDeliveryWorkerRuns.worker, QUOTATION_DELIVERY_WORKER_NAME))
    .limit(1);
  const [sweep] = await db
    .select()
    .from(whatsappMessageSweepRuns)
    .where(eq(whatsappMessageSweepRuns.worker, QUOTATION_DELIVERY_WORKER_NAME))
    .limit(1);
  const [steps] = await db
    .select({
      reconciling: sql<number>`count(*) filter (where ${quotationDeliverySteps.state} = 'reconciling')::int`,
    })
    .from(quotationDeliverySteps);
  const [receipts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${evolutionReceiptInbox.appliedAt} is null)::int`,
    })
    .from(evolutionReceiptInbox);
  return {
    worker: worker
      ? {
          worker: worker.worker,
          lastRunAt: asDate(worker.lastRunAt) || new Date(0),
          result: worker.processed === FAILED_WORKER_RUN_PROCESSED ? 'failure' : 'success',
          processed: count(worker.processed),
          remaining: worker.processed !== FAILED_WORKER_RUN_PROCESSED && worker.remaining === true,
        }
      : null,
    messageSweep: sweep
      ? {
          lastRunAt: asDate(sweep.lastRunAt) || new Date(0),
          result: sweep.result === 'failure' ? 'failure' : 'success',
          requeued: count(sweep.requeued),
          toReview: count(sweep.toReview),
          dispatched: count(sweep.dispatched),
        }
      : null,
    reconcilingSteps: count(steps?.reconciling),
    pendingReceipts: count(receipts?.pending),
  };
}
