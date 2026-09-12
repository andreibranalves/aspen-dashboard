import { Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import type { OpportunityChoice } from '@/lib/api/proposalOpportunitiesApi';
import {
  NEW_DEMAND_SELECTION,
  type OpportunitySelection,
} from '@/features/quotations/opportunitySelection';
import { cn } from '@/lib/utils';

interface OpportunitySelectorProps {
  choices: OpportunityChoice[];
  loading: boolean;
  value: OpportunitySelection;
  disabled?: boolean;
  onChange: (value: OpportunitySelection) => void;
}

function choiceLabel(choice: OpportunityChoice): string {
  const demand = choice.demandSummary || 'Demanda sem resumo';
  const proposals = choice.proposalCount === 1 ? '1 proposta' : `${choice.proposalCount} propostas`;
  return `${demand} · ${proposals}`;
}

export default function OpportunitySelector({
  choices,
  loading,
  value,
  disabled = false,
  onChange,
}: OpportunitySelectorProps) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-xs font-medium text-fg-muted">Oportunidade</legend>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 size={14} className="animate-spin" /> Carregando demandas…
        </p>
      ) : (
        <div className="space-y-2">
          {choices.map((choice) => {
            const checked = value.mode === 'existing' && value.opportunityId === choice.opportunityId;
            return (
              <label
                key={choice.opportunityId}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm',
                  checked ? 'border-primary/40 bg-primary/5' : 'border-line'
                )}
              >
                <input
                  type="radio"
                  name="opportunity-selection"
                  className="h-4 w-4 accent-primary"
                  checked={checked}
                  onChange={() =>
                    onChange({ mode: 'existing', opportunityId: choice.opportunityId, demandSummary: '' })
                  }
                />
                <span className="min-w-0 truncate">{choiceLabel(choice)}</span>
              </label>
            );
          })}
          <label
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm',
              value.mode === 'new' ? 'border-primary/40 bg-primary/5' : 'border-line'
            )}
          >
            <input
              type="radio"
              name="opportunity-selection"
              className="h-4 w-4 accent-primary"
              checked={value.mode === 'new'}
              onChange={() => onChange({ ...NEW_DEMAND_SELECTION })}
            />
            <span>Nova demanda</span>
          </label>
          {value.mode === 'new' && (
            <Input
              aria-label="Resumo da nova demanda"
              placeholder="Resumo da demanda (opcional)"
              value={value.demandSummary}
              onChange={(event) =>
                onChange({
                  mode: 'new',
                  opportunityId: null,
                  demandSummary: event.target.value,
                })
              }
            />
          )}
        </div>
      )}
    </fieldset>
  );
}
