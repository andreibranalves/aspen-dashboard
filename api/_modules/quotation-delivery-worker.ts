import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { isMachineBearerAuthorized } from '../_shared/machine-auth.js';
import {
  createQuotationDeliveryModule,
  type QuotationDeliveryModule,
} from './quotation-delivery-outbox.js';
import { recordQuotationDeliveryWorkerRun } from '../_infrastructure/db/repositories/quotation-delivery-diagnostics-repository.js';

// Three 15-second transport timeouts leave room for function overhead within Vercel's 60-second limit.
export const QUOTATION_DELIVERY_WORKER_BATCH_SIZE = 3;

export interface QuotationDeliveryWorkerDependencies {
  deliveryModule?: Pick<QuotationDeliveryModule, 'processDue'>;
  processDue?: (limit: number) => Promise<{ processed: number; remaining: boolean }>;
  recordRun?: (result: { processed: number; remaining: boolean }) => Promise<void>;
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

export async function handler(
  event: FunctionEvent,
  dependencies: QuotationDeliveryWorkerDependencies = {},
): Promise<FunctionResult> {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return json(405, { error: 'Método não permitido.' });
  }

  const environment = dependencies.environment || process.env;
  if (!isMachineBearerAuthorized(event.headers, environment.CRON_SECRET)) {
    return json(401, { error: 'Não autorizado.' });
  }

  try {
    const processDue =
      dependencies.processDue ||
      (dependencies.deliveryModule
        ? (limit: number) => dependencies.deliveryModule!.processDue(limit)
        : createQuotationDeliveryModule().processDue);
    const result = await processDue(QUOTATION_DELIVERY_WORKER_BATCH_SIZE);
    if (!validResult(result)) {
      return json(503, { error: 'Não foi possível processar a fila de entregas. Tente novamente.' });
    }
    // The heartbeat is what lets the operator tell "worker stopped" from "worker
    // idle"; it is written after the work, and a failure to write it never turns
    // a completed run into an error response.
    const recordRun = dependencies.recordRun || recordQuotationDeliveryWorkerRun;
    try {
      await recordRun({ processed: result.processed, remaining: result.remaining });
    } catch {
      // Diagnostics only: the delivery work already happened.
    }
    return json(200, { processed: result.processed, remaining: result.remaining });
  } catch {
    return json(503, { error: 'Não foi possível processar a fila de entregas. Tente novamente.' });
  }
}

export const quotationDeliveryWorker = handler;
