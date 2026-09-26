// Dispatches operator replies recorded in the message outbox (spec §10). Only
// the worker's sweep sends them (ADR 0013): the request just records the intent.

import {
  createPostgresWhatsappMessageOutboxRepository,
  type ClaimedOutbox,
  type OutboxRecord,
  type WhatsappMessageOutboxRepository,
} from '../_infrastructure/db/repositories/whatsapp-message-outbox-repository.js';
import { EvolutionTransportError, sendFrozenStep, sendOperatorMedia } from './evolution-transport.js';
import { loadWhatsappAttachment, type WhatsappAttachment } from '../_infrastructure/db/repositories/whatsapp-attachments-repository.js';
import { validateOperatorMedia } from './whatsapp-media-validation.js';
import { safeErrorSummary } from '../_shared/safe-error.js';

// Longer than one full transport timeout (15 s) so a live dispatch never loses
// its lease; an expired lease therefore means the function died.
export const MESSAGE_LEASE_MS = 45_000;
export const MAX_MESSAGE_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];
const TRANSPORT_TIMEOUT_MS = 15_000;
const SWEEP_MARGIN_MS = 5_000;

export type SendText = (input: { phone: string; text: string; attachment?: WhatsappAttachment | null }) => Promise<{ providerMessageId: string }>;

export interface DispatchDependencies {
  repository?: Pick<
    WhatsappMessageOutboxRepository,
    'claim' | 'markTransportStarted' | 'markAccepted' | 'markFailed' | 'applyReceipts'
  >;
  send?: SendText;
  loadAttachment?: (id: string) => Promise<WhatsappAttachment | null>;
  now?: () => Date;
}

export const liveSendText: SendText = async ({ phone, text, attachment }) => {
  if (attachment) {
    const accepted = await sendOperatorMedia({
      phone, mediaType: attachment.mediaType, mimeType: attachment.mimeType,
      base64: attachment.contentBase64, fileName: attachment.fileName, caption: text,
    });
    return { providerMessageId: accepted.providerMessageId };
  }
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
  let attachment: WhatsappAttachment | null = null;
  if (claimed.attachmentId) {
    try {
      attachment = await (dependencies.loadAttachment || loadWhatsappAttachment)(claimed.attachmentId);
    } catch {
      const at = now();
      return repository.markFailed(claimed.id, claimed.leaseToken, {
        ...failureFor(new EvolutionTransportError('Anexo indisponível.', 'transient_pre_transport', 'MEDIA_STORE_UNAVAILABLE'), claimed, at),
        now: at,
      });
    }
    if (!attachment || attachment.conversationId !== claimed.conversationId || attachment.messageId !== claimed.messageId) {
      return repository.markFailed(claimed.id, claimed.leaseToken, { state: 'failed', failureCode: 'MEDIA_INVALID', now: now() });
    }
    try {
      const checked = validateOperatorMedia({ base64: attachment.contentBase64, mimeType: attachment.mimeType, fileName: attachment.fileName });
      if (checked.checksum !== attachment.checksum || checked.sizeBytes !== attachment.sizeBytes || checked.fileName !== attachment.fileName) {
        throw new Error('INVALID_MEDIA');
      }
    } catch {
      return repository.markFailed(claimed.id, claimed.leaseToken, { state: 'failed', failureCode: 'MEDIA_INVALID', now: now() });
    }
  }
  if (!(await repository.markTransportStarted(claimed.id, claimed.leaseToken, now()))) return null;

  let providerMessageId: string;
  try {
    ({ providerMessageId } = await send({ phone: claimed.destinationPhone, text: claimed.body, attachment }));
  } catch (error) {
    return repository.markFailed(claimed.id, claimed.leaseToken, { ...failureFor(error, claimed, now()), now: now() });
  }
  const accepted = await repository.markAccepted(claimed.id, claimed.leaseToken, providerMessageId, now());
  // A receipt committed between acceptance's read and its commit found no
  // message yet; folding again after the commit closes that window.
  if (accepted) {
    try {
      await repository.applyReceipts(providerMessageId);
    } catch (error) {
      console.error('[whatsapp-message-dispatch] receipts', safeErrorSummary(error));
    }
  }
  return accepted;
}

export interface SweepResult {
  requeued: number;
  toReview: number;
  dispatched: number;
}

/**
 * The worker's reply pass: database-only lease recovery first, then one
 * transport at a time, oldest first, while a full timeout still fits and the
 * worker is not stopping.
 */
export async function sweepOperatorMessages(input: {
  deadlineAt: number;
  stop?: AbortSignal;
  clock?: () => number;
  repository?: WhatsappMessageOutboxRepository;
  send?: SendText;
}): Promise<SweepResult> {
  const repository = input.repository || createPostgresWhatsappMessageOutboxRepository();
  const clock = input.clock || Date.now;
  const { requeued, toReview } = await repository.recoverExpiredLeases(new Date(clock()));
  let dispatched = 0;
  const tried = new Set<string>();
  while (!input.stop?.aborted && clock() + TRANSPORT_TIMEOUT_MS + SWEEP_MARGIN_MS <= input.deadlineAt) {
    const id = await repository.nextDue(new Date(clock()));
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
