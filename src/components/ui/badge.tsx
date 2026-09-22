import { cn } from '@/lib/utils';

/**
 * StatusBadge — Alpine status chips.
 * Neutral surface with semantic color text for each status.
 */
const badgeVariants: Record<string, string> = {
  Draft: 'tone-neutral-soft',
  Issued: 'tone-success-soft',
  Open: 'tone-primary-soft',
  Replied: 'tone-warning-soft',
  Ordered: 'tone-success-soft',
  Lost: 'tone-destructive-soft',
  Expired: 'tone-neutral-muted',
  Cancelled: 'tone-neutral-muted line-through',
  // Pedidos (status do ERP)
  'To Deliver and Bill': 'tone-primary-soft',
  'To Bill': 'tone-info-soft',
  'To Deliver': 'tone-info-soft',
  Completed: 'tone-success-soft',
  Closed: 'tone-neutral-muted',
  // Clientes
  Active: 'tone-success-soft',
  Archived: 'tone-neutral-soft',
  // CRM — status de negócio (ganho / perdido / em progresso)
  Won: 'tone-won-soft',
  Ganho: 'tone-won-soft',
  'Pedido Fechado': 'tone-won-soft',
  Perdido: 'tone-lost-soft',
  'In Progress': 'tone-progress-soft',
};

export interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  // Quando className já define um tone-*, pular o fallback (a cascata CSS favoreceria tone-neutral-soft).
  const hasCustomTone = Boolean(className?.includes('tone-'));
  const variant = badgeVariants[status] || (hasCustomTone ? '' : badgeVariants.Draft);
  return (
    <span
      title={label || status}
      data-status={status}
      className={cn(
        'inline-flex max-w-[180px] items-center whitespace-nowrap overflow-hidden text-ellipsis rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        variant,
        className
      )}
    >
      {label || status}
    </span>
  );
}
