import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * EmptyState is an application-level composition for a valid zero-result
 * response, not a UI primitive and not an error state.
 *
 * card: bloco próprio na página; dashed: vazio dentro de um card ou lista;
 * bare: vazio que preenche um painel já emoldurado.
 */
export const emptyStateSurfaces = {
  card: 'rounded-card bg-surface py-12',
  dashed: 'rounded-card border border-dashed border-line py-12',
  bare: 'py-6',
} as const;

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  variant?: keyof typeof emptyStateSurfaces;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  variant = 'card',
  className,
}: EmptyStateProps) {
  return (
    <section
      role="status"
      aria-label={title}
      className={cn('flex min-h-64 flex-col items-center justify-center gap-3 px-5 text-center text-fg-muted', emptyStateSurfaces[variant], className)}
    >
      <span className="grid size-12 place-items-center rounded-full bg-raised text-fg-muted">
        <Icon size={24} aria-hidden="true" />
      </span>
      <h2 className="text-base font-bold text-fg">{title}</h2>
      {description && <p className="max-w-md text-sm">{description}</p>}
      {actions && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </section>
  );
}

export default EmptyState;
