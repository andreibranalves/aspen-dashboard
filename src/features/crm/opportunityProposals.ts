import type { OpportunityProposal } from '../../lib/api/proposalOpportunitiesApi.ts';
import { formatBRL } from '../../lib/formatting/formatters.ts';

/** One line of the opportunity context: number, state and value. */
export function formatOpportunityProposal(proposal: OpportunityProposal): string {
  const value = proposal.total === null ? 'Sem valor' : formatBRL(proposal.total);
  return `${proposal.businessNumber} · ${proposal.status} · ${value}`;
}
