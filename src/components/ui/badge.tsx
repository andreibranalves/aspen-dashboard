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

export type StatusTone =
  | 'tone-primary-soft'
  | 'tone-success-soft'
  | 'tone-warning-soft'
  | 'tone-destructive-soft'
  | 'tone-info-soft'
  | 'tone-neutral-soft'
  | 'tone-neutral-muted';

export interface StatusBadgeProps {
  status: string;
  label?: string;
  tone?: StatusTone;
  className?: string;
}

export function StatusBadge({ status, label, tone, className }: StatusBadgeProps) {
  const variant = tone || badgeVariants[status] || badgeVariants.Draft;
  return (
    <span
      title={label || status}
      data-status={status}
      className={cn(
        'inline-flex max-w-[180px] items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-badge px-2 py-0.5 text-2xs font-semibold leading-4 transition-colors',
        variant,
        className
      )}
    >
      {label || status}
    </span>
  );
}
