import { randomUUID } from 'node:crypto';

import { and, desc, eq, sql } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import {
  createDbDeadline,
  runBoundedBuiltQuery,
  type DbDeadline,
} from '../deadline.js';
import {
  whatsappContactActivity,
  whatsappFollowUpIngestionHealth,
} from '../schema.js';

export type WhatsappActivityIdentityStatus = 'verified' | 'derived' | 'unresolved' | 'conflict';

type DatabaseProvider = () => AppDatabase;
type ActivityDatabase =
  | AppDatabase
  | Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

export interface RecordActivityInput {
  instance: string;
  providerConversationId: string;
  providerMessageId: string;
  fromMe: boolean;
  occurredAt: Date;
  identityStatus: WhatsappActivityIdentityStatus;
  canonicalPhone?: string | null;
}

export interface BlockIngestionInput {
  instance: string;
  eventKey: string;
  now?: Date;
}

export interface ContactBlockInput {
  instance: string;
  canonicalPhone: string;
  providerConversationId: string;
  now?: Date;
}

export interface WhatsappContactActivityRecord {
  id: string;
  instance: string;
  providerConversationId: string;
  lastInboundAt: Date | null;
  lastInboundProviderMessageId: string | null;
  lastOutboundAt: Date | null;
  lastOutboundProviderMessageId: string | null;
  canonicalPhone: string | null;
  identityStatus: WhatsappActivityIdentityStatus | null;
  blockedAt: Date | null;
  blockReason: 'do_not_contact' | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsappFollowUpIngestionHealthRecord {
  instance: string;
  lastUpsertAt: Date | null;
  lastUpsertEventKey: string | null;
  blockedAt: Date | null;
  blockReason: 'unparsed_upsert' | null;
  blockedEventKey: string | null;
  updatedAt: Date;
}

export interface WhatsappContactActivityRepository {
  recordActivity(
    input: RecordActivityInput,
    options?: { timeoutMs?: number; deadline?: DbDeadline }
  ): Promise<void>;
  getHealth(instance: string): Promise<WhatsappFollowUpIngestionHealthRecord | null>;
  blockIngestion(input: BlockIngestionInput): Promise<void>;
  unblockIngestionIfEvent(input: { instance: string; eventKey: string }): Promise<boolean>;
  markIngestion(input: { instance: string; eventKey: string; at: Date }): Promise<void>;
  isContactBlocked(input: { instance: string; canonicalPhone: string }): Promise<boolean>;
  blockContact(input: ContactBlockInput): Promise<void>;
  getActivity(input: {
    instance: string;
    providerConversationId: string;
  }): Promise<WhatsappContactActivityRecord | null>;
  listActivity(instance: string): Promise<WhatsappContactActivityRecord[]>;
}

const activity = whatsappContactActivity;
const health = whatsappFollowUpIngestionHealth;

function normalizeRequired(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeDate(value: Date | undefined): Date {
  return value && !Number.isNaN(value.getTime()) ? value : new Date();
}

function activityIdentityUpdate() {
  return {
    canonicalPhone: sql`
      CASE
        WHEN excluded.canonical_phone IS NOT NULL AND btrim(excluded.canonical_phone) <> ''
          THEN excluded.canonical_phone
        ELSE ${activity.canonicalPhone}
      END
    `,
    identityStatus: sql`
      CASE
        WHEN excluded.canonical_phone IS NOT NULL AND btrim(excluded.canonical_phone) <> ''
          THEN excluded.identity_status
        ELSE COALESCE(${activity.identityStatus}, excluded.identity_status)
      END
    `,
  };
}

export function createPostgresWhatsappContactActivityRepository(
  getDb: DatabaseProvider = getDatabase,
): WhatsappContactActivityRepository {
  return {
    async recordActivity(
      input,
      options: { timeoutMs?: number; deadline?: DbDeadline } = {},
    ): Promise<void> {
      const instance = normalizeRequired(input.instance, 'instance');
      const providerConversationId = normalizeRequired(
        input.providerConversationId,
        'providerConversationId',
      );
      const providerMessageId = normalizeRequired(input.providerMessageId, 'providerMessageId');
      const occurredAt = normalizeDate(input.occurredAt);
      const now = new Date();
      const inboundAt = input.fromMe ? null : occurredAt;
      const inboundId = input.fromMe ? null : providerMessageId;
      const outboundAt = input.fromMe ? occurredAt : null;
      const outboundId = input.fromMe ? providerMessageId : null;
      const canonicalPhone = input.canonicalPhone?.trim() || null;

      const persist = (target: ActivityDatabase) =>
        target
        .insert(activity)
        .values({
          id: randomUUID(),
          instance,
          providerConversationId,
          lastInboundAt: inboundAt,
          lastInboundProviderMessageId: inboundId,
          lastOutboundAt: outboundAt,
          lastOutboundProviderMessageId: outboundId,
          canonicalPhone,
          identityStatus: input.identityStatus,
          blockedAt: null,
          blockReason: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [activity.instance, activity.providerConversationId],
          set: {
            lastInboundAt: sql`
              CASE
                WHEN excluded.last_inbound_at IS NOT NULL
                  AND (
                    ${activity.lastInboundAt} IS NULL
                    OR excluded.last_inbound_at > ${activity.lastInboundAt}
                    OR (
                      excluded.last_inbound_at = ${activity.lastInboundAt}
                      AND excluded.last_inbound_provider_message_id > COALESCE(${activity.lastInboundProviderMessageId}, '')
                    )
                  )
                  THEN excluded.last_inbound_at
                ELSE ${activity.lastInboundAt}
              END
            `,
            lastInboundProviderMessageId: sql`
              CASE
                WHEN excluded.last_inbound_at IS NOT NULL
                  AND (
                    ${activity.lastInboundAt} IS NULL
                    OR excluded.last_inbound_at > ${activity.lastInboundAt}
                    OR (
                      excluded.last_inbound_at = ${activity.lastInboundAt}
                      AND excluded.last_inbound_provider_message_id > COALESCE(${activity.lastInboundProviderMessageId}, '')
                    )
                  )
                  THEN excluded.last_inbound_provider_message_id
                ELSE ${activity.lastInboundProviderMessageId}
              END
            `,
            lastOutboundAt: sql`
              CASE
                WHEN excluded.last_outbound_at IS NOT NULL
                  AND (
                    ${activity.lastOutboundAt} IS NULL
                    OR excluded.last_outbound_at > ${activity.lastOutboundAt}
                    OR (
                      excluded.last_outbound_at = ${activity.lastOutboundAt}
                      AND excluded.last_outbound_provider_message_id > COALESCE(${activity.lastOutboundProviderMessageId}, '')
                    )
                  )
                  THEN excluded.last_outbound_at
                ELSE ${activity.lastOutboundAt}
              END
            `,
            lastOutboundProviderMessageId: sql`
              CASE
                WHEN excluded.last_outbound_at IS NOT NULL
                  AND (
                    ${activity.lastOutboundAt} IS NULL
                    OR excluded.last_outbound_at > ${activity.lastOutboundAt}
                    OR (
                      excluded.last_outbound_at = ${activity.lastOutboundAt}
                      AND excluded.last_outbound_provider_message_id > COALESCE(${activity.lastOutboundProviderMessageId}, '')
                    )
                  )
                  THEN excluded.last_outbound_provider_message_id
                ELSE ${activity.lastOutboundProviderMessageId}
              END
            `,
            ...activityIdentityUpdate(),
            updatedAt: sql`GREATEST(${activity.updatedAt}, excluded.updated_at)`,
          },
        });
      const deadline =
        options.deadline ||
        (options.timeoutMs === undefined ? null : createDbDeadline(options.timeoutMs));
      if (!deadline) {
        await persist(getDb());
        return;
      }
      // The same true deadline/cancellation mechanism used for reconciliation:
      // a queued or blocked write is cancelled by postgres.js/PostgreSQL instead
      // of later acquiring the sole pooled connection and committing.
      const query = persist(getDb()).toSQL();
      await runBoundedBuiltQuery(getDb(), deadline, { sql: query.sql, params: query.params });
    },

    async getHealth(instance): Promise<WhatsappFollowUpIngestionHealthRecord | null> {
      const rows = await getDb()
        .select()
        .from(health)
        .where(eq(health.instance, normalizeRequired(instance, 'instance')))
        .limit(1);
      return (rows[0] as WhatsappFollowUpIngestionHealthRecord | undefined) || null;
    },

    async markIngestion({ instance: rawInstance, eventKey: rawEventKey, at }): Promise<void> {
      const instance = normalizeRequired(rawInstance, 'instance');
      const eventKey = normalizeRequired(rawEventKey, 'eventKey');
      const now = new Date();
      await getDb()
        .insert(health)
        .values({
          instance,
          lastUpsertAt: at,
          lastUpsertEventKey: eventKey,
          blockedAt: null,
          blockReason: null,
          blockedEventKey: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: health.instance,
          set: {
            lastUpsertAt: sql`
              CASE
                WHEN ${health.lastUpsertAt} IS NULL OR excluded.last_upsert_at > ${health.lastUpsertAt}
                  THEN excluded.last_upsert_at
                ELSE ${health.lastUpsertAt}
              END
            `,
            lastUpsertEventKey: sql`
              CASE
                WHEN ${health.lastUpsertAt} IS NULL OR excluded.last_upsert_at >= ${health.lastUpsertAt}
                  THEN excluded.last_upsert_event_key
                ELSE ${health.lastUpsertEventKey}
              END
            `,
            updatedAt: sql`GREATEST(${health.updatedAt}, excluded.updated_at)`,
          },
        });
    },

    async blockIngestion({ instance: rawInstance, eventKey: rawEventKey, now: suppliedNow }): Promise<void> {
      const instance = normalizeRequired(rawInstance, 'instance');
      const eventKey = normalizeRequired(rawEventKey, 'eventKey');
      const now = normalizeDate(suppliedNow);
      await getDb()
        .insert(health)
        .values({
          instance,
          lastUpsertAt: null,
          lastUpsertEventKey: null,
          blockedAt: now,
          blockReason: 'unparsed_upsert',
          blockedEventKey: eventKey,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: health.instance,
          set: {
            blockedAt: now,
            blockReason: 'unparsed_upsert',
            blockedEventKey: eventKey,
            updatedAt: now,
          },
        });
    },

    async unblockIngestionIfEvent({ instance: rawInstance, eventKey: rawEventKey }): Promise<boolean> {
      const instance = normalizeRequired(rawInstance, 'instance');
      const eventKey = normalizeRequired(rawEventKey, 'eventKey');
      const rows = await getDb()
        .update(health)
        .set({
          blockedAt: null,
          blockReason: null,
          blockedEventKey: null,
          updatedAt: new Date(),
        })
        .where(and(eq(health.instance, instance), eq(health.blockedEventKey, eventKey)))
        .returning({ instance: health.instance });
      return rows.length > 0;
    },

    async isContactBlocked({ instance: rawInstance, canonicalPhone: rawPhone }): Promise<boolean> {
      const instance = normalizeRequired(rawInstance, 'instance');
      const canonicalPhone = normalizeRequired(rawPhone, 'canonicalPhone');
      const rows = await getDb()
        .select({ id: activity.id })
        .from(activity)
        .where(
          and(
            eq(activity.instance, instance),
            eq(activity.canonicalPhone, canonicalPhone),
            eq(activity.blockReason, 'do_not_contact'),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async blockContact({
      instance: rawInstance,
      canonicalPhone: rawPhone,
      providerConversationId: rawConversationId,
      now: suppliedNow,
    }): Promise<void> {
      const instance = normalizeRequired(rawInstance, 'instance');
      const canonicalPhone = normalizeRequired(rawPhone, 'canonicalPhone');
      const providerConversationId = normalizeRequired(rawConversationId, 'providerConversationId');
      const now = normalizeDate(suppliedNow);
      await getDb()
        .insert(activity)
        .values({
          id: randomUUID(),
          instance,
          providerConversationId,
          lastInboundAt: null,
          lastInboundProviderMessageId: null,
          lastOutboundAt: null,
          lastOutboundProviderMessageId: null,
          canonicalPhone,
          identityStatus: 'verified',
          blockedAt: now,
          blockReason: 'do_not_contact',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [activity.instance, activity.providerConversationId],
          set: {
            canonicalPhone,
            blockedAt: now,
            blockReason: 'do_not_contact',
            updatedAt: now,
          },
        });
    },

    async getActivity({ instance: rawInstance, providerConversationId: rawConversationId }) {
      const rows = await getDb()
        .select()
        .from(activity)
        .where(
          and(
            eq(activity.instance, normalizeRequired(rawInstance, 'instance')),
            eq(
              activity.providerConversationId,
              normalizeRequired(rawConversationId, 'providerConversationId'),
            ),
          ),
        )
        .limit(1);
      return (rows[0] as WhatsappContactActivityRecord | undefined) || null;
    },

    async listActivity(instance: string) {
      const rows = await getDb()
        .select()
        .from(activity)
        .where(eq(activity.instance, normalizeRequired(instance, 'instance')))
        .orderBy(desc(activity.updatedAt));
      return rows as WhatsappContactActivityRecord[];
    },
  };
}

export const createWhatsappContactActivityRepository =
  createPostgresWhatsappContactActivityRepository;
