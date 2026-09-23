import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  title: string;
  description?: ReactNode;
  onRetry?: () => void;
  /** Extra actions after "Tentar novamente" (e.g. back to the list). */
  actions?: ReactNode;
  className?: string;
}

/** ErrorState — EmptyState's sibling for a failed load: same geometry, alert semantics. */
export default function ErrorState({ title, description, onRetry, actions, className }: ErrorStateProps) {
  return (
    <section
      role="alert"
      className={cn('flex min-h-64 flex-col items-center justify-center gap-3 rounded-card bg-surface px-5 py-12 text-center', className)}
    >
      <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle size={24} aria-hidden="true" />
      </span>
      <h2 className="text-base font-bold text-fg">{title}</h2>
      {description && <p className="max-w-md text-sm text-fg-muted">{description}</p>}
      {(onRetry || actions) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw aria-hidden="true" /> Tentar novamente
            </Button>
          )}
          {actions}
        </div>
      )}
    </section>
  );
}
