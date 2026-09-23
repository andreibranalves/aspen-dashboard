// Resumable backfill of the attendance history from the Evolution instance
// (decision D3: history before activation comes only from the provider).
// Messages are stored with origin `backfill`: no unread, no reopening and no
// activity/follow-up effects. Missing history is declared as a gap.

import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { getEvolutionConfig } from '../_infrastructure/integrations/evolution/config.js';
import {
  createPostgresWhatsappBackfillRepository,
  type BackfillSummary,
  type WhatsappBackfillRepository,
} from '../_infrastructure/db/repositories/whatsapp-backfill-repository.js';
import type { WhatsappAttendanceRepository } from '../_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import { isMachineBearerAuthorized } from '../_shared/machine-auth.js';
import {
  fetchEvolutionChats,
  fetchEvolutionMessagePage,
  type EvolutionMessagePage,
} from './evolution-history.js';
import { ingestWhatsappUpserts, type WhatsappUpsertIngestionItem } from './whatsapp-attendance-ingestion.js';

export const BACKFILL_PAGE_SIZE = 100;
// Each call fits the 60 s function limit: no new page starts unless one full
// provider timeout (15 s) still fits before the run budget ends.
const RUN_BUDGET_MS = 45_000;
const PROVIDER_ALLOWANCE_MS = 16_000;

const INDIVIDUAL_JID = /^[^@\s]+@(?:s\.whatsapp\.net|c\.us|lid)$/i;

