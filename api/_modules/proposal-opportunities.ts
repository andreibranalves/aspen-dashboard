// GET /api/proposal-opportunities?client_id=...  → demands available to start a proposal
// GET /api/proposal-opportunities?opportunity_id=... → every proposal of one demand
// Read-only contract. It never picks a demand by recency and never writes.
import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresProposalOpportunityRepository,
  type OpportunityChoice,
  type OpportunityProposal,
  type ProposalOpportunityRepository,
} from '../_infrastructure/db/repositories/proposal-opportunity-repository.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type { ProposalOpportunityRepository } from '../_infrastructure/db/repositories/proposal-opportunity-repository.js';

export interface ProposalOpportunitiesHandlerDependencies {
  repository?: ProposalOpportunityRepository;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function publicChoice(choice: OpportunityChoice): Record<string, unknown> {
  return {
    opportunity_id: choice.opportunityId,
    client_id: choice.clientId,
    demand_summary: choice.demandSummary,
    status: choice.status,
    updated_at: choice.updatedAt,
    proposal_count: choice.proposalCount,
  };
}

function publicProposal(proposal: OpportunityProposal): Record<string, unknown> {
  return {
    quotation_id: proposal.quotationId,
    business_number: proposal.businessNumber,
    status: proposal.status,
    total: proposal.total,
    created_at: proposal.createdAt,
  };
}

export function createProposalOpportunitiesHandler(
  dependencies: ProposalOpportunitiesHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresProposalOpportunityRepository();

  return async function proposalOpportunitiesHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'GET') {
      return json(405, { error: 'Método não permitido.' });
    }
    const query = event.queryStringParameters || {};
    const clientId = (query.client_id || '').trim();
    const opportunityId = (query.opportunity_id || '').trim();
    if (!clientId && !opportunityId) {
      return json(400, { error: 'Informe o cliente ou a oportunidade.' });
    }
    if (clientId && opportunityId) {
      return json(400, { error: 'Informe apenas o cliente ou a oportunidade.' });
    }
    if (clientId && !UUID_PATTERN.test(clientId)) {
      return json(400, { error: 'Cliente inválido.' });
    }
    if (opportunityId && !UUID_PATTERN.test(opportunityId)) {
      return json(400, { error: 'Oportunidade inválida.' });
    }
    try {
      if (clientId) {
        const choices = await repository.listChoices(clientId);
        return json(200, { data: choices.map(publicChoice) });
      }
      const proposals = await repository.listProposals(opportunityId);
      return json(200, { proposals: proposals.map(publicProposal) });
    } catch (error) {
      console.error(
        '[proposal-opportunities] falha ao carregar as oportunidades',
        error instanceof Error ? error.name : typeof error
      );
      return json(503, { error: 'Não foi possível carregar as oportunidades comerciais.' });
    }
  };
}

export const handler = createProposalOpportunitiesHandler();
