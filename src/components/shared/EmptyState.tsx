import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * EmptyState is an application-level composition for a valid zero-result
 * response, not a UI primitive and not an error state.
 */
export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: EmptyStateProps) {
  return (
    <section
      role="status"
      aria-label={title}
      className={cn('flex min-h-64 flex-col items-center justify-center gap-3 rounded-card bg-surface px-5 py-12 text-center text-fg-muted', className)}
    >
      <Icon size={30} className="text-fg-muted/60" aria-hidden="true" />
      <h2 className="text-base font-bold text-fg">{title}</h2>
      {description && <p className="max-w-md text-xs">{description}</p>}
      {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </section>
  );
}

export default EmptyState;
