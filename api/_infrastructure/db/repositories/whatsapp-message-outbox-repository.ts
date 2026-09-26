import { createHash, randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, lte, ne, or } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import {
  evolutionReceiptInbox,
  whatsappConversations,
  whatsappMessageOutbox,
  whatsappMessageAttachments,
  whatsappMessages,
} from '../schema.js';
import { SEND_WINDOW_MS } from '../../../_modules/quotation-delivery-state.js';

type DatabaseProvider = () => AppDatabase;
type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

export type OutboxState =
  | 'queued'
  | 'dispatching'
  | 'provider_accepted'
  | 'retry_scheduled'
  | 'failed'
  | 'needs_review'
  | 'cancelled';

export type DeliveryStatus = 'server_ack' | 'delivered' | 'read' | 'error';

export interface OutboxRecord {
  id: string;
  messageId: string;
  conversationId: string;
  clientRequestId: string;
  destinationPhone: string;
  identityVersion: number;
  body: string;
  attachmentId?: string | null;
  state: OutboxState;
  attempts: number;
  transportStartedAt: Date | null;
  providerMessageId: string | null;
  failureCode: string | null;
  resolution: 'confirmed_sent' | 'confirmed_not_sent' | null;
  createdAt: Date;
}

export interface ClaimedOutbox extends OutboxRecord {
  leaseToken: string;
}

/** Why a send intent was refused before anything was recorded. */
export type IntentRefusal =
  | 'conversation_not_found'
  | 'identity_unresolved'
  | 'identity_conflict'
  | 'identity_changed'
  | 'idempotency_conflict'
  | 'attachment_not_found';

export class OutboxIntentRefused extends Error {
  constructor(readonly reason: IntentRefusal) {
    super(reason);
    this.name = 'OutboxIntentRefused';
  }
}

export class OutboxActionRefused extends Error {
  constructor(
    readonly current: OutboxRecord | null,
    readonly reason: 'state' | 'stale' = 'state',
  ) {
    super('outbox action refused');
    this.name = 'OutboxActionRefused';
  }
}

export interface CreateIntentInput {
  clientRequestId: string;
  conversationId: string;
  expectedIdentityVersion: number;
  body: string;
  attachmentId?: string | null;
  now?: Date;
}

export interface WhatsappMessageOutboxRepository {
  /** Records message + intent atomically, or returns the existing intent for the same key. */
  createIntent(input: CreateIntentInput): Promise<{ record: OutboxRecord; created: boolean }>;
  findByClientRequestId(clientRequestId: string): Promise<OutboxRecord | null>;
  findByMessageId(messageId: string): Promise<OutboxRecord | null>;
  /**
   * Atomically reserves a queued/retry intent. Returns null when another
   * dispatcher holds it or it left the dispatchable states. A destination that
   * changed since the intent was recorded fails the intent before transport.
   */
  claim(id: string, input: { leaseMs: number; now?: Date }): Promise<ClaimedOutbox | null>;
  markTransportStarted(id: string, leaseToken: string, now?: Date): Promise<boolean>;
  markAccepted(id: string, leaseToken: string, providerMessageId: string, now?: Date): Promise<OutboxRecord | null>;
  markFailed(
    id: string,
    leaseToken: string,
    input: { state: 'retry_scheduled' | 'failed' | 'needs_review'; failureCode: string; retryAt?: Date; now?: Date },
  ): Promise<OutboxRecord | null>;
  /** Expired leases: never started → back to the queue; started → needs review. */
  recoverExpiredLeases(now?: Date): Promise<{ requeued: number; toReview: number }>;
  /** Oldest dispatchable intent id. */
  nextDue(now?: Date): Promise<string | null>;
  /** `expectedRevision` is the message revision the operator acted on. */
  cancel(messageId: string, expectedRevision: number, now?: Date): Promise<OutboxRecord>;
  resolveReview(
    messageId: string,
    resolution: 'confirmed_sent' | 'confirmed_not_sent',
    expectedRevision: number,
    now?: Date,
  ): Promise<OutboxRecord>;
  /** Folds durable Evolution receipts into outbound messages with this provider id. */
  applyReceipts(providerMessageId: string): Promise<number>;
}

const outbox = whatsappMessageOutbox;
const messages = whatsappMessages;
const conversations = whatsappConversations;

