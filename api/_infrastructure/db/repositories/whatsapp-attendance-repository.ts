import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { whatsappConversations, whatsappMessageOutbox, whatsappMessages } from '../schema.js';
import type { WhatsappMessageType } from '../../../_modules/whatsapp-message-content.js';

type DatabaseProvider = () => AppDatabase;

export type WhatsappConversationStatus = 'open' | 'waiting_customer' | 'closed' | 'ignored';
export type WhatsappMessageOrigin = 'live' | 'backfill' | 'operator' | 'quotation';
export type WhatsappIdentityStatus = 'verified' | 'derived' | 'unresolved' | 'conflict';

export const WHATSAPP_CONVERSATION_STATUSES: readonly WhatsappConversationStatus[] = [
  'open',
  'waiting_customer',
  'closed',
  'ignored',
];

export interface WhatsappTransportIdentity {
  canonicalPhone: string;
  identityStatus: WhatsappIdentityStatus;
  identitySource: string | null;
  identityConfidence: 'high' | 'medium' | 'low' | null;
}

export interface IngestWhatsappMessage {
  providerMessageId: string;
  direction: 'inbound' | 'outbound';
  messageType: WhatsappMessageType;
  body: string | null;
  preview: string;
  providerTimestamp: Date;
}

export interface IngestWhatsappConversationInput {
  instance: string;
  providerConversationId: string;
  origin: 'live' | 'backfill';
  /** Contact-provided name, only from inbound messages. */
  contactName: string | null;
  /** Resolves transport identity against the stored state, inside the lock. */
  resolveIdentity: (stored: WhatsappTransportIdentity | null) => WhatsappTransportIdentity;
  messages: IngestWhatsappMessage[];
}

export interface IngestWhatsappConversationResult {
  conversationId: string;
  inserted: number;
  duplicates: number;
}

export interface WhatsappConversationRecord {
  id: string;
  canonicalPhone: string | null;
  identityStatus: WhatsappIdentityStatus;
  identityVersion: number;
  displayName: string | null;
  status: WhatsappConversationStatus;
  revision: number;
  readRevision: number;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
}

export interface WhatsappMessageRecord {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  messageType: WhatsappMessageType;
  body: string | null;
  origin: WhatsappMessageOrigin;
  providerTimestamp: Date;
  createdRevision: number;
  revision: number;
  /** Provider receipts for outbound messages. */
  deliveryStatus: 'server_ack' | 'delivered' | 'read' | 'error' | null;
  /** Operator reply lifecycle; null for messages that did not come from the outbox. */
  outboxState: string | null;
  failureCode: string | null;
  /** Operator finding on an uncertain send; not a provider fact. */
  resolution: string | null;
  /** Set on an echo merged into an operator reply; clients drop it. */
  supersededBy: string | null;
}

/** Technical scope of a conversation. Backend only; never projected to clients. */
export interface WhatsappConversationScope {
  instance: string;
  providerConversationId: string;
  canonicalPhone: string | null;
  identityStatus: WhatsappIdentityStatus;
  identityVersion: number;
}

export interface TimelineCursor {
  at: Date;
  id: string;
}

export interface ListConversationsInput {
  instance: string;
  status?: WhatsappConversationStatus | 'active';
  search?: string;
  limit: number;
  cursor?: TimelineCursor | null;
}

export interface ListMessagesPage {
  items: WhatsappMessageRecord[];
  hasMore: boolean;
}

export class WhatsappConversationChangedError extends Error {
  constructor(readonly current: WhatsappConversationRecord) {
    super('conversation changed');
    this.name = 'WhatsappConversationChangedError';
  }
}

export interface WhatsappAttendanceRepository {
  /**
   * Changes the attendance status only if nothing changed since the operator
   * saw `expectedRevision`; returns null when the conversation does not exist.
   */
  updateStatus(input: {
    id: string;
    status: WhatsappConversationStatus;
    expectedRevision: number;
  }): Promise<WhatsappConversationRecord | null>;
  /** Moves the read cursor forward only; unread is recounted from messages. */
  markRead(input: { id: string; readRevision: number }): Promise<WhatsappConversationRecord | null>;
  ingestConversation(input: IngestWhatsappConversationInput): Promise<IngestWhatsappConversationResult>;
  listConversations(input: ListConversationsInput): Promise<{ items: WhatsappConversationRecord[]; hasMore: boolean }>;
  getConversation(id: string): Promise<WhatsappConversationRecord | null>;
  getConversationScope(id: string): Promise<WhatsappConversationScope | null>;
  /** Newest page first in the query, returned in chronological order. */
  listMessagesBefore(input: {
    conversationId: string;
    before?: TimelineCursor | null;
    limit: number;
  }): Promise<ListMessagesPage>;
  /** Changes committed after `afterRevision`, in revision order. */
  listMessagesAfterRevision(input: {
    conversationId: string;
    afterRevision: number;
    limit: number;
  }): Promise<ListMessagesPage>;
}

