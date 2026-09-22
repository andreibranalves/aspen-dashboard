import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * FilterChip — pill de filtro compartilhando aparência e estados interativos.
 * Regras de filtro (seleção, contadores, URL) permanecem na página.
 */
export interface FilterChipProps {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export function FilterChip({ selected, onClick, children, className }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-control px-3 py-1 text-xs font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-sage focus-visible:ring-offset-4 focus-visible:ring-offset-page',
        selected ? 'bg-cream text-page' : 'text-fg-muted hover:bg-raised hover:text-fg',
        className
      )}
    >
      {children}
    </button>
  );
}
