import { eq, sql } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { opportunityNextActions } from '../schema.js';
import type { OpportunityProposal } from './proposal-opportunity-repository.js';

export type OpportunityActionKind = 'first_contact';
export type OpportunityActionOrigin = 'manual' | 'automatic' | 'event';
export type OpportunityActionState = 'active' | 'completed' | 'cancelled' | 'superseded';

/** One prioritized item of the commercial queue: a demand and its pending work. */
export interface OpportunityQueueItem {
  actionId: string;
  opportunityId: string;
  kind: OpportunityActionKind;
  reasonCode: string;
  origin: OpportunityActionOrigin;
  state: OpportunityActionState;
  dueAt: string;
  demandSummary: string | null;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  clientId: string | null;
  clientName: string | null;
  /** Every proposal linked to the demand, with value and state. */
  proposals: OpportunityProposal[];
}

export interface OpportunityQueuePage {
  data: OpportunityQueueItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OpportunityQueueListOptions {
  page?: number;
  pageSize?: number;
}

export interface OpportunityActionRepository {
  listActive(options?: OpportunityQueueListOptions): Promise<OpportunityQueuePage>;
}

export class OpportunityActionInputError extends Error {
  readonly statusCode = 400;
  readonly logMessage: string;
  constructor(message = 'Paginação inválida da fila comercial.') {
    super(message);
    this.name = 'OpportunityActionInputError';
    this.logMessage = message;
  }
}

export class OpportunityActionRepositoryError extends Error {
  readonly statusCode = 503;
  readonly logMessage = 'Não foi possível acessar a fila comercial.';
  constructor() {
    super('Não foi possível acessar a fila comercial.');
    this.name = 'OpportunityActionRepositoryError';
  }
}

type DatabaseProvider = () => AppDatabase;
/** Open transaction that shares the same Drizzle query surface as the pool. */
export type OpportunityActionDatabase = Pick<AppDatabase, 'select' | 'insert'>;

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Commercial outcomes that close prospecting. A closed opportunity has no
 * pending first contact, so its active action stays out of the queue.
 * Closing the opportunity and its action is #252; this only prevents stale
 * first-contact work from staying visible in the meantime.
 */
const CLOSED_OPPORTUNITY_STATUSES = ['Pedido Fechado', 'Perdido'] as const;

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) throw new OpportunityActionInputError();
  return Math.min(Math.floor(parsed), maximum);
}

function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

interface QueueRow {
  total: number;
  page: number;
  action_id: string;
  opportunity_id: string;
  kind: string;
  reason_code: string;
  origin: string;
  state: string;
  due_at: Date | string;
  demand_summary: string | null;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  client_id: string | null;
  client_name: string | null;
  proposals: unknown;
}

interface ProposalJsonRow {
  quotation_id?: unknown;
  business_number?: unknown;
  status?: unknown;
  total?: unknown;
  created_at?: unknown;
}

function parseProposals(value: unknown): OpportunityProposal[] {
  if (!Array.isArray(value)) return [];
  const proposals: OpportunityProposal[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as ProposalJsonRow;
    if (typeof row.quotation_id !== 'string' || typeof row.business_number !== 'string') continue;
    const createdAt = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
    proposals.push({
      quotationId: row.quotation_id,
      businessNumber: row.business_number,
      status: typeof row.status === 'string' ? row.status : 'rascunho',
      total: row.total === null || row.total === undefined ? null : String(row.total),
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date(0).toISOString() : createdAt.toISOString(),
    });
  }
  return proposals;
}

/**
 * Guarantees the first-contact action of an opportunity exists exactly once.
 * The first action ever created for a demand is the admission work; later
 * actions belong to the follow-up cycle (#242) and are not seeded here.
 */
export async function ensureFirstContactAction(
  database: OpportunityActionDatabase,
  input: { opportunityId: string; dueAt: Date; idFactory: () => string }
): Promise<void> {
  const [existing] = await database
    .select({ id: opportunityNextActions.id })
    .from(opportunityNextActions)
    .where(eq(opportunityNextActions.opportunityId, input.opportunityId))
    .limit(1);
  if (existing) return;

  await database
    .insert(opportunityNextActions)
    .values({
      id: input.idFactory(),
      opportunityId: input.opportunityId,
      kind: 'first_contact',
      reasonCode: 'new_lead',
      origin: 'automatic',
      state: 'active',
      dueAt: input.dueAt,
      createdAt: input.dueAt,
      updatedAt: input.dueAt,
    })
    .onConflictDoNothing();
}

