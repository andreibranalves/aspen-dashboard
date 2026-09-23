import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { whatsappWebhookEffects } from '../schema.js';

type DatabaseProvider = () => AppDatabase;

export type WebhookEffect = 'activity' | 'follow_up';

export interface WebhookEffectInput {
  instance: string;
  providerConversationId: string;
  providerMessageId: string;
  fromMe: boolean;
  occurredAt: Date;
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
  canonicalPhone: string | null;
}

export interface WebhookEffectRecord extends WebhookEffectInput {
  id: string;
  activityDone: boolean;
  followUpDone: boolean;
  attempts: number;
}

export interface WhatsappWebhookEffectsRepository {
  /** Registers each message's effects once; returns the current state in input order. */
  register(inputs: WebhookEffectInput[]): Promise<WebhookEffectRecord[]>;
  markDone(id: string, effect: WebhookEffect): Promise<void>;
  markFailed(id: string, effect: WebhookEffect, nextAttemptAt: Date): Promise<void>;
  /**
   * Leases due pending rows (skipping ones a live webhook may still be
   * handling) so concurrent ticks never pick the same row.
   */
  claimDue(input: { instance: string; limit: number; now: Date; leaseMs: number; minAgeMs: number }): Promise<WebhookEffectRecord[]>;
}

const effects = whatsappWebhookEffects;

function toRecord(row: typeof effects.$inferSelect): WebhookEffectRecord {
  return {
    id: row.id,
    instance: row.instance,
    providerConversationId: row.providerConversationId,
    providerMessageId: row.providerMessageId,
    fromMe: row.fromMe,
    occurredAt: row.occurredAt,
    identityStatus: row.identityStatus as WebhookEffectInput['identityStatus'],
    canonicalPhone: row.canonicalPhone,
    activityDone: row.activityDoneAt !== null,
    followUpDone: row.followUpDoneAt !== null,
    attempts: row.attempts,
  };
}

function keyOf(value: Pick<WebhookEffectInput, 'instance' | 'providerConversationId' | 'providerMessageId'>): string {
  return `${value.instance}\u0000${value.providerConversationId}\u0000${value.providerMessageId}`;
}

const pending = or(isNull(effects.activityDoneAt), isNull(effects.followUpDoneAt)) as SQL;

export function createPostgresWhatsappWebhookEffectsRepository(
  getDb: DatabaseProvider = getDatabase,
): WhatsappWebhookEffectsRepository {
  return {
    async register(inputs) {
      if (inputs.length === 0) return [];
      const now = new Date();
      await getDb()
        .insert(effects)
        .values(
          inputs.map((input) => ({
            id: randomUUID(),
            instance: input.instance,
            providerConversationId: input.providerConversationId,
            providerMessageId: input.providerMessageId,
            fromMe: input.fromMe,
            occurredAt: input.occurredAt,
            identityStatus: input.identityStatus,
            canonicalPhone: input.canonicalPhone || null,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing({
          target: [effects.instance, effects.providerConversationId, effects.providerMessageId],
        });
      const rows = await getDb()
        .select()
        .from(effects)
        .where(
          and(
            eq(effects.instance, inputs[0].instance),
            inArray(
              effects.providerMessageId,
              inputs.map((input) => input.providerMessageId),
            ),
          ),
        );
      const byKey = new Map(rows.map((row) => [keyOf(row), toRecord(row)]));
      return inputs.map((input) => {
        const record = byKey.get(keyOf(input));
        if (!record) throw new Error('webhook effect row missing after register');
        return record;
      });
    },

    async markDone(id, effect) {
      const now = new Date();
      await getDb()
        .update(effects)
        .set({
          ...(effect === 'activity' ? { activityDoneAt: now } : { followUpDoneAt: now }),
          lastFailure: null,
          updatedAt: now,
        })
        .where(eq(effects.id, id));
    },

    async markFailed(id, effect, nextAttemptAt) {
      await getDb()
        .update(effects)
        .set({
          attempts: sql`${effects.attempts} + 1`,
          nextAttemptAt,
          lastFailure: effect === 'activity' ? 'activity_failed' : 'follow_up_failed',
          updatedAt: new Date(),
        })
        .where(eq(effects.id, id));
    },

    async claimDue({ instance, limit, now, leaseMs, minAgeMs }) {
      return getDb().transaction(async (tx) => {
        const due = await tx
          .select({ id: effects.id })
          .from(effects)
          .where(
            and(
              eq(effects.instance, instance),
              pending,
              or(isNull(effects.nextAttemptAt), lte(effects.nextAttemptAt, now)),
              lte(effects.createdAt, new Date(now.getTime() - minAgeMs)),
            ),
          )
          .orderBy(effects.occurredAt, effects.id)
          .limit(limit)
          .for('update', { skipLocked: true });
        if (due.length === 0) return [];
        const leased = await tx
          .update(effects)
          .set({ nextAttemptAt: new Date(now.getTime() + leaseMs), updatedAt: now })
          .where(inArray(effects.id, due.map((row) => row.id)))
          .returning();
        return leased
          .map(toRecord)
          .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id.localeCompare(right.id));
      });
    },
  };
}
