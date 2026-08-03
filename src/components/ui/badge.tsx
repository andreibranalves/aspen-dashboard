import { cn } from '@/lib/utils';

/**
 * StatusBadge — Alpine status chips.
 * Neutral surface with semantic color text for each status.
 */
const badgeVariants: Record<string, string> = {
  Draft:     'tone-neutral-soft',
  Issued:    'tone-success-soft',
  Open:      'tone-primary-soft',
  Replied:   'tone-warning-soft',
  Ordered:   'tone-success-soft',
  Lost:      'tone-destructive-soft',
  Expired:   'tone-neutral-muted',
  Cancelled: 'tone-neutral-muted line-through',
};

interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const variant = badgeVariants[status] || badgeVariants.Draft;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        variant,
        className,
      )}
    >
      {label || status}
    </span>
  );
}
