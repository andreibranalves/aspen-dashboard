import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { OpportunityChoice } from '@/lib/api/proposalOpportunitiesApi';
import {
  NEW_DEMAND_SELECTION,
  type OpportunitySelection,
} from '@/features/quotations/opportunitySelection';

interface OpportunitySelectorProps {
  choices: OpportunityChoice[];
  loading: boolean;
  value: OpportunitySelection;
  disabled?: boolean;
  onChange: (value: OpportunitySelection) => void;
}

const NEW_DEMAND_VALUE = '__new__';

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
  const selected = value.mode === 'new' ? NEW_DEMAND_VALUE : value.opportunityId || '';
  return (
    <div className="flex flex-col gap-2">
      <Field label="Oportunidade">
        <Select
          value={loading ? '' : selected}
          onChange={(event) => {
            const next = event.target.value;
            if (next === NEW_DEMAND_VALUE) onChange({ ...NEW_DEMAND_SELECTION });
            else onChange({ mode: 'existing', opportunityId: next || null, demandSummary: '' });
          }}
          disabled={disabled || loading}
          className="w-full"
          containerClassName="w-full"
        >
          {loading ? (
            <option value="">Carregando demandas…</option>
          ) : (
            <>
              {!selected && <option value="">Escolha a demanda…</option>}
              {choices.map((choice) => (
                <option key={choice.opportunityId} value={choice.opportunityId}>
                  {choiceLabel(choice)}
                </option>
              ))}
              <option value={NEW_DEMAND_VALUE}>Nova demanda</option>
            </>
          )}
        </Select>
      </Field>
      {/* Sem demandas abertas a nova é o padrão; o resumo só nomeia uma escolha feita. */}
      {value.mode === 'new' && choices.length > 0 && !loading && (
        <Input
          aria-label="Resumo da nova demanda"
          placeholder="Resumo (opcional)"
          value={value.demandSummary}
          disabled={disabled}
          onChange={(event) =>
            onChange({ mode: 'new', opportunityId: null, demandSummary: event.target.value })
          }
        />
      )}
    </div>
  );
}
