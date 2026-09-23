import { cn } from '@/lib/utils';

/**
 * StatusBadge — compact semantic status chips from the Aspen sketch system.
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
        'inline-flex max-w-[180px] items-center whitespace-nowrap overflow-hidden text-ellipsis rounded-badge px-2 py-1 text-[10px] font-semibold transition-colors',
        variant,
        className
      )}
    >
      {label || status}
    </span>
  );
}
