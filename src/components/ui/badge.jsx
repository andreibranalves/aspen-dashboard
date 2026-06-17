import { cn } from '@/lib/utils.js';

/**
 * StatusBadge — Alpine status chips.
 * Neutral surface with semantic color text for each status.
 */
const badgeVariants = {
  Draft:     'tone-neutral-soft',
  Open:      'tone-primary-soft',
  Replied:   'tone-warning-soft',
  Ordered:   'tone-success-soft',
  Lost:      'tone-destructive-soft',
  Expired:   'tone-neutral-muted',
  Cancelled: 'tone-neutral-muted line-through',
};

export function StatusBadge({ status, label, className }) {
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
