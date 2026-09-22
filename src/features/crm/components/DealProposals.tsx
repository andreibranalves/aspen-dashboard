import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  listOpportunityProposals,
  type OpportunityProposal,
} from '@/lib/api/proposalOpportunitiesApi';
import { formatOpportunityProposal } from '@/features/crm/opportunityProposals';

interface DealProposalsProps {
  opportunityId: string;
}

/**
 * Existing opportunity context: shows every proposal linked to the demand,
 * loaded on demand. A failure keeps the surface quiet and never leaks details.
 */
export default function DealProposals({ opportunityId }: DealProposalsProps) {
  const [proposals, setProposals] = useState<OpportunityProposal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function load() {
    setExpanded(true);
    if (proposals !== null || loading) return;
    setLoading(true);
    setError(false);
    try {
      setProposals(await listOpportunityProposals(opportunityId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 rounded-control border border-line bg-surface-subtle px-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
        aria-expanded={expanded}
        onClick={() => void load()}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Propostas
      </Button>
      {expanded && (
        <ul className="mt-2 space-y-1 rounded-xl border border-line bg-surface-subtle p-3 text-xs text-fg-muted">
          {error ? (
            <li>Não foi possível carregar as propostas.</li>
          ) : proposals && proposals.length > 0 ? (
            proposals.map((proposal) => (
              <li key={proposal.quotationId}>{formatOpportunityProposal(proposal)}</li>
            ))
          ) : loading ? null : (
            <li>Nenhuma proposta vinculada.</li>
          )}
        </ul>
      )}
    </div>
  );
}