const conversations = whatsappConversations;
const messages = whatsappMessages;

const conversationColumns = {
  id: conversations.id,
  canonicalPhone: conversations.canonicalPhone,
  identityStatus: conversations.identityStatus,
  identityVersion: conversations.identityVersion,
  displayName: conversations.displayName,
  status: conversations.status,
  revision: conversations.revision,
  readRevision: conversations.readRevision,
  unreadCount: conversations.unreadCount,
  lastMessageAt: conversations.lastMessageAt,
  lastMessagePreview: conversations.lastMessagePreview,
  lastMessageDirection: conversations.lastMessageDirection,
};

const messageColumns = {
  id: messages.id,
  conversationId: messages.conversationId,
  direction: messages.direction,
  messageType: messages.messageType,
  body: messages.body,
  origin: messages.origin,
  providerTimestamp: messages.providerTimestamp,
  createdRevision: messages.createdRevision,
  revision: messages.revision,
  deliveryStatus: messages.deliveryStatus,
  supersededBy: messages.supersededBy,
  outboxState: whatsappMessageOutbox.state,
  failureCode: whatsappMessageOutbox.failureCode,
  resolution: whatsappMessageOutbox.resolution,
};

function toConversation(row: Record<string, unknown>): WhatsappConversationRecord {
  return {
    id: String(row.id),
    canonicalPhone: (row.canonicalPhone as string | null) || null,
    identityStatus: row.identityStatus as WhatsappIdentityStatus,
    identityVersion: Number(row.identityVersion),
    displayName: (row.displayName as string | null) || null,
    status: row.status as WhatsappConversationStatus,
    revision: Number(row.revision),
    readRevision: Number(row.readRevision),
    unreadCount: Number(row.unreadCount),
    lastMessageAt: (row.lastMessageAt as Date | null) || null,
    lastMessagePreview: (row.lastMessagePreview as string | null) || null,
    lastMessageDirection: (row.lastMessageDirection as 'inbound' | 'outbound' | null) || null,
  };
}

