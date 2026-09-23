import { and, asc, count, eq, max, sql, sum } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { whatsappBackfillProgress } from '../schema.js';

type DatabaseProvider = () => AppDatabase;

export type BackfillState = 'pending' | 'done' | 'gap';

export interface BackfillProgressRecord {
  providerConversationId: string;
  state: BackfillState;
  nextPage: number;
}

export interface BackfillSummary {
  conversations: number;
  pending: number;
  done: number;
  gaps: number;
  messagesSeen: number;
  messagesInserted: number;
  lastRunAt: Date | null;
}

export interface WhatsappBackfillRepository {
  hasConversations(instance: string): Promise<boolean>;
  /** Adds newly discovered conversations; existing progress is kept. */
  discover(instance: string, providerConversationIds: string[]): Promise<number>;
  nextPending(instance: string): Promise<BackfillProgressRecord | null>;
  advance(input: {
    instance: string;
    providerConversationId: string;
    state: BackfillState;
    nextPage: number;
    pagesTotal: number | null;
    seen: number;
    inserted: number;
    gapReason: string | null;
    at: Date;
  }): Promise<void>;
  summary(instance: string): Promise<BackfillSummary>;
}

const progress = whatsappBackfillProgress;

// Concurrent runs are harmless: ingestion deduplicates by provider message id
// and a repeated page only rewrites the same progress, so no lease is needed.
export function createPostgresWhatsappBackfillRepository(
  getDb: DatabaseProvider = getDatabase,
): WhatsappBackfillRepository {
  return {
    async hasConversations(instance) {
      const [row] = await getDb()
        .select({ total: count() })
        .from(progress)
        .where(eq(progress.instance, instance));
      return Number(row?.total || 0) > 0;
    },

    async discover(instance, providerConversationIds) {
      const unique = [...new Set(providerConversationIds)];
      if (unique.length === 0) return 0;
      const inserted = await getDb()
        .insert(progress)
        .values(unique.map((providerConversationId) => ({ instance, providerConversationId })))
        .onConflictDoNothing({ target: [progress.instance, progress.providerConversationId] })
        .returning({ id: progress.providerConversationId });
      return inserted.length;
    },

    async nextPending(instance) {
      const [row] = await getDb()
        .select({
          providerConversationId: progress.providerConversationId,
          state: progress.state,
          nextPage: progress.nextPage,
        })
        .from(progress)
        .where(and(eq(progress.instance, instance), eq(progress.state, 'pending')))
        .orderBy(asc(progress.providerConversationId))
        .limit(1);
      return row ? { ...row, state: row.state as BackfillState } : null;
    },

    async advance(input) {
      await getDb()
        .update(progress)
        .set({
          state: input.state,
          nextPage: input.nextPage,
          pagesTotal: input.pagesTotal,
          messagesSeen: sql`${progress.messagesSeen} + ${input.seen}`,
          messagesInserted: sql`${progress.messagesInserted} + ${input.inserted}`,
          gapReason: input.gapReason,
          lastRunAt: input.at,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(progress.instance, input.instance),
            eq(progress.providerConversationId, input.providerConversationId),
          ),
        );
    },

    async summary(instance) {
      const [row] = await getDb()
        .select({
          conversations: count(),
          pending: sql<number>`count(*) FILTER (WHERE ${progress.state} = 'pending')::int`,
          done: sql<number>`count(*) FILTER (WHERE ${progress.state} = 'done')::int`,
          gaps: sql<number>`count(*) FILTER (WHERE ${progress.state} = 'gap')::int`,
          messagesSeen: sum(progress.messagesSeen),
          messagesInserted: sum(progress.messagesInserted),
          lastRunAt: max(progress.lastRunAt),
        })
        .from(progress)
        .where(eq(progress.instance, instance));
      return {
        conversations: Number(row?.conversations || 0),
        pending: Number(row?.pending || 0),
        done: Number(row?.done || 0),
        gaps: Number(row?.gaps || 0),
        messagesSeen: Number(row?.messagesSeen || 0),
        messagesInserted: Number(row?.messagesInserted || 0),
        lastRunAt: row?.lastRunAt ?? null,
      };
    },
  };
}