const RECEIPT_RANK: Record<string, number> = { SERVER_ACK: 1, DELIVERY_ACK: 2, READ: 3, PLAYED: 3 };
const DELIVERY_RANK: Record<DeliveryStatus, number> = { error: 0, server_ack: 1, delivered: 2, read: 3 };
const RANK_STATUS: Record<number, DeliveryStatus> = { 1: 'server_ack', 2: 'delivered', 3: 'read' };

export function outboxFingerprint(input: {
  conversationId: string;
  destinationPhone: string;
  identityVersion: number;
  body: string;
  attachmentId?: string | null;
}): string {
  return createHash('sha256')
    .update(JSON.stringify(input.attachmentId
      ? [input.conversationId, input.destinationPhone, input.identityVersion, input.body, input.attachmentId]
      : [input.conversationId, input.destinationPhone, input.identityVersion, input.body]))
    .digest('hex');
}

function toRecord(row: typeof outbox.$inferSelect): OutboxRecord {
  return {
    id: row.id,
    messageId: row.messageId,
    conversationId: row.conversationId,
    clientRequestId: row.clientRequestId,
    destinationPhone: row.destinationPhone,
    identityVersion: row.identityVersion,
    body: row.body,
    attachmentId: row.attachmentId,
    state: row.state as OutboxState,
    attempts: row.attempts,
    transportStartedAt: row.transportStartedAt,
    providerMessageId: row.providerMessageId,
    failureCode: row.failureCode,
    resolution: row.resolution as OutboxRecord['resolution'],
    createdAt: row.createdAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return (cause as { code?: unknown })?.code === '23505';
}

function preview(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > 280 ? `${text.slice(0, 279)}…` : text;
}

/** Bumps the conversation revision under its row lock and stamps the given messages. */
async function touchMessages(tx: Transaction, conversationId: string, messageIds: string[], now: Date): Promise<number> {
  const [current] = await tx
    .select({ revision: conversations.revision })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .for('update');
  const revision = Number(current.revision) + 1;
  if (messageIds.length) {
    await tx.update(messages).set({ revision }).where(inArray(messages.id, messageIds));
  }
  await tx.update(conversations).set({ revision, updatedAt: now }).where(eq(conversations.id, conversationId));
  return revision;
}

async function receiptStatus(tx: Transaction, providerMessageId: string): Promise<DeliveryStatus | null> {
  const rows = await tx
    .select({ status: evolutionReceiptInbox.status })
    .from(evolutionReceiptInbox)
    .where(eq(evolutionReceiptInbox.providerMessageId, providerMessageId));
  let rank = 0;
  let error = false;
  for (const row of rows) {
    if (row.status === 'ERROR') error = true;
    rank = Math.max(rank, RECEIPT_RANK[row.status] || 0);
  }
  if (rank > 0) return RANK_STATUS[rank];
  return error ? 'error' : null;
}

export function createPostgresWhatsappMessageOutboxRepository(
  getDb: DatabaseProvider = getDatabase,
): WhatsappMessageOutboxRepository {
  async function createIntentOnce(input: CreateIntentInput): Promise<{ record: OutboxRecord; created: boolean }> {
    const now = input.now || new Date();
    return getDb().transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .for('update');
      if (!conversation) throw new OutboxIntentRefused('conversation_not_found');

      const [existing] = await tx.select().from(outbox).where(eq(outbox.clientRequestId, input.clientRequestId));
      if (existing) {
        // The client never names the destination: it is fixed by the
        // identity version, so the recorded destination completes the print.
        const same =
          existing.fingerprint ===
          outboxFingerprint({
            conversationId: input.conversationId,
            destinationPhone: existing.destinationPhone,
            identityVersion: input.expectedIdentityVersion,
            body: input.body,
            attachmentId: input.attachmentId,
          });
        if (!same) throw new OutboxIntentRefused('idempotency_conflict');
        return { record: toRecord(existing), created: false };
      }

      if (conversation.identityStatus === 'conflict') throw new OutboxIntentRefused('identity_conflict');
      const phone = conversation.canonicalPhone || '';
      if (!phone || conversation.identityStatus === 'unresolved') {
        throw new OutboxIntentRefused('identity_unresolved');
      }
      if (conversation.identityVersion !== input.expectedIdentityVersion) {
        throw new OutboxIntentRefused('identity_changed');
      }

      const attachmentId = input.attachmentId || null;
      const [attachment] = attachmentId
        ? await tx.select().from(whatsappMessageAttachments)
          .where(eq(whatsappMessageAttachments.id, attachmentId)).for('update')
        : [];
      if (attachmentId && (!attachment || attachment.conversationId !== conversation.id || attachment.messageId)) {
        throw new OutboxIntentRefused('attachment_not_found');
      }
      const displayBody = input.body.trim() ? input.body : attachment?.fileName || '';
      if (!displayBody) throw new OutboxIntentRefused('attachment_not_found');

      const revision = Number(conversation.revision) + 1;
      const messageId = randomUUID();
      await tx.insert(messages).values({
        id: messageId,
        conversationId: conversation.id,
        providerMessageId: null,
        direction: 'outbound',
        messageType: attachment?.mediaType || 'text',
        body: displayBody,
        origin: 'operator',
        providerTimestamp: now,
        ingestedAt: now,
        createdRevision: revision,
        revision,
      });
      const [created] = await tx
        .insert(outbox)
        .values({
          id: randomUUID(),
          messageId,
          conversationId: conversation.id,
          clientRequestId: input.clientRequestId,
          attachmentId,
          fingerprint: outboxFingerprint({
            conversationId: conversation.id,
            destinationPhone: phone,
            identityVersion: conversation.identityVersion,
            body: input.body,
            attachmentId,
          }),
          destinationPhone: phone,
          identityVersion: conversation.identityVersion,
          body: displayBody,
          state: 'queued',
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx
        .update(conversations)
        .set({
          revision,
          lastMessageAt: now,
          lastMessagePreview: preview(displayBody),
          lastMessageDirection: 'outbound',
          updatedAt: now,
        })
        .where(eq(conversations.id, conversation.id));
      if (attachmentId) {
        await tx.update(whatsappMessageAttachments).set({ messageId }).where(eq(whatsappMessageAttachments.id, attachmentId));
      }
      return { record: toRecord(created), created: true };
    });
  }

  async function transitionByMessage(
    messageId: string,
    allowed: OutboxState[],
    next: Partial<typeof outbox.$inferInsert>,
    expectedRevision: number,
    now: Date,
  ): Promise<OutboxRecord> {
    return getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(outbox).where(eq(outbox.messageId, messageId)).for('update');
      if (!row) throw new OutboxActionRefused(null);
      // Every outbox transition bumps the message revision, so a stale view is
      // refused even when the state happens to match again.
      const [message] = await tx.select({ revision: messages.revision }).from(messages).where(eq(messages.id, messageId));
      if (Number(message?.revision) !== expectedRevision) throw new OutboxActionRefused(toRecord(row), 'stale');
      if (!allowed.includes(row.state as OutboxState)) throw new OutboxActionRefused(toRecord(row));
      const [updated] = await tx
        .update(outbox)
        .set({ ...next, updatedAt: now })
        .where(eq(outbox.id, row.id))
        .returning();
      await touchMessages(tx, row.conversationId, [row.messageId], now);
      return toRecord(updated);
    });
  }

  return {
    async createIntent(input) {
      try {
        return await createIntentOnce(input);
      } catch (error) {
        // Two requests with the same key raced past the lookup; the loser
        // re-reads the committed intent and gets the normal idempotent answer.
        if (isUniqueViolation(error)) return createIntentOnce(input);
        throw error;
      }
    },

    async findByClientRequestId(clientRequestId) {
      const [row] = await getDb().select().from(outbox).where(eq(outbox.clientRequestId, clientRequestId));
      return row ? toRecord(row) : null;
    },

    async findByMessageId(messageId) {
      const [row] = await getDb().select().from(outbox).where(eq(outbox.messageId, messageId));
      return row ? toRecord(row) : null;
    },

    async claim(id, input) {
      const now = input.now || new Date();
      return getDb().transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(outbox)
          .where(and(eq(outbox.id, id), inArray(outbox.state, ['queued', 'retry_scheduled'])))
          .for('update', { skipLocked: true });
        if (!row) return null;
        if (row.createdAt.getTime() + SEND_WINDOW_MS <= now.getTime()) {
          // ADR 0013: a reply only leaves until 30 min after the operator wrote it.
          await tx
            .update(outbox)
            .set({ state: 'failed', failureCode: 'SEND_WINDOW_EXPIRED', updatedAt: now })
            .where(eq(outbox.id, row.id));
          await touchMessages(tx, row.conversationId, [row.messageId], now);
          return null;
        }
        const [conversation] = await tx
          .select({
            canonicalPhone: conversations.canonicalPhone,
            identityStatus: conversations.identityStatus,
            identityVersion: conversations.identityVersion,
          })
          .from(conversations)
          .where(eq(conversations.id, row.conversationId));
        const destinationStable =
          conversation &&
          conversation.identityStatus !== 'conflict' &&
          conversation.canonicalPhone === row.destinationPhone &&
          conversation.identityVersion === row.identityVersion;
        if (!destinationStable) {
          // Not sent and never will be to a destination nobody reviewed.
          await tx
            .update(outbox)
            .set({ state: 'failed', failureCode: 'DESTINATION_CHANGED', updatedAt: now })
            .where(eq(outbox.id, row.id));
          await touchMessages(tx, row.conversationId, [row.messageId], now);
          return null;
        }
        const leaseToken = randomUUID();
        const [claimed] = await tx
          .update(outbox)
          .set({
            state: 'dispatching',
            leaseToken,
            leaseExpiresAt: new Date(now.getTime() + input.leaseMs),
            attempts: row.attempts + 1,
            updatedAt: now,
          })
          .where(eq(outbox.id, row.id))
          .returning();
        await touchMessages(tx, row.conversationId, [row.messageId], now);
        return { ...toRecord(claimed), leaseToken };
      });
    },

    async markTransportStarted(id, leaseToken, now = new Date()) {
      const rows = await getDb()
        .update(outbox)
        .set({ transportStartedAt: now, updatedAt: now })
        .where(and(eq(outbox.id, id), eq(outbox.leaseToken, leaseToken), eq(outbox.state, 'dispatching')))
        .returning({ id: outbox.id });
      return rows.length === 1;
    },

    async markAccepted(id, leaseToken, providerMessageId, now = new Date()) {
      return getDb().transaction(async (tx) => {
        // A late acceptance after the lease expired into review is still the
        // provider's real answer for the only transport that ever started.
        const [row] = await tx
          .select()
          .from(outbox)
          .where(
            and(
              eq(outbox.id, id),
              or(
                and(eq(outbox.leaseToken, leaseToken), eq(outbox.state, 'dispatching')),
                and(
                  eq(outbox.state, 'needs_review'),
                  eq(outbox.failureCode, 'LEASE_EXPIRED_AFTER_TRANSPORT'),
                  isNull(outbox.providerMessageId),
                  isNull(outbox.resolution),
                ),
              ),
            ),
          )
          .for('update');
        if (!row) return null;
        // Lock the conversation first so the echo ingestion cannot interleave.
        await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, row.conversationId)).for('update');
        const [echo] = await tx
          .select({ id: messages.id, deliveryStatus: messages.deliveryStatus })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, row.conversationId),
              eq(messages.providerMessageId, providerMessageId),
              ne(messages.id, row.messageId),
            ),
          );
        const touched = [row.messageId];
        if (echo) {
          // The provider echo was stored first: it becomes a pointer to the
          // operator message instead of a second bubble.
          await tx
            .update(messages)
            .set({ providerMessageId: null, supersededBy: row.messageId })
            .where(eq(messages.id, echo.id));
          touched.push(echo.id);
        }
        const status = await receiptStatus(tx, providerMessageId);
        const best = [status, echo?.deliveryStatus as DeliveryStatus | null]
          .filter((value): value is DeliveryStatus => Boolean(value))
          .sort((left, right) => DELIVERY_RANK[right] - DELIVERY_RANK[left])[0] || null;
        await tx
          .update(messages)
          .set({ providerMessageId, ...(best ? { deliveryStatus: best } : {}) })
          .where(eq(messages.id, row.messageId));
        const [updated] = await tx
          .update(outbox)
          .set({
            state: 'provider_accepted',
            providerMessageId,
            leaseToken: null,
            leaseExpiresAt: null,
            failureCode: null,
            updatedAt: now,
          })
          .where(eq(outbox.id, row.id))
          .returning();
        await touchMessages(tx, row.conversationId, touched, now);
        return toRecord(updated);
      });
    },

    async markFailed(id, leaseToken, input) {
      const now = input.now || new Date();
      return getDb().transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(outbox)
          .where(and(eq(outbox.id, id), eq(outbox.leaseToken, leaseToken), eq(outbox.state, 'dispatching')))
          .for('update');
        if (!row) return null;
        const [updated] = await tx
          .update(outbox)
          .set({
            state: input.state,
            failureCode: input.failureCode,
            leaseToken: null,
            leaseExpiresAt: null,
            ...(input.state === 'retry_scheduled' && input.retryAt ? { nextAttemptAt: input.retryAt } : {}),
            updatedAt: now,
          })
          .where(eq(outbox.id, row.id))
          .returning();
        await touchMessages(tx, row.conversationId, [row.messageId], now);
        return toRecord(updated);
      });
    },

    async recoverExpiredLeases(now = new Date()) {
      return getDb().transaction(async (tx) => {
        const expired = await tx
          .select()
          .from(outbox)
          .where(and(eq(outbox.state, 'dispatching'), lte(outbox.leaseExpiresAt, now)))
          .for('update', { skipLocked: true });
        let requeued = 0;
        let toReview = 0;
        for (const row of expired) {
          const started = row.transportStartedAt !== null;
          await tx
            .update(outbox)
            .set({
              state: started ? 'needs_review' : 'queued',
              failureCode: started ? 'LEASE_EXPIRED_AFTER_TRANSPORT' : row.failureCode,
              leaseToken: null,
              leaseExpiresAt: null,
              updatedAt: now,
            })
            .where(eq(outbox.id, row.id));
          await touchMessages(tx, row.conversationId, [row.messageId], now);
          if (started) toReview += 1;
          else requeued += 1;
        }
        return { requeued, toReview };
      });
    },

    async nextDue(now = new Date()) {
      const [row] = await getDb()
        .select({ id: outbox.id })
        .from(outbox)
        .where(and(inArray(outbox.state, ['queued', 'retry_scheduled']), lte(outbox.nextAttemptAt, now)))
        // Two quick replies in one conversation leave in the order written.
        .orderBy(outbox.nextAttemptAt, outbox.createdAt, outbox.id)
        .limit(1);
      return row?.id || null;
    },

    async cancel(messageId, expectedRevision, now = new Date()) {
      return transitionByMessage(messageId, ['queued', 'retry_scheduled'], { state: 'cancelled' }, expectedRevision, now);
    },

    async resolveReview(messageId, resolution, expectedRevision, now = new Date()) {
      return transitionByMessage(
        messageId,
        ['needs_review'],
        {
          state: resolution === 'confirmed_sent' ? 'provider_accepted' : 'failed',
          resolution,
          ...(resolution === 'confirmed_not_sent' ? { failureCode: 'CONFIRMED_NOT_SENT' } : {}),
        },
        expectedRevision,
        now,
      );
    },

    async applyReceipts(providerMessageId) {
      return getDb().transaction(async (tx) => {
        const targets = await tx
          .select({ id: messages.id, conversationId: messages.conversationId })
          .from(messages)
          .where(
            and(
              eq(messages.providerMessageId, providerMessageId),
              eq(messages.direction, 'outbound'),
              isNull(messages.supersededBy),
            ),
          );
        if (targets.length === 0) return 0;
        const status = await receiptStatus(tx, providerMessageId);
        if (!status) return 0;
        let changed = 0;
        for (const target of targets) {
          // Same lock order as acceptance and ingestion: conversation first.
          await tx
            .select({ id: conversations.id })
            .from(conversations)
            .where(eq(conversations.id, target.conversationId))
            .for('update');
          const [current] = await tx
            .select({ deliveryStatus: messages.deliveryStatus, providerMessageId: messages.providerMessageId })
            .from(messages)
            .where(eq(messages.id, target.id));
          if (current?.providerMessageId !== providerMessageId) continue;
          const known = current.deliveryStatus as DeliveryStatus | null;
          // Receipts only move forward; a late or error receipt never regresses.
          if (known && (status === 'error' || DELIVERY_RANK[known] >= DELIVERY_RANK[status])) continue;
          await tx.update(messages).set({ deliveryStatus: status }).where(eq(messages.id, target.id));
          await touchMessages(tx, target.conversationId, [target.id], new Date());
          changed += 1;
        }
        // Receipts of attendance messages are consumed here; the quotation
        // correlation never matches them and must not count them as pending.
        await tx
          .update(evolutionReceiptInbox)
          .set({ appliedAt: new Date() })
          .where(and(eq(evolutionReceiptInbox.providerMessageId, providerMessageId), isNull(evolutionReceiptInbox.appliedAt)));
        return changed;
      });
    },
  };
}

