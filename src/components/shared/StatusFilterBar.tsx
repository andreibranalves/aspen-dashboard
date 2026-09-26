import { cn } from '@/lib/utils';
import { buttonSizes } from '@/components/ui/button';

export interface StatusFilterOption<T extends string> {
  value: T;
  label: string;
  /** Contagem autoritativa do endpoint; `undefined` omite, `null` indica carregando. */
  count?: number | null;
}

interface StatusFilterBarProps<T extends string> {
  label: string;
  options: ReadonlyArray<StatusFilterOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

/**
 * StatusFilterBar — filtro por status com contagem, no lugar de StatCards +
 * select acima das listas. Rola na horizontal sem barra quando não cabe.
 */
export default function StatusFilterBar<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: StatusFilterBarProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-control font-semibold transition-colors',
              buttonSizes.default,
              active
                ? 'bg-primary-soft text-primary-soft-ink'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
            )}
          >
            {option.label}
            {option.count === null ? (
              <span className="skeleton-text w-5" aria-label="Carregando" />
            ) : option.count !== undefined ? (
              <span className="tabular-nums opacity-70">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