function toMessage(row: Record<string, unknown>): WhatsappMessageRecord {
  return {
    id: String(row.id),
    conversationId: String(row.conversationId),
    direction: row.direction as 'inbound' | 'outbound',
    messageType: row.messageType as WhatsappMessageType,
    body: (row.body as string | null) ?? null,
    origin: row.origin as WhatsappMessageOrigin,
    providerTimestamp: row.providerTimestamp as Date,
    createdRevision: Number(row.createdRevision),
    revision: Number(row.revision),
    deliveryStatus: (row.deliveryStatus as WhatsappMessageRecord['deliveryStatus']) ?? null,
    outboxState: (row.outboxState as string | null) ?? null,
    failureCode: (row.failureCode as string | null) ?? null,
    resolution: (row.resolution as string | null) ?? null,
    supersededBy: (row.supersededBy as string | null) ?? null,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function identityChanged(
  stored: WhatsappTransportIdentity,
  next: WhatsappTransportIdentity,
): boolean {
  return (
    (stored.canonicalPhone || '') !== (next.canonicalPhone || '') ||
    stored.identityStatus !== next.identityStatus
  );
}

export function createPostgresWhatsappAttendanceRepository(
  getDb: DatabaseProvider = getDatabase,
): WhatsappAttendanceRepository {
  return {
    async ingestConversation(input) {
      const instance = input.instance.trim();
      const providerConversationId = input.providerConversationId.trim();
      if (!instance || !providerConversationId) throw new Error('conversation scope is required');
      if (input.messages.length === 0) throw new Error('at least one message is required');

      return getDb().transaction(async (tx) => {
        const now = new Date();
        const created = await tx
          .insert(conversations)
          .values({
            id: randomUUID(),
            instance,
            providerConversationId,
            identityStatus: 'unresolved',
            // A conversation first seen through the backfill is history, not a
            // new attendance: it must not appear as open work.
            status: input.origin === 'backfill' ? 'closed' : 'open',
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [conversations.instance, conversations.providerConversationId],
          })
          .returning({ id: conversations.id });
        const isNew = created.length > 0;

        // The row lock serializes every writer of this conversation, so revision
        // numbers are committed in order and incremental readers never skip one.
        const [current] = await tx
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.instance, instance),
              eq(conversations.providerConversationId, providerConversationId),
            ),
          )
          .for('update');
        if (!current) throw new Error('conversation row missing after upsert');

        const stored: WhatsappTransportIdentity | null = isNew
          ? null
          : {
              canonicalPhone: current.canonicalPhone || '',
              identityStatus: current.identityStatus as WhatsappIdentityStatus,
              identitySource: current.identitySource,
              identityConfidence: current.identityConfidence as WhatsappTransportIdentity['identityConfidence'],
            };
        const identity = input.resolveIdentity(stored);
        const identityVersion =
          stored && identityChanged(stored, identity) ? current.identityVersion + 1 : current.identityVersion;

        let revision = Number(current.revision);
        let inserted = 0;
        let liveInbound = 0;
        let latest: IngestWhatsappMessage | null = null;
        for (const message of input.messages) {
          const nextRevision = revision + 1;
          const rows = await tx
            .insert(messages)
            .values({
              id: randomUUID(),
              conversationId: current.id,
              providerMessageId: message.providerMessageId,
              direction: message.direction,
              messageType: message.messageType,
              body: message.body,
              origin: input.origin,
              providerTimestamp: message.providerTimestamp,
              ingestedAt: now,
              createdRevision: nextRevision,
              revision: nextRevision,
            })
            .onConflictDoNothing({ target: [messages.conversationId, messages.providerMessageId] })
            .returning({ id: messages.id });
          if (rows.length === 0) continue;
          revision = nextRevision;
          inserted += 1;
          if (input.origin === 'live' && message.direction === 'inbound') liveInbound += 1;
          if (!latest || message.providerTimestamp.getTime() > latest.providerTimestamp.getTime()) {
            latest = message;
          }
        }

        const summaryIsNewer =
          latest &&
          (!current.lastMessageAt || latest.providerTimestamp.getTime() >= current.lastMessageAt.getTime());
        // Only a new live inbound message reopens the attendance; `ignored`
        // stays ignored until the operator acts.
        const reopen =
          liveInbound > 0 && (current.status === 'waiting_customer' || current.status === 'closed');

        await tx
          .update(conversations)
          .set({
            canonicalPhone: identity.canonicalPhone || null,
            identityStatus: identity.identityStatus,
            identitySource: identity.identitySource,
            identityConfidence: identity.identityConfidence,
            identityVersion,
            ...(input.contactName ? { displayName: input.contactName.slice(0, 255) } : {}),
            revision,
            unreadCount: current.unreadCount + liveInbound,
            ...(reopen ? { status: 'open' } : {}),
            ...(summaryIsNewer && latest
              ? {
                  lastMessageAt: latest.providerTimestamp,
                  lastMessagePreview: latest.preview.slice(0, 280) || null,
                  lastMessageDirection: latest.direction,
                }
              : {}),
            updatedAt: now,
          })
          .where(eq(conversations.id, current.id));

        return {
          conversationId: current.id,
          inserted,
          duplicates: input.messages.length - inserted,
        };
      });
    },

    async updateStatus(input) {
      return getDb().transaction(async (tx) => {
        const [current] = await tx
          .select(conversationColumns)
          .from(conversations)
          .where(eq(conversations.id, input.id))
          .for('update');
        if (!current) return null;
        const record = toConversation(current);
        if (record.revision !== input.expectedRevision) throw new WhatsappConversationChangedError(record);
        if (record.status === input.status) return record;
        const [updated] = await tx
          .update(conversations)
          .set({ status: input.status, revision: record.revision + 1, updatedAt: new Date() })
          .where(eq(conversations.id, input.id))
          .returning(conversationColumns);
        return toConversation(updated);
      });
    },

    async markRead(input) {
      return getDb().transaction(async (tx) => {
        const [current] = await tx
          .select(conversationColumns)
          .from(conversations)
          .where(eq(conversations.id, input.id))
          .for('update');
        if (!current) return null;
        const record = toConversation(current);
        const readRevision = Math.max(record.readRevision, Math.min(input.readRevision, record.revision));
        if (readRevision === record.readRevision) return record;
        const [{ unread }] = await tx
          .select({ unread: sql<number>`count(*)::int` })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, input.id),
              eq(messages.direction, 'inbound'),
              eq(messages.origin, 'live'),
              gt(messages.createdRevision, readRevision),
            ),
          );
        const [updated] = await tx
          .update(conversations)
          .set({ readRevision, unreadCount: Number(unread), updatedAt: new Date() })
          .where(eq(conversations.id, input.id))
          .returning(conversationColumns);
        return toConversation(updated);
      });
    },

    async listConversations(input) {
      const filters: SQL[] = [eq(conversations.instance, input.instance)];
      if (input.status === 'active') {
        filters.push(inArray(conversations.status, ['open', 'waiting_customer', 'closed']));
      } else if (input.status) {
        filters.push(eq(conversations.status, input.status));
      }
      const search = input.search?.trim();
      if (search) {
        const digits = search.replace(/\D/g, '');
        const byName = ilike(conversations.displayName, `%${escapeLike(search)}%`);
        filters.push(
          digits.length >= 4
            ? (or(byName, sql`${conversations.canonicalPhone} LIKE ${`%${digits}%`}`) as SQL)
            : byName,
        );
      }
      if (input.cursor) {
        filters.push(
          or(
            lt(conversations.lastMessageAt, input.cursor.at),
            and(eq(conversations.lastMessageAt, input.cursor.at), lt(conversations.id, input.cursor.id)),
          ) as SQL,
        );
      }
      const rows = await getDb()
        .select(conversationColumns)
        .from(conversations)
        .where(and(...filters))
        .orderBy(sql`${conversations.lastMessageAt} DESC NULLS LAST`, desc(conversations.id))
        .limit(input.limit + 1);
      return {
        items: rows.slice(0, input.limit).map(toConversation),
        hasMore: rows.length > input.limit,
      };
    },

    async getConversation(id) {
      const [row] = await getDb()
        .select(conversationColumns)
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1);
      return row ? toConversation(row) : null;
    },

    async getConversationScope(id) {
      const [row] = await getDb()
        .select({
          instance: conversations.instance,
          providerConversationId: conversations.providerConversationId,
          canonicalPhone: conversations.canonicalPhone,
          identityStatus: conversations.identityStatus,
          identityVersion: conversations.identityVersion,
        })
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1);
      return row
        ? {
            instance: row.instance,
            providerConversationId: row.providerConversationId,
            canonicalPhone: row.canonicalPhone || null,
            identityStatus: row.identityStatus as WhatsappIdentityStatus,
            identityVersion: Number(row.identityVersion),
          }
        : null;
    },

    async listMessagesBefore(input) {
      const filters: SQL[] = [eq(messages.conversationId, input.conversationId), isNull(messages.supersededBy)];
      if (input.before) {
        filters.push(
          or(
            lt(messages.providerTimestamp, input.before.at),
            and(eq(messages.providerTimestamp, input.before.at), lt(messages.id, input.before.id)),
          ) as SQL,
        );
      }
      const rows = await getDb()
        .select(messageColumns)
        .from(messages)
        .leftJoin(whatsappMessageOutbox, eq(whatsappMessageOutbox.messageId, messages.id))
        .where(and(...filters))
        .orderBy(desc(messages.providerTimestamp), desc(messages.id))
        .limit(input.limit + 1);
      return {
        items: rows.slice(0, input.limit).map(toMessage).reverse(),
        hasMore: rows.length > input.limit,
      };
    },

    async listMessagesAfterRevision(input) {
      const rows = await getDb()
        .select(messageColumns)
        .from(messages)
        .leftJoin(whatsappMessageOutbox, eq(whatsappMessageOutbox.messageId, messages.id))
        .where(
          and(eq(messages.conversationId, input.conversationId), gt(messages.revision, input.afterRevision)),
        )
        .orderBy(asc(messages.revision))
        .limit(input.limit + 1);
      return {
        items: rows.slice(0, input.limit).map(toMessage),
        hasMore: rows.length > input.limit,
      };
    },
  };
}
