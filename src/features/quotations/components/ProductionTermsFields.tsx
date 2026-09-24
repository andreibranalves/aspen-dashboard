import { Input, type InputSize } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { MAX_PRODUCTION_DAYS, MAX_SURCHARGE_PERCENT } from '@/lib/productionDeadline';

function clampInteger(raw: string, minimum: number, maximum: number): number | null {
  if (!raw.trim()) return null;
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed)) return null;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export interface ProductionTermsFieldsProps {
  productionDays: number;
  surchargePercent: number;
  disabled?: boolean;
  size?: InputSize;
  className?: string;
  onProductionDaysChange: (days: number) => void;
  onSurchargePercentChange: (percent: number) => void;
}

/** Prazo de produção em dias úteis e acréscimo sobre os preços automáticos. */
export default function ProductionTermsFields({
  productionDays,
  surchargePercent,
  disabled,
  size = 'default',
  className,
  onProductionDaysChange,
  onSurchargePercentChange,
}: ProductionTermsFieldsProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
        Prazo de produção (dias úteis)
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_PRODUCTION_DAYS}
          step={1}
          size={size}
          value={productionDays}
          disabled={disabled}
          onChange={(event) => {
            const days = clampInteger(event.target.value, 1, MAX_PRODUCTION_DAYS);
            if (days !== null) onProductionDaysChange(days);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
        Acréscimo (%)
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_SURCHARGE_PERCENT}
          step={1}
          size={size}
          value={surchargePercent}
          disabled={disabled}
          onChange={(event) => {
            onSurchargePercentChange(clampInteger(event.target.value, 0, MAX_SURCHARGE_PERCENT) ?? 0);
          }}
        />
      </label>
    </div>
  );
}
