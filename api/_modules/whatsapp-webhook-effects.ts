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

/** The existing effect implementations, in the order the webhook always applied them. */
export function createWebhookEffectRunners(
  activity: { recordActivity(input: WebhookEffectInput): Promise<void> },
  followUps: { applyConversationToOpenFollowUps?(input: WebhookEffectInput): Promise<void> },
): WebhookEffectRunners {
  return {
    recordActivity: (input) => activity.recordActivity(input),
    applyFollowUp: async (input) => {
      await followUps.applyConversationToOpenFollowUps?.(input);
    },
  };
}

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
// A done row only dedupes Evolution resends, which arrive within minutes; after
// 14 days it goes (ADR 0013), so the table does not keep contacts forever.
export const EFFECT_RETENTION_MS = 14 * 86_400_000;
const PRUNE_BATCH = 500;
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

/** Deletes the oldest done rows past the retention; returns how many. */
export async function pruneWebhookEffects(
  input: { repository?: Pick<WhatsappWebhookEffectsRepository, 'pruneDone'>; now?: () => Date } = {},
): Promise<number> {
  const repository = input.repository || createPostgresWhatsappWebhookEffectsRepository();
  const now = (input.now || (() => new Date()))();
  return repository.pruneDone({
    completedBefore: new Date(now.getTime() - EFFECT_RETENTION_MS),
    limit: PRUNE_BATCH,
  });
}

export interface DrainWebhookEffectsInput {
  instance: string;
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
    instance: input.instance,
    limit: input.limit,
    now: now(),
    leaseMs: DRAIN_LEASE_MS,
    minAgeMs: DRAIN_MIN_AGE_MS,
  });
  let applied = 0;
  let failed = 0;
  const failedConversations = new Set<string>();
  for (const record of due) {
    if (now().getTime() >= input.deadlineAt) break;
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
