import { sql } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';

/**
 * A demand the operator can link a new proposal to. The list is exhaustive and
 * deterministic on purpose: it is the choice surface, never an implicit pick.
 * Equal client, phone or contact never produces a candidate by itself.
 */
export interface OpportunityChoice {
  opportunityId: string;
  clientId: string | null;
  demandSummary: string | null;
  status: string;
  updatedAt: string;
  proposalCount: number;
}

/** A proposal (quotation) already linked to a demand, with value and state. */
export interface OpportunityProposal {
  quotationId: string;
  businessNumber: string;
  status: string;
  total: string | null;
  createdAt: string;
}

export interface ProposalOpportunityRepository {
  listChoices(clientId: string): Promise<OpportunityChoice[]>;
  listProposals(opportunityId: string): Promise<OpportunityProposal[]>;
}

export function createPostgresProposalOpportunityRepository(
  getDb: () => AppDatabase = getDatabase,
): ProposalOpportunityRepository {
  return {
    listChoices: (clientId) => listOpenOpportunitiesForClient(getDb(), clientId),
    listProposals: (opportunityId) => listProposalsForOpportunity(getDb(), opportunityId),
  };
}

/** Commercial outcomes that close prospecting; they leave the choice surface. */
const CLOSED_OPPORTUNITY_STATUSES = ['Pedido Fechado', 'Perdido'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

interface ChoiceRow {
  opportunity_id: string;
  client_id: string | null;
  demand_summary: string | null;
  status: string;
  updated_at: Date | string;
  proposal_count: number | string;
}

/** Every open demand of a client, so the operator chooses explicitly. */
export async function listOpenOpportunitiesForClient(
  database: AppDatabase,
  clientId: string,
): Promise<OpportunityChoice[]> {
  if (!isUuid(clientId)) return [];
  const closed = [...CLOSED_OPPORTUNITY_STATUSES];
  const rows = (await database.execute(sql`
    SELECT
      d.id AS opportunity_id,
      d.client_id,
      d.demand_summary,
      d.status,
      d.updated_at,
      (SELECT count(*)::int FROM quotations q WHERE q.opportunity_id = d.id) AS proposal_count
    FROM crm_deals d
    WHERE d.client_id = ${clientId}::uuid
      AND d.status NOT IN (${sql.join(
        closed.map((status) => sql`${status}`),
        sql`, `,
      )})
    ORDER BY d.updated_at DESC, d.created_at DESC, d.id ASC
  `)) as unknown as ChoiceRow[];
  return rows.map((row) => ({
    opportunityId: row.opportunity_id,
    clientId: row.client_id,
    demandSummary: row.demand_summary,
    status: row.status,
    updatedAt: isoDate(row.updated_at),
    proposalCount: Number(row.proposal_count || 0),
  }));
}

interface ProposalRow {
  quotation_id: string;
  business_number: string;
  status: string;
  total: string | null;
  created_at: Date | string;
}

/** Every proposal linked to one demand, including value and state. */
export async function listProposalsForOpportunity(
  database: AppDatabase,
  opportunityId: string,
): Promise<OpportunityProposal[]> {
  if (!isUuid(opportunityId)) return [];
  const rows = (await database.execute(sql`
    SELECT
      q.id AS quotation_id,
      q.business_number,
      q.status,
      r.total,
      q.created_at
    FROM quotations q
    LEFT JOIN LATERAL (
      SELECT rv.total
      FROM quote_revisions rv
      WHERE rv.quotation_id = q.id
      ORDER BY rv.version DESC, rv.id ASC
      LIMIT 1
    ) r ON true
    WHERE q.opportunity_id = ${opportunityId}::uuid
    ORDER BY q.created_at ASC, q.id ASC
  `)) as unknown as ProposalRow[];
  return rows.map((row) => ({
    quotationId: row.quotation_id,
    businessNumber: row.business_number,
    status: row.status,
    total: row.total === null || row.total === undefined ? null : String(row.total),
    createdAt: isoDate(row.created_at),
  }));
}
