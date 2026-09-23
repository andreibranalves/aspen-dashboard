import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * StatCard — núcleo visual único para métricas: rótulo, valor, ícone e metadado opcional.
 * Enquanto `loading`, o valor vira skeleton: nunca exibir zero antes da resposta.
 * Abaixo de `md` fica compacto para a lista de trabalho aparecer na primeira dobra.
 */
export interface StatCardProps {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
  /** metadado opcional (ex.: variação vs período anterior) */
  metadata?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  className?: string;
}

export function StatCard({ icon: Icon, label, value, metadata, footer, loading = false, className }: StatCardProps) {
  // Names (e.g. "Produto líder") would not fit the numeric display size.
  const textValue = typeof value === 'string' && value.length > 16 && /[a-zA-ZÀ-ÿ]{3}/.test(value) ? value : undefined;
  return (
    <div
      aria-busy={loading || undefined}
      className={cn(
        'flex min-h-[104px] min-w-0 flex-col gap-2 rounded-card bg-surface p-4 md:min-h-[145px] md:gap-3 md:p-[22px]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
        <span className="min-w-0 truncate font-medium">{label}</span>
        {Icon && (
          <span className="hidden size-8 shrink-0 place-items-center rounded-control bg-raised text-light-sage md:grid">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        )}
      </div>
      <div
        title={textValue}
        className={cn(
          'font-bold leading-tight tracking-[-0.04em] tabular-nums text-fg',
          textValue ? 'line-clamp-2 break-words text-base md:text-lg' : 'text-[22px] md:text-[28px]'
        )}
      >
        {loading ? <span className="skeleton-text w-16 max-w-full" aria-label="Carregando" /> : value}
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

/** Grid for a row of StatCards: two columns on phones, four on wide screens. */
export function StatGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
      {children}
    </section>
  );
}
