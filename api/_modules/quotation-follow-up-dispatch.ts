// Envia um retorno aprovado pelo operador. Chamado pelo aspen-worker (ADR 0013);
// o lease e o `transport_started_at` da linha impedem envio duplicado.
import { EvolutionTransportError, sendFrozenStep } from './evolution-transport.js';
import { followUpExternalWritesEnabled } from './quotation-follow-up-state.js';
import { createQuotationFollowUpModule } from './quotation-follow-ups.js';

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
  promoteDueWaitingToReady?(now?: Date): Promise<number>;
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
  countApprovalsTodayUtc(now?: Date): Promise<number>;
}

export interface FollowUpDispatchDependencies {
  followUpModule?: QuotationFollowUpWorkerModule;
  sendStep?: typeof sendFrozenStep;
  transportDependencies?: Parameters<typeof sendFrozenStep>[1];
  environment?: {
    APP_ENV?: string;
    EXTERNAL_WRITES_ENABLED?: string;
    QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED?: string;
  };
}

/** `skipped`: o retorno foi reservado, mas o lease não confirmou o início do transporte. */
export type FollowUpDispatchOutcome = 'sent' | 'failed' | 'needs_review' | 'skipped';

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

/**
 * Reserva e envia o retorno aprovado mais antigo. Devolve null quando não há
 * retorno aprovado ou o envio automático está desligado.
 */
export async function dispatchNextApprovedFollowUp(
  dependencies: FollowUpDispatchDependencies = {},
): Promise<FollowUpDispatchOutcome | null> {
  const environment = dependencies.environment || process.env;
  if (!followUpExternalWritesEnabled(environment)) return null;
  const module =
    dependencies.followUpModule ||
    (createQuotationFollowUpModule() as unknown as QuotationFollowUpWorkerModule);
  const claimed = await module.claimApproved();
  if (!claimed) return null;
  const claim = claimed as FollowUpWorkerClaim & FollowUpWorkerRow;
  const followUp = claim.followUp || claim;
  const token = claim.leaseToken || followUp.leaseToken || followUp.lease_token;
  const followUpId = rowId(followUp);
  if (typeof token !== 'string' || !token) throw new Error('Lease inválido.');
  if (!(await module.markTransportStarted(followUpId, token))) return 'skipped';
  try {
    const send = dependencies.sendStep || sendFrozenStep;
    const accepted = await send(
      {
        phone: rowPhone(followUp),
        step: { position: 0, type: 'text', payload: { text: rowMessage(followUp) }, delayMs: 0 },
      },
      dependencies.transportDependencies,
    );
    if (!accepted || accepted.accepted !== true || typeof accepted.providerMessageId !== 'string' || !accepted.providerMessageId) {
      await module.completeNeedsReview({ id: followUpId, leaseToken: token, reason: 'transport_ambiguous' });
      return 'needs_review';
    }
    await module.completeSent({ id: followUpId, leaseToken: token, providerMessageId: accepted.providerMessageId });
    return 'sent';
  } catch (error) {
    const reason = transportFailureReason(error);
    if (reason === 'transport_ambiguous') {
      await module.completeNeedsReview({ id: followUpId, leaseToken: token, reason });
      return 'needs_review';
    }
    await module.completeFailed({ id: followUpId, leaseToken: token, reason });
    return 'failed';
  }
}
