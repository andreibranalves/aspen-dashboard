import { eq, sql } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import {
  evolutionReceiptInbox,
  quotationDeliverySteps,
  quotationDeliveryWorkerRuns,
} from '../schema.js';

/** Stable identity of the scheduled worker that drains the delivery outbox. */
export const QUOTATION_DELIVERY_WORKER_NAME = 'quotation-delivery-worker';

type DatabaseProvider = () => AppDatabase;

export interface QuotationDeliveryWorkerRun {
  worker: string;
  lastRunAt: Date;
  processed: number;
  remaining: boolean;
}

/**
 * Operational read model of the delivery pipeline. Pure diagnostics: it reads
 * durable state and never claims, sends, expires or rewrites anything.
 *
 * The three numbers exist to separate failures that looked identical from the
 * screen: "worker stopped" (stale `lastRunAt`), "steps parked in reconciliation"
 * (`reconcilingSteps`, with `overdueReconcilingSteps` counting those already past
 * the window, which only a worker invocation can promote) and "receipts received
 * without a correlated provider id" (`pendingReceipts`).
 */
export interface QuotationDeliveryDiagnostics {
  worker: QuotationDeliveryWorkerRun | null;
  reconcilingSteps: number;
  overdueReconcilingSteps: number;
  oldestReconciliationDeadline: Date | null;
  pendingReceipts: number;
  oldestPendingReceiptAt: Date | null;
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

/** Overwrites the heartbeat of the scheduled worker after a successful run. */
export async function recordQuotationDeliveryWorkerRun(
  input: { processed: number; remaining: boolean; now?: Date },
  getDb: DatabaseProvider = getDatabase
): Promise<void> {
  const now = input?.now instanceof Date ? input.now : new Date();
  await getDb()
    .insert(quotationDeliveryWorkerRuns)
    .values({
      worker: QUOTATION_DELIVERY_WORKER_NAME,
      lastRunAt: now,
      processed: count(input?.processed),
      remaining: input?.remaining === true,
    })
    .onConflictDoUpdate({
      target: quotationDeliveryWorkerRuns.worker,
      set: {
        lastRunAt: now,
        processed: count(input?.processed),
        remaining: input?.remaining === true,
      },
    });
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
  const [steps] = await db
    .select({
      reconciling: sql<number>`count(*) filter (where ${quotationDeliverySteps.state} = 'reconciling')::int`,
      overdue: sql<number>`count(*) filter (where ${quotationDeliverySteps.state} = 'reconciling' and ${quotationDeliverySteps.reconciliationDeadline} is not null and ${quotationDeliverySteps.reconciliationDeadline} <= now())::int`,
      oldest: sql<string | null>`min(${quotationDeliverySteps.reconciliationDeadline}) filter (where ${quotationDeliverySteps.state} = 'reconciling')`,
    })
    .from(quotationDeliverySteps);
  const [receipts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${evolutionReceiptInbox.appliedAt} is null)::int`,
      oldest: sql<string | null>`min(${evolutionReceiptInbox.receivedAt}) filter (where ${evolutionReceiptInbox.appliedAt} is null)`,
    })
    .from(evolutionReceiptInbox);
  return {
    worker: worker
      ? {
          worker: worker.worker,
          lastRunAt: asDate(worker.lastRunAt) || new Date(0),
          processed: count(worker.processed),
          remaining: worker.remaining === true,
        }
      : null,
    reconcilingSteps: count(steps?.reconciling),
    overdueReconcilingSteps: count(steps?.overdue),
    oldestReconciliationDeadline: asDate(steps?.oldest),
    pendingReceipts: count(receipts?.pending),
    oldestPendingReceiptAt: asDate(receipts?.oldest),
  };
}