/** Read model for the commercial queue of opportunity next actions. */
export function createPostgresOpportunityActionRepository(
  getDb: DatabaseProvider = getDatabase
): OpportunityActionRepository {
  return {
    async listActive(options: OpportunityQueueListOptions = {}): Promise<OpportunityQueuePage> {
      const page = positiveInteger(options.page, 1, Number.MAX_SAFE_INTEGER);
      const pageSize = positiveInteger(options.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const closedStatuses = [...CLOSED_OPPORTUNITY_STATUSES];

      try {
        const database = getDb();
        // One statement returns the consistent snapshot (total + clamped page)
        // and the page rows together. When a close or removal shrinks the queue
        // below the requested page, `page` is clamped to the last valid one, so
        // the caller reloads real remaining work instead of an empty page.
        const rows = (await database.execute(sql`
          WITH filtered AS (
            SELECT
              a.id AS action_id,
              a.opportunity_id,
              a.kind,
              a.reason_code,
              a.origin,
              a.state,
              a.due_at,
              a.created_at,
              d.demand_summary,
              d.nome AS contact_name,
              d.telefone AS contact_phone,
              d.email AS contact_email,
              d.client_id,
              c.nome AS client_name,
              (
                SELECT coalesce(
                  json_agg(
                    json_build_object(
                      'quotation_id', q.id,
                      'business_number', q.business_number,
                      'status', q.status,
                      'total', r.total,
                      'created_at', q.created_at
                    ) ORDER BY q.created_at, q.id
                  ),
                  '[]'::json
                )
                FROM quotations q
                LEFT JOIN LATERAL (
                  SELECT rv.total
                  FROM quote_revisions rv
                  WHERE rv.quotation_id = q.id
                  ORDER BY rv.version DESC, rv.id ASC
                  LIMIT 1
                ) r ON true
                WHERE q.opportunity_id = d.id
              ) AS proposals
            FROM opportunity_next_actions a
            INNER JOIN crm_deals d ON d.id = a.opportunity_id
            LEFT JOIN clients c ON c.id = d.client_id
            WHERE a.state = 'active'
              AND d.status NOT IN (${sql.join(
                closedStatuses.map((status) => sql`${status}`),
                sql`, `
              )})
          ),
          bounds AS (SELECT count(*)::int AS total FROM filtered),
          position AS (
            SELECT
              total,
              GREATEST(1, LEAST(${page}::int, CEIL(total::numeric / ${pageSize}::int)::int)) AS page
            FROM bounds
          )
          SELECT position.total, position.page, page_rows.*
          FROM position
          LEFT JOIN LATERAL (
            SELECT * FROM filtered
            ORDER BY due_at ASC, created_at ASC, action_id ASC
            LIMIT ${pageSize} OFFSET (position.page - 1) * ${pageSize}
          ) AS page_rows ON true
        `)) as unknown as QueueRow[];

        // The statement always emits exactly one anchor row (from `position`),
        // even for an empty page, so the totals are never lost.
        const [first] = rows;
        if (!first) {
          return { data: [], total: 0, page: 1, pageSize };
        }
        return {
          data: rows
            .filter((row) => row.action_id)
            .map((row) => ({
              actionId: row.action_id,
              opportunityId: row.opportunity_id,
              kind: row.kind as OpportunityActionKind,
              reasonCode: row.reason_code,
              origin: row.origin as OpportunityActionOrigin,
              state: row.state as OpportunityActionState,
              dueAt: isoDate(row.due_at),
              demandSummary: row.demand_summary,
              contactName: row.contact_name,
              contactPhone: row.contact_phone,
              contactEmail: row.contact_email,
              clientId: row.client_id,
              clientName: row.client_name,
              proposals: parseProposals(row.proposals),
            })),
          total: Number(first.total ?? 0),
          page: Number(first.page ?? 1),
          pageSize,
        };
      } catch (error) {
        if (error instanceof OpportunityActionInputError) throw error;
        throw new OpportunityActionRepositoryError();
      }
    },
  };
}
