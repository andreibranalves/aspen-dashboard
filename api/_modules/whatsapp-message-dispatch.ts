// Dispatches operator replies recorded in the message outbox (spec §10). The
// same path serves the send request itself and the recovery sweep in the
// delivery-worker tick, so both obey one reservation and one failure policy.

import {
  createPostgresWhatsappMessageOutboxRepository,
  type ClaimedOutbox,
  type OutboxRecord,
  type WhatsappMessageOutboxRepository,
} from '../_infrastructure/db/repositories/whatsapp-message-outbox-repository.js';
import { EvolutionTransportError, sendFrozenStep } from './evolution-transport.js';

// Longer than one full transport timeout (15 s) so a live dispatch never loses
// its lease; an expired lease therefore means the function died.
export const MESSAGE_LEASE_MS = 45_000;
export const MAX_MESSAGE_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];
const TRANSPORT_TIMEOUT_MS = 15_000;
const SWEEP_MARGIN_MS = 5_000;
// Fresh intents belong to the request that recorded them.
const SWEEP_MIN_AGE_MS = 60_000;

export type SendText = (input: { phone: string; text: string }) => Promise<{ providerMessageId: string }>;

export interface DispatchDependencies {
  repository?: Pick<
    WhatsappMessageOutboxRepository,
    'claim' | 'markTransportStarted' | 'markAccepted' | 'markFailed'
  >;
  send?: SendText;
  now?: () => Date;
}

export const liveSendText: SendText = async ({ phone, text }) => {
  const accepted = await sendFrozenStep({
    phone,
    step: { position: 0, type: 'text', payload: { text }, delayMs: 0 },
  });
  return { providerMessageId: accepted.providerMessageId };
};

function failureFor(error: unknown, claimed: ClaimedOutbox, now: Date) {
  if (error instanceof EvolutionTransportError) {
    if (error.kind === 'transient_pre_transport' && claimed.attempts < MAX_MESSAGE_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[Math.min(claimed.attempts - 1, RETRY_DELAYS_MS.length - 1)];
      return { state: 'retry_scheduled' as const, failureCode: error.code, retryAt: new Date(now.getTime() + delay) };
    }
    if (error.kind === 'transient_pre_transport' || error.kind === 'permanent_pre_transport') {
      return { state: 'failed' as const, failureCode: error.code };
    }
    return { state: 'needs_review' as const, failureCode: error.code };
  }
  // Anything unclassified may have reached the provider: never retry it blindly.
  return { state: 'needs_review' as const, failureCode: 'TRANSPORT_UNKNOWN' };
}

/**
 * Reserves and transports one intent. Returns null when the reservation was
 * not obtained (already taken, cancelled or no longer dispatchable).
 */
export async function dispatchOutboxMessage(
  outboxId: string,
  dependencies: DispatchDependencies = {},
): Promise<OutboxRecord | null> {
  const repository = dependencies.repository || createPostgresWhatsappMessageOutboxRepository();
  const send = dependencies.send || liveSendText;
  const now = dependencies.now || (() => new Date());

  const claimed = await repository.claim(outboxId, { leaseMs: MESSAGE_LEASE_MS, now: now() });
  if (!claimed) return null;
  if (!(await repository.markTransportStarted(claimed.id, claimed.leaseToken, now()))) return null;

  let providerMessageId: string;
  try {
    ({ providerMessageId } = await send({ phone: claimed.destinationPhone, text: claimed.body }));
  } catch (error) {
    return repository.markFailed(claimed.id, claimed.leaseToken, { ...failureFor(error, claimed, now()), now: now() });
  }
  return repository.markAccepted(claimed.id, claimed.leaseToken, providerMessageId, now());
}

export interface SweepResult {
  requeued: number;
  toReview: number;
  dispatched: number;
}

/**
 * Recovery sweep run after the quotation batch: database-only lease recovery
 * first, then one transport at a time while a full timeout still fits.
 */
export async function sweepOperatorMessages(input: {
  deadlineAt: number;
  clock?: () => number;
  repository?: WhatsappMessageOutboxRepository;
  send?: SendText;
}): Promise<SweepResult> {
  const repository = input.repository || createPostgresWhatsappMessageOutboxRepository();
  const clock = input.clock || Date.now;
  const { requeued, toReview } = await repository.recoverExpiredLeases(new Date(clock()));
  let dispatched = 0;
  const tried = new Set<string>();
  while (clock() + TRANSPORT_TIMEOUT_MS + SWEEP_MARGIN_MS <= input.deadlineAt) {
    const id = await repository.nextDue({ now: new Date(clock()), minAgeMs: SWEEP_MIN_AGE_MS });
    if (!id || tried.has(id)) break;
    tried.add(id);
    const result = await dispatchOutboxMessage(id, {
      repository,
      send: input.send,
      now: () => new Date(clock()),
    });
    if (result) dispatched += 1;
  }
  return { requeued, toReview, dispatched };
}
