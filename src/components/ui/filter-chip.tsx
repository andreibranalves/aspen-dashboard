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
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
        selected ? 'bg-primary text-on-solid' : 'bg-surface-muted text-fg-muted hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}
