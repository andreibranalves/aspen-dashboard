import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tag — marcador compacto e removível (filtros, classificação de registros).
 * Diferente do StatusBadge, é interativo: pode disparar remoção.
 */
const TAG_TONES = {
  neutral: 'bg-surface-muted text-fg-muted',
  primary: 'bg-primary/10 text-primary-text',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
} as const;

export type TagTone = keyof typeof TAG_TONES;

export interface TagProps {
  tone?: TagTone;
  /** Quando definido, renderiza o botão de remoção. */
  onRemove?: () => void;
  /** aria-label do botão de remoção. */
  removeLabel?: string;
  className?: string;
  children: ReactNode;
}

export function Tag({ tone = 'neutral', onRemove, removeLabel = 'Remover', className, children }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-[220px] items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        TAG_TONES[tone],
        className
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-1 shrink-0 rounded-full p-0.5 transition-colors hover:bg-fg/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