export interface WhatsappBackfillDependencies {
  repository?: WhatsappBackfillRepository;
  attendanceRepository?: Pick<WhatsappAttendanceRepository, 'ingestConversation'>;
  fetchChats?: () => Promise<Array<Record<string, unknown>>>;
  fetchMessagePage?: (remoteJid: string, page: number, pageSize: number) => Promise<EvolutionMessagePage>;
  instance?: () => string;
  clock?: () => number;
  environment?: { CRON_SECRET?: string };
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function chatJid(chat: Record<string, unknown>): string {
  return text(chat.remoteJid) || text(chat.id) || text(chat.jid);
}

function providerTimestamp(value: unknown): Date | null {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number === 'number' && Number.isFinite(number) && number > 0) {
    const parsed = new Date(number < 1e12 ? number * 1000 : number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Reads one provider history record. The WhatsApp message id lives in `key.id`
 * (a record's own `id` is the provider database row); records without a real
 * id or timestamp are skipped rather than stored with invented values.
 */
export function readBackfillItem(item: Record<string, unknown>, fallbackJid: string): WhatsappUpsertIngestionItem | null {
  const key = record(item.key) || {};
  const providerMessageId = text(key.id) || text(item.keyId);
  const fromMe = typeof key.fromMe === 'boolean' ? key.fromMe : typeof item.fromMe === 'boolean' ? item.fromMe : null;
  const occurredAt = providerTimestamp(item.messageTimestamp);
  const remoteJid = text(key.remoteJid) || fallbackJid;
  if (!providerMessageId || fromMe === null || !occurredAt || !INDIVIDUAL_JID.test(remoteJid)) return null;
  return { item, providerMessageId, remoteJid, fromMe, occurredAt };
}

export interface BackfillRunResult {
  discovered: number;
  pages: number;
  messagesInserted: number;
  skipped: number;
  providerUnavailable: boolean;
  summary: BackfillSummary;
}

export async function runWhatsappBackfill(
  input: { discover: boolean },
  dependencies: WhatsappBackfillDependencies = {},
): Promise<BackfillRunResult> {
  const repository = dependencies.repository || createPostgresWhatsappBackfillRepository();
  const fetchChats = dependencies.fetchChats || (() => fetchEvolutionChats());
  const fetchPage = dependencies.fetchMessagePage || ((jid, page, size) => fetchEvolutionMessagePage(jid, page, size));
  const clock = dependencies.clock || Date.now;
  const instance = (dependencies.instance || (() => getEvolutionConfig().instance))().trim();
  if (!instance) throw new Error('evolution instance not configured');
  const deadline = clock() + RUN_BUDGET_MS;

  let discovered = 0;
  let pages = 0;
  let messagesInserted = 0;
  let skipped = 0;
  let providerUnavailable = false;

  try {
    if (input.discover || !(await repository.hasConversations(instance))) {
      const jids = (await fetchChats()).map(chatJid).filter((jid) => INDIVIDUAL_JID.test(jid));
      discovered = await repository.discover(instance, jids);
    }

    while (clock() + PROVIDER_ALLOWANCE_MS <= deadline) {
      const next = await repository.nextPending(instance);
      if (!next) break;
      const page = await fetchPage(next.providerConversationId, next.nextPage, BACKFILL_PAGE_SIZE);
      const items: WhatsappUpsertIngestionItem[] = [];
      for (const raw of page.records) {
        const item = readBackfillItem(raw, next.providerConversationId);
        if (item) items.push(item);
        else skipped += 1;
      }
      const { inserted } = await ingestWhatsappUpserts({
        instance,
        origin: 'backfill',
        items,
        repository: dependencies.attendanceRepository,
      });

      const lastPage =
        page.records.length === 0 ||
        (page.pages !== null ? next.nextPage >= page.pages : page.records.length < BACKFILL_PAGE_SIZE);
      // A full page without pagination metadata cannot be continued safely.
      const gapReason = page.pages === null && page.records.length >= BACKFILL_PAGE_SIZE ? 'pagination_unavailable' : null;
      await repository.advance({
        instance,
        providerConversationId: next.providerConversationId,
        state: gapReason ? 'gap' : lastPage ? 'done' : 'pending',
        nextPage: lastPage || gapReason ? next.nextPage : next.nextPage + 1,
        pagesTotal: page.pages,
        seen: page.records.length,
        inserted,
        gapReason,
        at: new Date(clock()),
      });
      pages += 1;
      messagesInserted += inserted;
    }
  } catch (error) {
    // Provider failures stop this run; progress already recorded is kept and
    // the next call resumes from the same page.
    if (error && typeof error === 'object' && 'statusCode' in error) providerUnavailable = true;
    else throw error;
  }

  return {
    discovered,
    pages,
    messagesInserted,
    skipped,
    providerUnavailable,
    summary: await repository.summary(instance),
  };
}

function projectSummary(summary: BackfillSummary) {
  return {
    conversations: summary.conversations,
    pending: summary.pending,
    done: summary.done,
    gaps: summary.gaps,
    messagesSeen: summary.messagesSeen,
    messagesInserted: summary.messagesInserted,
    lastRunAt: summary.lastRunAt?.toISOString() ?? null,
  };
}

export async function handler(
  event: FunctionEvent,
  dependencies: WhatsappBackfillDependencies = {},
): Promise<FunctionResult> {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method !== 'GET' && method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const environment = dependencies.environment || process.env;
  if (!isMachineBearerAuthorized(event.headers, environment.CRON_SECRET)) {
    return json(401, { error: 'Não autorizado.' });
  }
  const instance = (dependencies.instance || (() => getEvolutionConfig().instance))().trim();
  if (!instance) return json(503, { error: 'Integração WhatsApp não configurada.' });

  try {
    if (method === 'GET') {
      const repository = dependencies.repository || createPostgresWhatsappBackfillRepository();
      return json(200, { summary: projectSummary(await repository.summary(instance)) });
    }
    let discover = false;
    if (event.body) {
      try {
        discover = JSON.parse(event.body)?.discover === true;
      } catch {
        return json(400, { error: 'Corpo da requisição inválido.' });
      }
    }
    const result = await runWhatsappBackfill({ discover }, { ...dependencies, instance: () => instance });
    return json(result.providerUnavailable ? 502 : 200, {
      discovered: result.discovered,
      pages: result.pages,
      messagesInserted: result.messagesInserted,
      skipped: result.skipped,
      ...(result.providerUnavailable
        ? { error: 'A Evolution não respondeu. O progresso foi mantido; tente novamente.' }
        : {}),
      summary: projectSummary(result.summary),
    });
  } catch (error) {
    console.error('[whatsapp-backfill]', error instanceof Error ? error.name : typeof error);
    return json(503, { error: 'Não foi possível executar o backfill. Tente novamente.' });
  }
}

export const whatsappBackfill = handler;
