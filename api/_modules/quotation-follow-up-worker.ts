import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { isMachineBearerAuthorized } from '../_shared/machine-auth.js';
import { EvolutionTransportError, sendFrozenStep } from './evolution-transport.js';
import { followUpExternalWritesEnabled } from './quotation-follow-up-state.js';
import { createQuotationFollowUpModule } from './quotation-follow-ups.js';

export const QUOTATION_FOLLOW_UP_WORKER_BATCH_SIZE = 1;
export interface FollowUpWorkerRow {
  id?: string;
  followUpId?: string | null;
  follow_up_id?: string | null;
  leaseToken?: string | null;
  lease_token?: string | null;
  phone?: string;
  canonicalPhone?: string;
  canonical_phone?: string;
  messageSnapshot?: string;
  message_snapshot?: string;
}

export interface FollowUpWorkerClaim {
  followUp: FollowUpWorkerRow;
  leaseToken: string;
}

export interface QuotationFollowUpWorkerModule {
  claimApproved(id?: string): Promise<FollowUpWorkerClaim | null>;
  markTransportStarted(id: string, leaseToken: string): Promise<boolean>;
  completeSent(input: { id: string; leaseToken: string; providerMessageId: string }): Promise<unknown>;
  completeFailed(input: {
    id: string;
    leaseToken: string;
    reason: 'provider_rejected' | 'rate_limited';
  }): Promise<unknown>;
  completeNeedsReview(input: {
    id: string;
    leaseToken: string;
    reason: 'transport_ambiguous' | 'lease_expired_after_transport';
  }): Promise<unknown>;
  reapExpiredLeases(limit?: number): Promise<number>;
}

export interface QuotationFollowUpWorkerDependencies {
  followUpModule?: QuotationFollowUpWorkerModule;
  module?: QuotationFollowUpWorkerModule;
  sendStep?: typeof sendFrozenStep;
  sendFrozenStep?: typeof sendFrozenStep;
  transportDependencies?: Parameters<typeof sendFrozenStep>[1];
  environment?: {
    CRON_SECRET?: string;
    APP_ENV?: string;
    EXTERNAL_WRITES_ENABLED?: string;
    QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED?: string;
  };
  now?: () => Date;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function requestedId(event: FunctionEvent): string | undefined {
  if (!event.body?.trim()) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(event.body);
  } catch {
    throw new Error('JSON inválido.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Corpo inválido.');
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'follow_up_id')) throw new Error('Corpo inválido.');
  if (record.follow_up_id === undefined) return undefined;
  if (typeof record.follow_up_id !== 'string' || !record.follow_up_id.trim()) {
    throw new Error('Identificador do follow-up inválido.');
  }
  return record.follow_up_id.trim();
}

function rowId(row: FollowUpWorkerRow): string {
  const id = row.id || row.followUpId || row.follow_up_id;
  if (typeof id !== 'string' || !id.trim()) throw new Error('Follow-up inválido.');
  return id;
}

function rowPhone(row: FollowUpWorkerRow): string {
  const phone = row.phone || row.canonicalPhone || row.canonical_phone;
  if (typeof phone !== 'string' || !phone.trim()) throw new Error('Telefone do follow-up inválido.');
  return phone;
}


function rowMessage(row: FollowUpWorkerRow): string {
  const message = row.messageSnapshot || row.message_snapshot;
  if (typeof message !== 'string' || !message.trim()) throw new Error('Mensagem do follow-up inválida.');
  return message;
}
function transportFailureReason(error: unknown): 'provider_rejected' | 'rate_limited' | 'transport_ambiguous' {
  const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const status = Number(candidate?.status ?? candidate?.statusCode);
  if (status === 429 || code === 'EVOLUTION_RATE_LIMIT' || /(?:^|_)429(?:$|_)/.test(code)) {
    return 'rate_limited';
  }
  if ((status >= 400 && status < 500) || code.startsWith('EVOLUTION_HTTP_4')) {
    return 'provider_rejected';
  }
  if (error instanceof EvolutionTransportError && error.kind === 'permanent_pre_transport' && code.startsWith('EVOLUTION_HTTP_')) {
    return 'provider_rejected';
  }
  return 'transport_ambiguous';
}

export async function handler(
  event: FunctionEvent,
  dependencies: QuotationFollowUpWorkerDependencies = {},
): Promise<FunctionResult> {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method !== 'GET' && method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const environment = dependencies.environment || process.env;
  if (!isMachineBearerAuthorized(event.headers, environment.CRON_SECRET)) {
    return json(401, { error: 'Não autorizado.' });
  }
  const module = dependencies.followUpModule || dependencies.module || (createQuotationFollowUpModule() as unknown as QuotationFollowUpWorkerModule);
  try {
    const reaped = await module.reapExpiredLeases(50);
    if (!followUpExternalWritesEnabled(environment)) {
      return json(200, { processed: 0, remaining: false, reaped });
    }
    const id = method === 'POST' ? requestedId(event) : undefined;
    const claimed = await module.claimApproved(id);
    if (!claimed) return json(200, { processed: 0, remaining: false, reaped });
    const claim = claimed as FollowUpWorkerClaim & FollowUpWorkerRow;
    const followUp = claim.followUp || claim;
    const token = claim.leaseToken || followUp.leaseToken || followUp.lease_token;
    const followUpId = rowId(followUp);
    if (typeof token !== 'string' || !token) throw new Error('Lease inválido.');
    if (!(await module.markTransportStarted(followUpId, token))) {
      return json(200, { processed: 0, remaining: false, reaped });
    }
    try {
      const send = dependencies.sendStep || dependencies.sendFrozenStep || sendFrozenStep;
      const accepted = await send(
        {
          phone: rowPhone(followUp),
          step: { position: 0, type: 'text', payload: { text: rowMessage(followUp) }, delayMs: 0 },
        },
        dependencies.transportDependencies,
      );
      if (!accepted || accepted.accepted !== true || typeof accepted.providerMessageId !== 'string' || !accepted.providerMessageId) {
        await module.completeNeedsReview({ id: followUpId, leaseToken: token, reason: 'transport_ambiguous' });
      } else {
        await module.completeSent({ id: followUpId, leaseToken: token, providerMessageId: accepted.providerMessageId });
      }
    } catch (error) {
      const reason = transportFailureReason(error);
      if (reason === 'transport_ambiguous') {
        await module.completeNeedsReview({ id: followUpId, leaseToken: token, reason });
      } else {
        await module.completeFailed({ id: followUpId, leaseToken: token, reason });
      }
    }
    return json(200, { processed: 1, remaining: false, reaped });
  } catch (error) {
    if (error instanceof Error && ['JSON inválido.', 'Corpo inválido.', 'Identificador do follow-up inválido.'].includes(error.message)) {
      return json(400, { error: error.message });
    }
    return json(503, { error: 'Não foi possível processar a fila de follow-ups. Tente novamente.' });
  }
}

export const quotationFollowUpWorker = handler;
