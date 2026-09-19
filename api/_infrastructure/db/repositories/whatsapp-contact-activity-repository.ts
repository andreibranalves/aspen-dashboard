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
  whatsappContactBlockEvents,
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
  actor?: string;
  reason?: string;
}

export interface ContactUnblockInput {
  instance: string;
  canonicalPhone: string;
  actor: string;
  reason: string;
  now?: Date;
  providerConversationId?: string | null;
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
  unblockContact(input: ContactUnblockInput): Promise<void>;
  getActivity(input: {
    instance: string;
    providerConversationId: string;
  }): Promise<WhatsappContactActivityRecord | null>;
  listActivity(instance: string): Promise<WhatsappContactActivityRecord[]>;
}

const activity = whatsappContactActivity;
const blockEvents = whatsappContactBlockEvents;
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
      void instance;
      const rows = await getDb()
        .select({ id: activity.id })
        .from(activity)
        .where(
          and(eq(activity.canonicalPhone, canonicalPhone), eq(activity.blockReason, 'do_not_contact')),
        )
        .limit(1);
      return rows.length > 0;
    },

    async blockContact({
      instance: rawInstance,
      canonicalPhone: rawPhone,
      providerConversationId: rawConversationId,
      now: suppliedNow,
      actor: rawActor,
      reason: rawReason,
    }): Promise<void> {
      const instance = normalizeRequired(rawInstance, 'instance');
      const canonicalPhone = normalizeRequired(rawPhone, 'canonicalPhone');
      const providerConversationId = normalizeRequired(rawConversationId, 'providerConversationId');
      const actor = normalizeRequired(rawActor || 'system', 'actor');
      const reason = normalizeRequired(rawReason || 'Não contatar', 'reason');
      const now = normalizeDate(suppliedNow);
      await getDb().transaction(async (tx) => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${canonicalPhone}::text, 0))
        `);
        await tx
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
        // Propagate the restriction to every activity row of this phone so a
        // later conversation id for the same contact stays blocked.
        await tx
          .update(activity)
          .set({
            blockedAt: now,
            blockReason: 'do_not_contact',
            updatedAt: now,
          })
          .where(eq(activity.canonicalPhone, canonicalPhone));
        await tx.insert(blockEvents).values({
          id: randomUUID(),
          instance,
          canonicalPhone,
          providerConversationId,
          eventType: 'blocked',
          actor,
          reason,
          occurredAt: now,
          createdAt: now,
        });
      });
    },

    async unblockContact({
      instance: rawInstance,
      canonicalPhone: rawPhone,
      actor: rawActor,
      reason: rawReason,
      now: suppliedNow,
      providerConversationId: rawConversationId,
    }): Promise<void> {
      const instance = normalizeRequired(rawInstance, 'instance');
      const canonicalPhone = normalizeRequired(rawPhone, 'canonicalPhone');
      const actor = normalizeRequired(rawActor, 'actor');
      const reason = normalizeRequired(rawReason, 'reason');
      const now = normalizeDate(suppliedNow);
      const providerConversationId =
        rawConversationId == null || String(rawConversationId).trim() === ''
          ? null
          : normalizeRequired(String(rawConversationId), 'providerConversationId');
      await getDb().transaction(async (tx) => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${canonicalPhone}::text, 0))
        `);
        const latestEvents = Array.from(await tx.execute(sql`
          SELECT event_type
          FROM whatsapp_contact_block_events
          WHERE canonical_phone = ${canonicalPhone}
          ORDER BY occurred_at DESC, created_at DESC, id DESC
          LIMIT 1
        `)) as Record<string, unknown>[];
        await tx
          .update(activity)
          .set({
            blockedAt: null,
            blockReason: null,
            updatedAt: now,
          })
          .where(eq(activity.canonicalPhone, canonicalPhone));
        await tx.execute(sql`
          UPDATE opportunity_next_actions action
          SET state = 'active',
              updated_at = ${now.toISOString()}::timestamptz,
              transition_actor = NULL,
              transition_at = NULL,
              transition_origin = NULL,
              transition_reason = NULL,
              replaced_by_id = NULL
          FROM crm_deals deal
          LEFT JOIN clients client ON client.id = deal.client_id
          WHERE action.opportunity_id = deal.id
            AND deal.status NOT IN ('Pedido Fechado', 'Perdido')
            AND action.state = 'suspended'
            AND action.transition_reason = 'Não contatar'
            AND NOT EXISTS (
              SELECT 1
              FROM opportunity_next_actions active
              WHERE active.opportunity_id = action.opportunity_id
                AND active.state = 'active'
            )
            AND (
              deal.telefone = ${canonicalPhone}
              OR client.telefone = ${canonicalPhone}
              OR EXISTS (
                SELECT 1
                FROM quotations quotation
                JOIN quote_revisions revision ON revision.quotation_id = quotation.id
                JOIN quotation_deliveries delivery ON delivery.revision_id = revision.id
                WHERE (quotation.opportunity_id = deal.id OR quotation.id = deal.quotation_id)
                  AND regexp_replace(delivery.phone, '[^0-9]', '', 'g') = ${canonicalPhone}
              )
              OR EXISTS (
                SELECT 1
                FROM quotation_follow_ups follow_up
                JOIN quotations quotation ON quotation.id = follow_up.quotation_id
                WHERE follow_up.canonical_phone = ${canonicalPhone}
                  AND COALESCE(
                    follow_up.approved_opportunity_id,
                    quotation.opportunity_id,
                    (SELECT legacy.id FROM crm_deals legacy
                     WHERE legacy.quotation_id = quotation.id
                     ORDER BY legacy.updated_at DESC, legacy.id DESC LIMIT 1)
                  ) = deal.id
              )
            )
          AND NOT EXISTS (
            SELECT 1
            FROM whatsapp_contact_activity blocked_activity
            WHERE blocked_activity.blocked_at IS NOT NULL
              AND blocked_activity.block_reason = 'do_not_contact'
              AND blocked_activity.canonical_phone IN (
                SELECT phone FROM (
                  SELECT deal.telefone AS phone
                  UNION ALL
                  SELECT client.telefone
                  UNION ALL
                  SELECT follow_up.canonical_phone
                  FROM quotation_follow_ups follow_up
                  JOIN quotations quotation ON quotation.id = follow_up.quotation_id
                  WHERE COALESCE(
                    follow_up.approved_opportunity_id,
                    quotation.opportunity_id,
                    (SELECT legacy.id FROM crm_deals legacy
                     WHERE legacy.quotation_id = quotation.id
                     ORDER BY legacy.updated_at DESC, legacy.id DESC LIMIT 1)
                  ) = deal.id
                  UNION ALL
                  SELECT regexp_replace(delivery.phone, '[^0-9]', '', 'g')
                  FROM quotations quotation
                  JOIN quote_revisions revision ON revision.quotation_id = quotation.id
                  JOIN quotation_deliveries delivery ON delivery.revision_id = revision.id
                  WHERE quotation.opportunity_id = deal.id OR quotation.id = deal.quotation_id
                ) linked_phones
                WHERE phone IS NOT NULL
              )
          )
        `);
        if (latestEvents[0]?.event_type === 'unblocked') return;
        await tx.insert(blockEvents).values({
          id: randomUUID(),
          instance,
          canonicalPhone,
          providerConversationId,
          eventType: 'unblocked',
          actor,
          reason,
          occurredAt: now,
          createdAt: now,
        });
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
