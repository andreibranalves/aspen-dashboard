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
    <div className={cn('flex min-h-[145px] min-w-0 flex-col gap-3 rounded-card bg-surface p-[22px]', className)}>
      <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-raised text-light-sage">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <div className="text-[28px] font-bold leading-tight tracking-[-0.04em] tabular-nums text-fg">
        {value}
      </div>
      {(metadata != null || footer != null) && (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[11px] text-fg-muted">
          {metadata != null && <span>{metadata}</span>}
          {footer != null && <span>{footer}</span>}
        </div>
      )}
    </div>
  );
}
