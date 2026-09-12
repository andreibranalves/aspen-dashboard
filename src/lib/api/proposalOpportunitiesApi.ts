export interface OpportunityChoice {
  opportunityId: string;
  clientId: string | null;
  demandSummary: string | null;
  status: string;
  updatedAt: string;
  proposalCount: number;
}

export interface OpportunityProposal {
  quotationId: string;
  businessNumber: string;
  status: string;
  total: string | null;
  createdAt: string;
}

export class ProposalOpportunitiesApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ProposalOpportunitiesApiError';
    this.status = status;
  }
}

function invalidResponse(): never {
  throw new ProposalOpportunitiesApiError('Resposta inválida das oportunidades.');
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, maximum = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) invalidResponse();
  return value;
}

function optionalText(value: unknown, maximum = 4000): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > maximum) invalidResponse();
  return value || null;
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const message = (value as { error?: unknown }).error;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

function parseChoice(value: unknown): OpportunityChoice {
  const record = asObject(value);
  const proposalCount = record.proposal_count;
  if (typeof proposalCount !== 'number' || !Number.isInteger(proposalCount) || proposalCount < 0) {
    invalidResponse();
  }
  return {
    opportunityId: requiredText(record.opportunity_id, 255),
    clientId: optionalText(record.client_id, 255),
    demandSummary: optionalText(record.demand_summary),
    status: requiredText(record.status, 32),
    updatedAt: requiredText(record.updated_at, 80),
    proposalCount,
  };
}

export async function listClientOpportunities(clientId: string): Promise<OpportunityChoice[]> {
  const query = new URLSearchParams({ client_id: clientId });
  const response = await fetch(`/api/proposal-opportunities?${query.toString()}`, {
    method: 'GET',
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ProposalOpportunitiesApiError(
      errorMessage(body, 'Não foi possível carregar as oportunidades.'),
      response.status
    );
  }
  const record = asObject(body);
  if (!Array.isArray(record.data)) invalidResponse();
  return record.data.map(parseChoice);
}

function parseProposal(value: unknown): OpportunityProposal {
  const record = asObject(value);
  return {
    quotationId: requiredText(record.quotation_id, 255),
    businessNumber: requiredText(record.business_number, 32),
    status: requiredText(record.status, 32),
    total: optionalText(record.total, 64),
    createdAt: requiredText(record.created_at, 80),
  };
}

export async function listOpportunityProposals(
  opportunityId: string
): Promise<OpportunityProposal[]> {
  const query = new URLSearchParams({ opportunity_id: opportunityId });
  const response = await fetch(`/api/proposal-opportunities?${query.toString()}`, {
    method: 'GET',
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ProposalOpportunitiesApiError(
      errorMessage(body, 'Não foi possível carregar as propostas.'),
      response.status
    );
  }
  const record = asObject(body);
  if (!Array.isArray(record.proposals)) invalidResponse();
  return record.proposals.map(parseProposal);
}
