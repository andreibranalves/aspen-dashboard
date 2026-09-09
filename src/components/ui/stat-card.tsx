import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * StatCard — núcleo visual único para métricas: rótulo, valor, ícone e metadado opcional.
 */
export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  /** metadado opcional (ex.: variação vs período anterior) */
  metadata?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function StatCard({ icon: Icon, label, value, metadata, footer, className }: StatCardProps) {
  return (
    <div
      className={cn('flex flex-col gap-2 rounded-lg border border-line bg-surface p-5', className)}
    >
      <div className="flex items-start gap-2 text-fg-muted">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-2xl font-semibold tabular-nums text-fg">{value}</span>
            {metadata != null && (
              <span className="whitespace-nowrap text-xs font-medium text-fg-muted">
                {metadata}
              </span>
            )}
          </div>
          {footer != null && <div className="mt-2 text-xs text-fg-muted">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
