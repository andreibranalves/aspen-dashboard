// Applies the existing side effects of a received WhatsApp message (contact
// activity, then follow-up projection) from a durable pending record. Both
// effects are idempotent, so resuming after a partial failure is safe; each
// one is marked done independently so a retry never repeats a finished one.

import {
  createPostgresWhatsappWebhookEffectsRepository,
  type WebhookEffect,
  type WebhookEffectInput,
  type WebhookEffectRecord,
  type WhatsappWebhookEffectsRepository,
} from '../_infrastructure/db/repositories/whatsapp-webhook-effects-repository.js';

export interface WebhookEffectRunners {
  recordActivity(input: WebhookEffectInput): Promise<void>;
  applyFollowUp(input: WebhookEffectInput): Promise<void>;
}

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const DRAIN_LEASE_MS = 2 * 60_000;
// A live webhook may still be applying a fresh row; the drain leaves it alone.
const DRAIN_MIN_AGE_MS = 60_000;

export function nextEffectAttemptAt(attempts: number, now: Date): Date {
  const delay = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];
  return new Date(now.getTime() + delay);
}

function effectInput(record: WebhookEffectRecord): WebhookEffectInput {
  return {
    instance: record.instance,
    providerConversationId: record.providerConversationId,
    providerMessageId: record.providerMessageId,
    fromMe: record.fromMe,
    occurredAt: record.occurredAt,
    identityStatus: record.identityStatus,
    canonicalPhone: record.canonicalPhone,
  };
}

/** Runs the pending effects of one message in order; throws after recording a failure. */
export async function applyWebhookEffects(
  record: WebhookEffectRecord,
  runners: WebhookEffectRunners,
  repository: Pick<WhatsappWebhookEffectsRepository, 'markDone' | 'markFailed'>,
  now: () => Date = () => new Date(),
): Promise<void> {
  const input = effectInput(record);
  const steps: Array<[WebhookEffect, boolean, () => Promise<void>]> = [
    ['activity', record.activityDone, () => runners.recordActivity(input)],
    ['follow_up', record.followUpDone, () => runners.applyFollowUp(input)],
  ];
  for (const [effect, done, run] of steps) {
    if (done) continue;
    try {
      await run();
    } catch (error) {
      await repository.markFailed(record.id, effect, nextEffectAttemptAt(record.attempts, now()));
      throw error;
    }
    await repository.markDone(record.id, effect);
  }
}

export interface DrainWebhookEffectsInput {
  runners: WebhookEffectRunners;
  limit: number;
  /** Absolute time after which no new row is started. */
  deadlineAt: number;
  repository?: WhatsappWebhookEffectsRepository;
  now?: () => Date;
}

export async function drainWebhookEffects(input: DrainWebhookEffectsInput): Promise<{ applied: number; failed: number }> {
  const repository = input.repository || createPostgresWhatsappWebhookEffectsRepository();
  const now = input.now || (() => new Date());
  const due = await repository.claimDue({
    limit: input.limit,
    now: now(),
    leaseMs: DRAIN_LEASE_MS,
    minAgeMs: DRAIN_MIN_AGE_MS,
  });
  let applied = 0;
  let failed = 0;
  const failedConversations = new Set<string>();
  for (const record of due) {
    if (Date.now() >= input.deadlineAt) break;
    // Keep per-conversation order: after one failure, later events of the same
    // conversation wait for the next tick.
    if (failedConversations.has(record.providerConversationId)) continue;
    try {
      await applyWebhookEffects(record, input.runners, repository, now);
      applied += 1;
    } catch {
      failed += 1;
      failedConversations.add(record.providerConversationId);
    }
  }
  return { applied, failed };
}
